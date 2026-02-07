/**
 * Catalog first-load logic.
 *
 * Ensures a store catalog exists by extracting credentials if needed
 * and refreshing the catalog, with automatic auth-retry on 401/403.
 */

import type Database from "better-sqlite3";
import { join } from "node:path";
import {
  ensureApiCredentials,
  clearApiCredentials,
  isAuthError,
  type ApiCredentials,
} from "../algolia/credentials.js";
import {
  refreshCatalogToFile,
  type FetchProgress,
  type RefreshResult,
} from "./index.js";
import type { KeyExtractionResult } from "../algolia/keyExtractor.js";

export interface EnsureCatalogOptions {
  onProgress?: (progress: FetchProgress) => void;
  extractFn?: () => Promise<KeyExtractionResult>;
  refreshCatalogFn?: (
    targetPath: string,
    apiKey: string,
    appId: string,
    storeNumber: string,
    onProgress?: (progress: FetchProgress) => void,
  ) => Promise<RefreshResult>;
}

export type EnsureCatalogResult =
  | { success: true; productCount: number }
  | { success: false; error: string };

export async function ensureCatalog(
  dataDir: string,
  settingsDb: Database.Database,
  storeNumber: string,
  options?: EnsureCatalogOptions,
): Promise<EnsureCatalogResult> {
  const { onProgress, extractFn, refreshCatalogFn = refreshCatalogToFile } = options ?? {};

  // 1. Get credentials
  const credentials = await ensureApiCredentials(settingsDb, extractFn, onProgress);
  if (!credentials) {
    return { success: false, error: "Failed to extract API credentials" };
  }

  // 2. Build store path
  const storePath = join(dataDir, "stores", `${storeNumber}.db`);

  // 3. Attempt refresh
  const doRefresh = async (creds: ApiCredentials): Promise<RefreshResult> => {
    return refreshCatalogFn(storePath, creds.apiKey, creds.appId, storeNumber, onProgress);
  };

  const result = await doRefresh(credentials);

  if (result.success) {
    return { success: true, productCount: result.productsAdded };
  }

  // 4. Auth retry on 401/403
  if (!result.success && isAuthError(result.status)) {
    clearApiCredentials(settingsDb);

    onProgress?.({
      phase: "planning",
      current: 0,
      total: 0,
      message: "API credentials expired, extracting fresh credentials...",
    });

    const freshCreds = await ensureApiCredentials(settingsDb, extractFn, onProgress);
    if (!freshCreds) {
      return { success: false, error: "Failed to extract fresh API credentials after auth error" };
    }

    const retryResult = await doRefresh(freshCreds);
    if (retryResult.success) {
      return { success: true, productCount: retryResult.productsAdded };
    }
    return { success: false, error: retryResult.error };
  }

  // 5. Non-auth error -- no retry
  return { success: false, error: result.error };
}
