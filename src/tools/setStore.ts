/**
 * Set store tool for selecting the active Wegmans store.
 *
 * Multi-database architecture:
 * - settings.db: API keys and active_store setting
 * - stores.db: Store locations
 * - stores/{storeNumber}.db: Per-store products
 *
 * Sets the active store and triggers a catalog refresh if needed.
 * Automatically handles API key extraction if needed.
 */

import type Database from "better-sqlite3";
import DatabaseImpl from "better-sqlite3";
import { join } from "node:path";
import {
  getCatalogStatus,
  refreshCatalog,
  type FetchProgress,
  type RefreshResult,
} from "../catalog/index.js";
import {
  extractAlgoliaKey,
  type KeyExtractionResult,
} from "../algolia/keyExtractor.js";
import { initializeStoreDataSchema } from "../db/schema.js";

export interface SetStoreOptions {
  /** Store number to set as active */
  storeNumber: string;
  /** Force refresh even if catalog is fresh */
  forceRefresh?: boolean;
  /** Progress callback */
  onProgress?: (progress: FetchProgress) => void;
  /** Injectable refresh function for testing */
  refreshCatalogFn?: (
    db: Database.Database,
    apiKey: string,
    appId: string,
    storeNumber: string,
    onProgress?: (progress: FetchProgress) => void
  ) => Promise<RefreshResult>;
  /** Injectable store database opener for testing */
  openStoreDatabaseFn?: (dataDir: string, storeNumber: string) => Database.Database;
  /** Injectable extract function for testing */
  extractFn?: () => Promise<KeyExtractionResult>;
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
 * Get the currently active store number from settings.db.
 */
export function getActiveStore(settingsDb: Database.Database): string | null {
  const row = settingsDb
    .prepare("SELECT value FROM settings WHERE key = 'active_store'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Set the active store number in settings.db.
 */
function setActiveStore(settingsDb: Database.Database, storeNumber: string): void {
  settingsDb.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('active_store', ?)"
  ).run(storeNumber);
}

/**
 * Check if a store exists in stores.db.
 */
function storeExists(storesDb: Database.Database, storeNumber: string): boolean {
  const exists = storesDb
    .prepare("SELECT 1 FROM stores WHERE store_number = ?")
    .get(storeNumber);
  return !!exists;
}

/**
 * Get product count from the store database.
 * With per-store databases, no store_number filter is needed.
 */
function getProductCount(storeDb: Database.Database): number {
  const row = storeDb
    .prepare("SELECT COUNT(*) as count FROM products")
    .get() as { count: number };
  return row.count;
}

interface ApiCredentials {
  apiKey: string;
  appId: string;
}

/**
 * Get the most recent API credentials from settings.db.
 */
function getApiCredentials(settingsDb: Database.Database): ApiCredentials | null {
  const row = settingsDb
    .prepare("SELECT key, app_id FROM api_keys ORDER BY id DESC LIMIT 1")
    .get() as { key: string; app_id: string } | undefined;
  return row ? { apiKey: row.key, appId: row.app_id } : null;
}

/**
 * Store an API key in settings.db.
 */
function storeApiKey(settingsDb: Database.Database, apiKey: string, appId: string): void {
  settingsDb.prepare(
    "INSERT INTO api_keys (key, app_id, extracted_at) VALUES (?, ?, ?)"
  ).run(apiKey, appId, new Date().toISOString());
}

/**
 * Clear all API credentials from settings.db.
 * Used when credentials are detected as expired/invalid.
 */
function clearApiCredentials(settingsDb: Database.Database): void {
  settingsDb.prepare("DELETE FROM api_keys").run();
}

/**
 * Check if an HTTP status code indicates an authentication failure (401/403).
 */
function isAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * Get or extract API credentials. Extracts new ones if none exist.
 */
async function ensureApiCredentials(
  settingsDb: Database.Database,
  extractFn?: () => Promise<KeyExtractionResult>,
  onProgress?: (progress: FetchProgress) => void
): Promise<ApiCredentials | null> {
  // Try existing credentials first
  const existing = getApiCredentials(settingsDb);
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

  const extract = extractFn ?? (() => extractAlgoliaKey({ timeout: 60000 }));
  const result = await extract();

  if (!result.success || !result.apiKey || !result.appId) {
    return null;
  }

  // Store the credentials
  storeApiKey(settingsDb, result.apiKey, result.appId);

  onProgress?.({
    phase: "planning",
    current: 0,
    total: 0,
    message: "API credentials extracted successfully",
  });

  return { apiKey: result.apiKey, appId: result.appId };
}

/**
 * Default implementation for opening a store database.
 */
function defaultOpenStoreDatabase(dataDir: string, storeNumber: string): Database.Database {
  const storePath = join(dataDir, "stores", `${storeNumber}.db`);
  const storeDb = new DatabaseImpl(storePath);
  storeDb.pragma("foreign_keys = ON");
  initializeStoreDataSchema(storeDb);
  return storeDb;
}

/**
 * Set the active store and optionally refresh the catalog.
 * Automatically extracts API key if needed.
 *
 * Multi-database architecture:
 * - Validates store exists in stores.db
 * - Opens store-specific database (stores/{storeNumber}.db)
 * - Stores active_store in settings.db
 * - Gets API credentials from settings.db
 * - Refreshes catalog against store database
 *
 * @param dataDir - Base directory for all database files
 * @param settingsDb - Settings database connection
 * @param storesDb - Stores database connection
 * @param options - Set store options
 * @returns Result with success status
 */
export async function setStoreTool(
  dataDir: string,
  settingsDb: Database.Database,
  storesDb: Database.Database,
  options: SetStoreOptions
): Promise<SetStoreResult> {
  const {
    storeNumber,
    forceRefresh = false,
    onProgress,
    refreshCatalogFn = refreshCatalog,
    openStoreDatabaseFn = defaultOpenStoreDatabase,
    extractFn,
  } = options;

  let storeDb: Database.Database | null = null;

  try {
    // Validate store exists in stores.db
    if (!storeExists(storesDb, storeNumber)) {
      return {
        success: false,
        storeNumber,
        refreshed: false,
        productCount: 0,
        error: `Store ${storeNumber} not found in stores database`,
      };
    }

    // Open store-specific database
    storeDb = openStoreDatabaseFn(dataDir, storeNumber);

    // Set as active store in settings.db
    setActiveStore(settingsDb, storeNumber);

    // Check if catalog needs refresh for this store
    const status = getCatalogStatus(storeDb);
    const productCount = getProductCount(storeDb);
    const needsRefresh = forceRefresh || productCount === 0 || status.isStale;

    if (needsRefresh) {
      // Get or extract API credentials from settings.db
      const credentials = await ensureApiCredentials(settingsDb, extractFn, onProgress);
      if (!credentials) {
        return {
          success: false,
          storeNumber,
          refreshed: false,
          productCount,
          error: "Failed to extract API credentials from Wegmans website",
        };
      }

      const result = await refreshCatalogFn(
        storeDb,
        credentials.apiKey,
        credentials.appId,
        storeNumber,
        onProgress
      );

      if (!result.success) {
        // Check if this is an auth error (401/403) - credentials may be expired
        if (isAuthError(result.status)) {
          // Clear old credentials and try extracting fresh ones
          clearApiCredentials(settingsDb);

          onProgress?.({
            phase: "planning",
            current: 0,
            total: 0,
            message: "API credentials expired, extracting fresh credentials...",
          });

          const freshCredentials = await ensureApiCredentials(settingsDb, extractFn, onProgress);
          if (!freshCredentials) {
            return {
              success: false,
              storeNumber,
              refreshed: false,
              productCount,
              error: "Failed to extract fresh API credentials after auth error",
            };
          }

          // Retry with fresh credentials
          const retryResult = await refreshCatalogFn(
            storeDb,
            freshCredentials.apiKey,
            freshCredentials.appId,
            storeNumber,
            onProgress
          );

          if (!retryResult.success) {
            return {
              success: false,
              storeNumber,
              refreshed: false,
              productCount,
              error: retryResult.error,
            };
          }

          return {
            success: true,
            storeNumber,
            refreshed: true,
            productCount: getProductCount(storeDb),
          };
        }

        return {
          success: false,
          storeNumber,
          refreshed: false,
          productCount,
          error: result.error,
        };
      }

      return {
        success: true,
        storeNumber,
        refreshed: true,
        productCount: getProductCount(storeDb),
      };
    }

    return {
      success: true,
      storeNumber,
      refreshed: false,
      productCount,
    };
  } catch (err) {
    return {
      success: false,
      storeNumber,
      refreshed: false,
      productCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Always close the database we opened to avoid leaking connections.
    // In production, the caller (index.ts) re-opens via openStoreDatabase()
    // after a successful setStore - this double open is intentional to allow
    // dependency injection for testing while keeping the global connection
    // manager as the source of truth for active connections.
    if (storeDb) {
      storeDb.close();
    }
  }
}
