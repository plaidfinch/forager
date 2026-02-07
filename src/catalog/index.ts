/**
 * Catalog management module.
 *
 * Provides functions to check catalog freshness and refresh if needed.
 */

import type Database from "better-sqlite3";
import DatabaseImpl from "better-sqlite3";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { fetchCatalog, AlgoliaError, type FetchProgress, type AlgoliaHit } from "./fetch.js";
import { populateOntology, getOntologyStats } from "./ontology.js";
import { initializeStoreDataSchema } from "../db/schema.js";
import {
  transformHitToProduct,
  transformHitToServing,
  transformHitToNutritionFacts,
} from "../algolia/client.js";
import {
  upsertProduct,
  upsertProductTags,
  upsertServing,
  upsertNutritionFacts,
} from "../db/products.js";

export { type FetchProgress } from "./fetch.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day

export interface CatalogStatus {
  isEmpty: boolean;
  isStale: boolean;
  productCount: number;
  lastUpdated: Date | null;
}

export type RefreshResult =
  | {
      success: true;
      productsAdded: number;
      categoriesAdded: number;
      tagsAdded: number;
    }
  | {
      success: false;
      productsAdded: number;
      categoriesAdded: number;
      tagsAdded: number;
      error: string;
      /** HTTP status code if the error was from an HTTP response */
      status?: number;
    };

/**
 * Check the current status of the product catalog.
 *
 * In the per-store database design, each store has its own database.
 * We query the products table directly (no store filter needed).
 *
 * @param db - Store database connection
 * @returns Catalog status including staleness
 */
export function getCatalogStatus(db: Database.Database): CatalogStatus {
  // Get product count
  const countResult = db.prepare("SELECT COUNT(*) as count FROM products").get() as {
    count: number;
  };
  const productCount = countResult.count;

  if (productCount === 0) {
    return {
      isEmpty: true,
      isStale: true,
      productCount: 0,
      lastUpdated: null,
    };
  }

  // Get most recent last_updated from products table
  const lastUpdatedResult = db
    .prepare(
      "SELECT MAX(last_updated) as last_updated FROM products WHERE last_updated IS NOT NULL"
    )
    .get() as { last_updated: string | null };

  const lastUpdated = lastUpdatedResult.last_updated
    ? new Date(lastUpdatedResult.last_updated)
    : null;

  const isStale = lastUpdated
    ? Date.now() - lastUpdated.getTime() > STALE_THRESHOLD_MS
    : true;

  return {
    isEmpty: false,
    isStale,
    productCount,
    lastUpdated,
  };
}

/**
 * Refresh the catalog by streaming products from Algolia into the database.
 *
 * Products are written in per-batch transactions as they arrive from the API,
 * keeping memory usage constant regardless of catalog size.
 *
 * @param db - Database connection
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumber - Store number to fetch
 * @param onProgress - Optional progress callback
 * @returns Refresh result with counts
 */
export async function refreshCatalog(
  db: Database.Database,
  apiKey: string,
  appId: string,
  storeNumber: string,
  onProgress?: (progress: FetchProgress) => void
): Promise<RefreshResult> {
  try {
    const beforeStats = getOntologyStats(db);

    // Clear derived tables so counts are accurate for the fresh catalog
    db.exec("DELETE FROM categories");
    db.exec("DELETE FROM tags");
    db.exec("DELETE FROM product_tags");

    const now = new Date().toISOString();
    let productsAdded = 0;

    // Process each batch in its own transaction
    const processBatch = db.transaction((hits: AlgoliaHit[]) => {
      populateOntology(db, hits);

      for (const hit of hits) {
        const product = {
          ...transformHitToProduct(hit),
          lastUpdated: now,
        };
        const serving = transformHitToServing(hit);
        const nutritionFacts = transformHitToNutritionFacts(hit);

        upsertProduct(db, product);
        upsertProductTags(db, product.productId, product.tagsFilter, product.tagsPopular);

        if (serving) {
          upsertServing(db, serving);
        }

        if (nutritionFacts.length > 0) {
          upsertNutritionFacts(db, nutritionFacts);
        }

        productsAdded++;
      }
    });

    for await (const batch of fetchCatalog(apiKey, appId, storeNumber, onProgress)) {
      processBatch(batch);
    }

    const afterStats = getOntologyStats(db);

    return {
      success: true,
      productsAdded,
      categoriesAdded: afterStats.categoryCount - beforeStats.categoryCount,
      tagsAdded: afterStats.tagCount - beforeStats.tagCount,
    };
  } catch (err) {
    const result: RefreshResult = {
      success: false,
      productsAdded: 0,
      categoriesAdded: 0,
      tagsAdded: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    if (err instanceof AlgoliaError) {
      result.status = err.status;
    }
    return result;
  }
}

/**
 * Refresh the catalog into a new database file, then atomically swap it
 * into place. Readers with open connections to the old file continue
 * uninterrupted; new connections get the fresh data.
 *
 * On failure, the temp file is cleaned up and the existing database is
 * left untouched.
 *
 * @param targetPath - Final path for the store database (e.g. stores/74.db)
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumber - Store number to fetch
 * @param onProgress - Optional progress callback
 * @returns Refresh result with counts
 */
export async function refreshCatalogToFile(
  targetPath: string,
  apiKey: string,
  appId: string,
  storeNumber: string,
  onProgress?: (progress: FetchProgress) => void
): Promise<RefreshResult> {
  const tmpPath = targetPath + ".tmp";

  // Clean up any leftover temp file from a crashed refresh
  if (existsSync(tmpPath)) {
    unlinkSync(tmpPath);
  }

  const tmpDb = new DatabaseImpl(tmpPath);
  tmpDb.pragma("foreign_keys = ON");
  initializeStoreDataSchema(tmpDb);

  try {
    const result = await refreshCatalog(tmpDb, apiKey, appId, storeNumber, onProgress);
    tmpDb.close();

    if (result.success) {
      renameSync(tmpPath, targetPath);
    } else {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    }

    return result;
  } catch (err) {
    try { tmpDb.close(); } catch { /* ignore close errors */ }
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
    throw err;
  }
}

/**
 * Check catalog status and refresh if empty or stale.
 *
 * @param db - Database connection
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumber - Store number to fetch
 * @param onProgress - Optional progress callback
 * @returns Refresh result if refreshed, null if no refresh needed
 */
export async function refreshCatalogIfNeeded(
  db: Database.Database,
  apiKey: string,
  appId: string,
  storeNumber: string,
  onProgress?: (progress: FetchProgress) => void
): Promise<RefreshResult | null> {
  const status = getCatalogStatus(db);

  if (!status.isEmpty && !status.isStale) {
    return null; // No refresh needed
  }

  return refreshCatalog(db, apiKey, appId, storeNumber, onProgress);
}
