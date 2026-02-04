/**
 * Search tool for fetching products from Algolia and populating the database.
 *
 * Bridges the Algolia API with the local SQLite database by:
 * 1. Executing search queries against Algolia
 * 2. Transforming hits to domain objects
 * 3. Upserting data into the database
 */

import type Database from "better-sqlite3";
import {
  searchProducts,
  transformHitToProduct,
  transformHitToStoreProduct,
  transformHitToServing,
  transformHitToNutritionFacts,
  type SearchResult,
  type SearchRequestOptions,
} from "../algolia/client.js";
import {
  upsertProduct,
  upsertStoreProduct,
  upsertServing,
  upsertNutritionFacts,
} from "../db/products.js";

export interface SearchToolOptions {
  /** Search query text */
  query: string;
  /** Store number for search context */
  storeNumber: string;
  /** Algolia API key */
  apiKey: string;
  /** Number of hits per page (default: 20) */
  hitsPerPage?: number;
  /** Raw Algolia filter string (e.g., 'filterTags:Organic AND categories.lvl0:Dairy') */
  filters?: string;
  /** Injectable search function for testing (defaults to searchProducts) */
  searchFn?: (apiKey: string, options: SearchRequestOptions) => Promise<SearchResult>;
}

export interface SearchToolResult {
  success: boolean;
  /** Number of products added/updated in database */
  productsAdded?: number;
  /** Total hits reported by Algolia */
  totalHits?: number;
  /** Error message if search failed */
  error?: string;
}

/**
 * Execute a search against Algolia and populate the database with results.
 *
 * @param db - Database connection (must be writable)
 * @param options - Search options
 * @returns Result with success status and counts
 */
export async function searchTool(
  db: Database.Database,
  options: SearchToolOptions
): Promise<SearchToolResult> {
  const {
    query,
    storeNumber,
    apiKey,
    hitsPerPage,
    filters,
    searchFn = searchProducts,
  } = options;

  // Build search options, only including optional params if defined
  const searchOptions: SearchRequestOptions = {
    query,
    storeNumber,
  };
  if (hitsPerPage !== undefined) {
    searchOptions.hitsPerPage = hitsPerPage;
  }
  if (filters !== undefined) {
    searchOptions.filters = filters;
  }

  // Execute search
  const searchResult = await searchFn(apiKey, searchOptions);

  // Return error if search failed
  if (!searchResult.success) {
    return {
      success: false,
      error: searchResult.error ?? "Search failed",
    };
  }

  // Process hits and insert into database
  let productsAdded = 0;

  for (const hit of searchResult.hits) {
    // Transform hit to domain objects
    const product = transformHitToProduct(hit);
    const storeProduct = transformHitToStoreProduct(hit);
    const serving = transformHitToServing(hit);
    const nutritionFacts = transformHitToNutritionFacts(hit);

    // Upsert into database
    upsertProduct(db, product);
    upsertStoreProduct(db, storeProduct);

    if (serving) {
      upsertServing(db, serving);
    }

    if (nutritionFacts.length > 0) {
      upsertNutritionFacts(db, nutritionFacts);
    }

    productsAdded++;
  }

  return {
    success: true,
    productsAdded,
    totalHits: searchResult.totalHits,
  };
}
