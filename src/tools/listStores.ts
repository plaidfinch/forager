/**
 * List stores tool for discovering Wegmans store numbers.
 *
 * Fetches stores from Wegmans API with 24h caching.
 */

import type Database from "better-sqlite3";
import {
  getStores,
  getStoresFromCache,
  type StoreInfo,
} from "../stores/fetch.js";

export type { StoreInfo } from "../stores/fetch.js";

export interface ListStoresResult {
  success: boolean;
  stores: StoreInfo[];
  activeStore: string | null;
  fromCache?: boolean;
  message?: string;
  error?: string;
}

/**
 * Get the currently active store number.
 */
function getActiveStore(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'active_store'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * List available Wegmans stores.
 *
 * Fetches from Wegmans API if cache is empty or stale (>24h).
 * Falls back to cached data if fetch fails.
 *
 * @param db - Database connection
 * @param showAll - If true, fetch all stores. If false, only show cached stores (default: true)
 * @returns List of stores
 */
export async function listStoresTool(
  db: Database.Database,
  showAll: boolean = true
): Promise<ListStoresResult> {
  try {
    const activeStore = getActiveStore(db);

    if (!showAll) {
      // Only return cached stores without fetching
      const cached = getStoresFromCache(db);
      return {
        success: true,
        stores: cached,
        activeStore,
        fromCache: true,
        message: cached.length > 0
          ? `${cached.length} store(s) in cache. Use showAll=true to fetch latest.`
          : "No stores in cache. Use showAll=true to fetch from Wegmans.",
      };
    }

    // Fetch stores (from cache if fresh, from API if stale)
    const { stores, fromCache, error } = await getStores(db);

    return {
      success: true,
      stores,
      activeStore,
      fromCache,
      message: error
        ? `${stores.length} stores (${error})`
        : `${stores.length} stores${fromCache ? " (cached)" : " (fetched)"}`,
    };
  } catch (err) {
    return {
      success: false,
      stores: [],
      activeStore: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
