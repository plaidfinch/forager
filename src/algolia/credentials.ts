/**
 * Algolia API credential management.
 *
 * Reads, stores, and refreshes API credentials in settings.db.
 */

import type Database from "better-sqlite3";
import {
  extractAlgoliaKey,
  type KeyExtractionResult,
} from "./keyExtractor.js";
import type { FetchProgress } from "../catalog/index.js";

export interface ApiCredentials {
  apiKey: string;
  appId: string;
}

/**
 * Get the most recent API credentials from settings.db.
 */
export function getApiCredentials(settingsDb: Database.Database): ApiCredentials | null {
  const row = settingsDb
    .prepare("SELECT key, app_id FROM api_keys ORDER BY id DESC LIMIT 1")
    .get() as { key: string; app_id: string } | undefined;
  return row ? { apiKey: row.key, appId: row.app_id } : null;
}

/**
 * Store API credentials in settings.db.
 */
export function storeApiKey(settingsDb: Database.Database, apiKey: string, appId: string): void {
  settingsDb.prepare(
    "INSERT INTO api_keys (key, app_id, extracted_at) VALUES (?, ?, ?)"
  ).run(apiKey, appId, new Date().toISOString());
}

/**
 * Clear all API credentials from settings.db.
 * Used when credentials are detected as expired/invalid.
 */
export function clearApiCredentials(settingsDb: Database.Database): void {
  settingsDb.prepare("DELETE FROM api_keys").run();
}

/**
 * Check if an HTTP status code indicates an authentication failure (401/403).
 */
export function isAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * Get or extract API credentials. Extracts new ones if none exist.
 */
export async function ensureApiCredentials(
  settingsDb: Database.Database,
  extractFn?: () => Promise<KeyExtractionResult>,
  onProgress?: (progress: FetchProgress) => void,
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
