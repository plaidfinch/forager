/**
 * Catalog management module.
 *
 * Provides functions to check catalog freshness and refresh if needed.
 */

import type Database from "better-sqlite3";
import DatabaseImpl from "better-sqlite3";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fetchCatalog, fetchCatalogs, AlgoliaError, type FetchProgress, type AlgoliaHit } from "./fetch.js";
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
  onProgress?: (progress: FetchProgress) => void,
  targetDurationMs?: number,
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

    for await (const batch of fetchCatalog(apiKey, appId, storeNumber, onProgress, targetDurationMs)) {
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
  onProgress?: (progress: FetchProgress) => void,
  targetDurationMs?: number,
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
    const result = await refreshCatalog(tmpDb, apiKey, appId, storeNumber, onProgress, targetDurationMs);
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
 * Refresh catalogs for multiple stores into new database files,
 * atomically swapping each into place as it completes.
 *
 * Uses a single global worker pool (fetchCatalogs) so all stores
 * share the same connection budget. Temp DBs are opened lazily
 * (on first batch) and closed eagerly (on done sentinel).
 *
 * @param storesDir - Directory containing per-store databases (e.g. /data/stores)
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumbers - Store numbers to refresh
 * @param onProgress - Optional progress callback
 * @param targetDurationMs - Target duration for pacing (undefined = fast)
 * @returns Map of storeNumber → RefreshResult
 */
export async function refreshCatalogsToFile(
  storesDir: string,
  apiKey: string,
  appId: string,
  storeNumbers: string[],
  onProgress?: (progress: FetchProgress) => void,
  targetDurationMs?: number,
): Promise<Map<string, RefreshResult>> {
  interface StoreContext {
    tmpDb: Database.Database;
    tmpPath: string;
    targetPath: string;
    processBatch: (hits: AlgoliaHit[]) => void;
    productsAdded: number;
    now: string;
  }

  const contexts = new Map<string, StoreContext>();
  const results = new Map<string, RefreshResult>();

  function getOrCreateContext(storeNumber: string): StoreContext {
    let ctx = contexts.get(storeNumber);
    if (ctx) return ctx;

    const targetPath = join(storesDir, `${storeNumber}.db`);
    const tmpPath = targetPath + ".tmp";

    if (existsSync(tmpPath)) unlinkSync(tmpPath);

    const tmpDb = new DatabaseImpl(tmpPath);
    tmpDb.pragma("foreign_keys = ON");
    initializeStoreDataSchema(tmpDb);

    // Clear derived tables for fresh counts
    tmpDb.exec("DELETE FROM categories");
    tmpDb.exec("DELETE FROM tags");
    tmpDb.exec("DELETE FROM product_tags");

    const now = new Date().toISOString();

    const processBatch = tmpDb.transaction((hits: AlgoliaHit[]) => {
      populateOntology(tmpDb, hits);

      for (const hit of hits) {
        const product = {
          ...transformHitToProduct(hit),
          lastUpdated: now,
        };
        const serving = transformHitToServing(hit);
        const nutritionFacts = transformHitToNutritionFacts(hit);

        upsertProduct(tmpDb, product);
        upsertProductTags(tmpDb, product.productId, product.tagsFilter, product.tagsPopular);

        if (serving) upsertServing(tmpDb, serving);
        if (nutritionFacts.length > 0) upsertNutritionFacts(tmpDb, nutritionFacts);

        ctx!.productsAdded++;
      }
    });

    ctx = { tmpDb, tmpPath, targetPath, processBatch, productsAdded: 0, now };
    contexts.set(storeNumber, ctx);
    return ctx;
  }

  function finalizeStore(storeNumber: string): void {
    const ctx = contexts.get(storeNumber);
    if (!ctx) {
      // No batches received — store had zero products
      results.set(storeNumber, {
        success: true,
        productsAdded: 0,
        categoriesAdded: 0,
        tagsAdded: 0,
      });
      return;
    }

    try {
      const stats = getOntologyStats(ctx.tmpDb);
      ctx.tmpDb.close();
      renameSync(ctx.tmpPath, ctx.targetPath);

      results.set(storeNumber, {
        success: true,
        productsAdded: ctx.productsAdded,
        categoriesAdded: stats.categoryCount,
        tagsAdded: stats.tagCount,
      });
    } catch (err) {
      try { ctx.tmpDb.close(); } catch { /* ignore */ }
      if (existsSync(ctx.tmpPath)) {
        try { unlinkSync(ctx.tmpPath); } catch { /* ignore */ }
      }
      results.set(storeNumber, {
        success: false,
        productsAdded: 0,
        categoriesAdded: 0,
        tagsAdded: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      contexts.delete(storeNumber);
    }
  }

  try {
    for await (const batch of fetchCatalogs(apiKey, appId, storeNumbers, { onProgress, targetDurationMs })) {
      if ("done" in batch) {
        finalizeStore(batch.storeNumber);
      } else {
        const ctx = getOrCreateContext(batch.storeNumber);
        ctx.processBatch(batch.hits);
      }
    }
  } catch (err) {
    // Clean up all open temp DBs
    for (const [storeNumber, ctx] of contexts) {
      try { ctx.tmpDb.close(); } catch { /* ignore */ }
      if (existsSync(ctx.tmpPath)) {
        try { unlinkSync(ctx.tmpPath); } catch { /* ignore */ }
      }
      if (!results.has(storeNumber)) {
        const result: RefreshResult = {
          success: false,
          productsAdded: 0,
          categoriesAdded: 0,
          tagsAdded: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        if (err instanceof AlgoliaError) result.status = err.status;
        results.set(storeNumber, result);
      }
    }
    contexts.clear();

    // Fill in results for stores that never got any batches
    for (const sn of storeNumbers) {
      if (!results.has(sn)) {
        const result: RefreshResult = {
          success: false,
          productsAdded: 0,
          categoriesAdded: 0,
          tagsAdded: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        if (err instanceof AlgoliaError) result.status = err.status;
        results.set(sn, result);
      }
    }
  }

  return results;
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
  onProgress?: (progress: FetchProgress) => void,
  targetDurationMs?: number,
): Promise<RefreshResult | null> {
  const status = getCatalogStatus(db);

  if (!status.isEmpty && !status.isStale) {
    return null; // No refresh needed
  }

  return refreshCatalog(db, apiKey, appId, storeNumber, onProgress, targetDurationMs);
}
