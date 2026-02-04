/**
 * Catalog management module.
 *
 * Provides functions to check catalog freshness and refresh if needed.
 */

import type Database from "better-sqlite3";
import { fetchCatalog, type FetchProgress, type AlgoliaHit } from "./fetch.js";
import { populateOntology, getOntologyStats } from "./ontology.js";
import {
  transformHitToProduct,
  transformHitToServing,
  transformHitToNutritionFacts,
} from "../algolia/client.js";
import {
  upsertProduct,
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
 * Refresh the catalog by fetching all products and populating the database.
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
  // Fetch products
  const fetchResult = await fetchCatalog(apiKey, appId, storeNumber, onProgress);

  if (!fetchResult.success) {
    const result: RefreshResult = {
      success: false,
      productsAdded: 0,
      categoriesAdded: 0,
      tagsAdded: 0,
      error: fetchResult.error,
    };
    if (fetchResult.status !== undefined) {
      result.status = fetchResult.status;
    }
    return result;
  }

  // Get initial ontology stats
  const beforeStats = getOntologyStats(db);

  // Populate ontology tables
  populateOntology(db, fetchResult.products);

  // Insert products into database
  const now = new Date().toISOString();
  let productsAdded = 0;

  // Use transaction for bulk insert
  // In the per-store database design, we use single transformHitToProduct
  // which returns complete Product with all fields (base + store-specific).
  const insertProducts = db.transaction((hits: AlgoliaHit[]) => {
    for (const hit of hits) {
      const product = {
        ...transformHitToProduct(hit),
        lastUpdated: now,
      };
      const serving = transformHitToServing(hit);
      const nutritionFacts = transformHitToNutritionFacts(hit);

      upsertProduct(db, product);

      if (serving) {
        upsertServing(db, serving);
      }

      if (nutritionFacts.length > 0) {
        upsertNutritionFacts(db, nutritionFacts);
      }

      productsAdded++;
    }
  });

  insertProducts(fetchResult.products);

  // Get final ontology stats
  const afterStats = getOntologyStats(db);

  return {
    success: true,
    productsAdded,
    categoriesAdded: afterStats.categoryCount - beforeStats.categoryCount,
    tagsAdded: afterStats.tagCount - beforeStats.tagCount,
  };
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
