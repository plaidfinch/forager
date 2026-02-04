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

export type SetStoreResult =
  | {
      success: true;
      storeNumber: string;
      refreshed: boolean;
      productCount: number;
    }
  | {
      success: false;
      storeNumber: string;
      refreshed: boolean;
      productCount: number;
      error: string;
    };

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

interface ApiCredentials {
  apiKey: string;
  appId: string;
}

/**
 * Get the most recent API credentials from the database.
 */
function getApiCredentials(db: Database.Database): ApiCredentials | null {
  const row = db
    .prepare("SELECT key, app_id FROM api_keys ORDER BY id DESC LIMIT 1")
    .get() as { key: string; app_id: string } | undefined;
  return row ? { apiKey: row.key, appId: row.app_id } : null;
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
 * Get or extract API credentials. Extracts new ones if none exist.
 */
async function ensureApiCredentials(
  db: Database.Database,
  onProgress?: (progress: FetchProgress) => void
): Promise<ApiCredentials | null> {
  // Try existing credentials first
  const existing = getApiCredentials(db);
  if (existing) {
    return existing;
  }

  // Extract new credentials
  onProgress?.({
    phase: "planning",
    current: 0,
    total: 0,
    message: "Extracting API credentials from Wegmans website...",
  });

  const result = await extractAlgoliaKey({ headless: true, timeout: 60000 });

  if (!result.success || !result.apiKey || !result.appId) {
    return null;
  }

  // Store the credentials
  storeApiKey(db, result.apiKey, result.appId);

  onProgress?.({
    phase: "planning",
    current: 0,
    total: 0,
    message: "API credentials extracted successfully",
  });

  return { apiKey: result.apiKey, appId: result.appId };
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
      // Get or extract API credentials
      const credentials = await ensureApiCredentials(db, onProgress);
      if (!credentials) {
        return {
          success: false,
          storeNumber,
          refreshed: false,
          productCount: storeProductCount,
          error: "Failed to extract API credentials from Wegmans website",
        };
      }

      const result = await refreshCatalog(
        db,
        credentials.apiKey,
        credentials.appId,
        storeNumber,
        onProgress
      );

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
