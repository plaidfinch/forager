/**
 * Tool for refreshing the Algolia API key via Playwright extraction.
 *
 * Used when the cached API key expires or becomes invalid. Launches
 * Playwright to extract a fresh key from the Wegmans website.
 */

import type Database from "better-sqlite3";
import {
  extractAlgoliaKey,
  type KeyExtractionResult,
} from "../algolia/keyExtractor.js";

export interface RefreshApiKeyOptions {
  headless?: boolean;
  timeout?: number;
  extractFn?: (
    options: { headless?: boolean; timeout?: number }
  ) => Promise<KeyExtractionResult>;
}

export interface RefreshApiKeyResult {
  success: boolean;
  apiKey?: string;
  error?: string;
}

/**
 * Extract a fresh API key and store it in the database.
 *
 * @param db - Database connection for storing the key
 * @param options - Configuration options
 * @returns Result with apiKey on success, or error on failure
 */
export async function refreshApiKeyTool(
  db: Database.Database,
  options: RefreshApiKeyOptions = {}
): Promise<RefreshApiKeyResult> {
  const {
    headless = true,
    timeout = 60000,
    extractFn = extractAlgoliaKey,
  } = options;

  // Extract key using provided function (or default extractAlgoliaKey)
  const extraction = await extractFn({ headless, timeout });

  if (!extraction.success || !extraction.apiKey) {
    return {
      success: false,
      error: extraction.error ?? "Failed to extract API key",
    };
  }

  // Store the key in the database
  const stmt = db.prepare(`
    INSERT INTO api_keys (key, app_id, extracted_at)
    VALUES (?, ?, ?)
  `);

  stmt.run(
    extraction.apiKey,
    extraction.appId ?? "",
    new Date().toISOString()
  );

  return {
    success: true,
    apiKey: extraction.apiKey,
  };
}
