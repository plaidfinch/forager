/**
 * Set store tool for selecting the active Wegmans store.
 *
 * Sets the active store and triggers a catalog refresh if needed.
 * Automatically handles API key extraction if needed.
 */

import type Database from "better-sqlite3";
import {
  getCatalogStatus,
  refreshCatalog,
  type FetchProgress,
} from "../catalog/index.js";
import { extractAlgoliaKey } from "../algolia/keyExtractor.js";

export interface SetStoreOptions {
  /** Store number to set as active */
  storeNumber: string;
  /** Force refresh even if catalog is fresh */
  forceRefresh?: boolean;
  /** Progress callback */
  onProgress?: (progress: FetchProgress) => void;
}

export interface SetStoreResult {
  success: boolean;
  storeNumber: string;
  /** Whether a catalog refresh was performed */
  refreshed: boolean;
  /** Number of products in catalog for this store */
  productCount: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Get the currently active store number.
 */
export function getActiveStore(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'active_store'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Set the active store number.
 */
function setActiveStore(db: Database.Database, storeNumber: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('active_store', ?)"
  ).run(storeNumber);
}

/**
 * Ensure a store exists in the stores table.
 */
function ensureStoreExists(db: Database.Database, storeNumber: string): void {
  const exists = db
    .prepare("SELECT 1 FROM stores WHERE store_number = ?")
    .get(storeNumber);

  if (!exists) {
    // Insert minimal store record - will be updated with full info later if available
    db.prepare(
      "INSERT INTO stores (store_number, name) VALUES (?, ?)"
    ).run(storeNumber, `Store ${storeNumber}`);
  }
}

/**
 * Get product count for a specific store.
 */
function getStoreProductCount(db: Database.Database, storeNumber: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM store_products WHERE store_number = ?")
    .get(storeNumber) as { count: number };
  return row.count;
}

/**
 * Get the most recent API key from the database.
 */
function getApiKey(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT key FROM api_keys ORDER BY id DESC LIMIT 1")
    .get() as { key: string } | undefined;
  return row?.key ?? null;
}

/**
 * Store an API key in the database.
 */
function storeApiKey(db: Database.Database, apiKey: string, appId: string): void {
  db.prepare(
    "INSERT INTO api_keys (key, app_id, extracted_at) VALUES (?, ?, ?)"
  ).run(apiKey, appId, new Date().toISOString());
}

/**
 * Get or extract an API key. Extracts a new one if none exists.
 */
async function ensureApiKey(
  db: Database.Database,
  onProgress?: (progress: FetchProgress) => void
): Promise<string | null> {
  // Try existing key first
  const existingKey = getApiKey(db);
  if (existingKey) {
    return existingKey;
  }

  // Extract new key
  onProgress?.({
    phase: "planning",
    current: 0,
    total: 0,
    message: "Extracting API key from Wegmans website...",
  });

  const result = await extractAlgoliaKey({ headless: true, timeout: 60000 });

  if (!result.success || !result.apiKey) {
    return null;
  }

  // Store the key
  storeApiKey(db, result.apiKey, result.appId ?? "");

  onProgress?.({
    phase: "planning",
    current: 0,
    total: 0,
    message: "API key extracted successfully",
  });

  return result.apiKey;
}

/**
 * Set the active store and optionally refresh the catalog.
 * Automatically extracts API key if needed.
 *
 * @param db - Database connection
 * @param options - Set store options
 * @returns Result with success status
 */
export async function setStoreTool(
  db: Database.Database,
  options: SetStoreOptions
): Promise<SetStoreResult> {
  const { storeNumber, forceRefresh = false, onProgress } = options;

  try {
    // Ensure store exists in database
    ensureStoreExists(db, storeNumber);

    // Set as active store
    setActiveStore(db, storeNumber);

    // Check if catalog needs refresh for this store
    const status = getCatalogStatus(db);
    const storeProductCount = getStoreProductCount(db, storeNumber);
    const needsRefresh = forceRefresh || storeProductCount === 0 || status.isStale;

    if (needsRefresh) {
      // Get or extract API key
      const apiKey = await ensureApiKey(db, onProgress);
      if (!apiKey) {
        return {
          success: false,
          storeNumber,
          refreshed: false,
          productCount: storeProductCount,
          error: "Failed to extract API key from Wegmans website",
        };
      }

      const result = await refreshCatalog(db, apiKey, storeNumber, onProgress);

      if (!result.success) {
        return {
          success: false,
          storeNumber,
          refreshed: false,
          productCount: storeProductCount,
          error: result.error,
        };
      }

      return {
        success: true,
        storeNumber,
        refreshed: true,
        productCount: getStoreProductCount(db, storeNumber),
      };
    }

    return {
      success: true,
      storeNumber,
      refreshed: false,
      productCount: storeProductCount,
    };
  } catch (err) {
    return {
      success: false,
      storeNumber,
      refreshed: false,
      productCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
