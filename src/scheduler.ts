/**
 * Background refresh scheduler.
 *
 * Proactively refreshes all databases (stores.db + per-store catalogs)
 * in the background, staggered evenly over the staleness window so
 * data stays fresh and traffic to Wegmans stays smooth.
 *
 * Uses a setTimeout chain (not setInterval) so the interval
 * recalculates between ticks as the number of loaded stores changes.
 *
 * Catalog refreshes are batched: all stale stores are refreshed in a
 * single fetchCatalogs call with a shared global worker pool.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getStoresDb } from "./db/connection.js";
import { isStoresCacheStale } from "./stores/fetch.js";
import { getCatalogStatus } from "./catalog/index.js";
import Database from "better-sqlite3";

export interface SchedulerOptions {
  dataDir: string;
  staleThresholdMs: number;
  triggerBackgroundRefresh: (key: string, fn: () => Promise<void>) => void;
  refreshStores: () => Promise<void>;
  refreshStoreCatalogs: (storeNumbers: string[], targetDurationMs?: number) => Promise<void>;
  log: (message: string) => void;
}

const STORES_KEY = "__stores__";
const CATALOGS_KEY = "__catalogs__";
const INITIAL_DELAY_MS = 60_000; // 1 minute after boot

let timer: ReturnType<typeof setTimeout> | null = null;
let schedulerOptions: SchedulerOptions | null = null;

/**
 * Compute interval between ticks.
 * Spreads N databases evenly across the staleness window.
 */
export function computeInterval(
  staleThresholdMs: number,
  dbCount: number,
): number {
  if (dbCount <= 0) return staleThresholdMs;
  return Math.floor(staleThresholdMs / dbCount);
}

/**
 * Count store database files in the stores/ directory.
 */
export function countStoreDbs(dataDir: string): number {
  try {
    const storesDir = join(dataDir, "stores");
    const files = readdirSync(storesDir);
    return files.filter(
      (f) => f.endsWith(".db") && !f.endsWith(".tmp"),
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Find all stale store numbers, sorted oldest-first.
 * Returns empty array if all stores are fresh.
 */
function findAllStale(dataDir: string): string[] {
  const stale: Array<{ storeNumber: string; time: number }> = [];

  try {
    const storesDir = join(dataDir, "stores");
    const files = readdirSync(storesDir);
    for (const file of files) {
      if (!file.endsWith(".db") || file.endsWith(".tmp")) continue;
      const storeNumber = file.replace(".db", "");
      try {
        const dbPath = join(storesDir, file);
        const db = new Database(dbPath, { readonly: true });
        try {
          const status = getCatalogStatus(db);
          if (status.isStale) {
            const time = status.lastUpdated ? status.lastUpdated.getTime() : 0;
            stale.push({ storeNumber, time });
          }
        } finally {
          db.close();
        }
      } catch {
        // Skip databases we can't read
      }
    }
  } catch {
    // stores directory not available
  }

  stale.sort((a, b) => a.time - b.time);
  return stale.map((s) => s.storeNumber);
}

/**
 * Execute one scheduler tick.
 * Checks stores.db staleness, then finds all stale catalogs and
 * triggers a batch refresh.
 */
function tick(): void {
  if (!schedulerOptions) return;

  const {
    dataDir,
    staleThresholdMs,
    triggerBackgroundRefresh,
    refreshStores,
    refreshStoreCatalogs,
    log,
  } = schedulerOptions;

  // Check stores.db first — it's critical infrastructure
  try {
    const storesDb = getStoresDb();
    if (isStoresCacheStale(storesDb)) {
      triggerBackgroundRefresh(STORES_KEY, async () => {
        await refreshStores();
        log("Scheduler: stores refreshed");
      });
    }
  } catch {
    // stores db not available
  }

  // Find all stale catalogs and refresh in one batch
  const staleStores = findAllStale(dataDir);
  if (staleStores.length > 0) {
    const targetDurationMs = Math.floor(staleThresholdMs / 2);
    triggerBackgroundRefresh(CATALOGS_KEY, async () => {
      await refreshStoreCatalogs(staleStores, targetDurationMs);
      log(`Scheduler: ${staleStores.length} store catalogs refreshed`);
    });
  }

  // Recalculate interval and schedule next tick
  const dbCount = countStoreDbs(dataDir) + 1; // +1 for stores.db
  const interval = computeInterval(staleThresholdMs, dbCount);
  timer = setTimeout(tick, interval);
}

/**
 * Start the background refresh scheduler.
 *
 * First tick is delayed ~60s to let startup settle.
 * Subsequent ticks are spaced at staleThresholdMs / N where
 * N is the number of databases.
 */
export function startScheduler(options: SchedulerOptions): void {
  stopScheduler();
  schedulerOptions = options;
  timer = setTimeout(tick, INITIAL_DELAY_MS);
}

/**
 * Stop the background refresh scheduler.
 */
export function stopScheduler(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  schedulerOptions = null;
}
