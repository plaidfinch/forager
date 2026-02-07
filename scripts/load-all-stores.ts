/**
 * Load product catalogs for all Wegmans stores concurrently.
 *
 * Usage: npx tsx scripts/load-all-stores.ts [concurrency]
 *
 * Each store fetch already uses 30 concurrent Algolia requests internally,
 * so keep store-level concurrency low to avoid rate limiting.
 * Default: 3 concurrent stores.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { refreshCatalogToFile } from "../src/catalog/index.js";
import { extractAlgoliaKey } from "../src/algolia/keyExtractor.js";
import {
  initializeSettingsSchema,
  initializeStoresSchema,
} from "../src/db/schema.js";

const CONCURRENCY = parseInt(process.argv[2] ?? "3", 10);

function getDataDir(): string {
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) return join(xdgDataHome, "forager");
  return join(homedir(), ".local", "share", "forager");
}

interface StoreResult {
  storeNumber: string;
  success: boolean;
  productCount?: number;
  error?: string;
  durationMs: number;
}

async function main() {
  const dataDir = getDataDir();
  const storesDir = join(dataDir, "stores");
  if (!existsSync(storesDir)) {
    mkdirSync(storesDir, { recursive: true });
  }

  // Open shared databases
  const settingsDb = new Database(join(dataDir, "settings.db"));
  settingsDb.pragma("foreign_keys = ON");
  initializeSettingsSchema(settingsDb);

  const storesDb = new Database(join(dataDir, "stores.db"));
  storesDb.pragma("foreign_keys = ON");
  initializeStoresSchema(storesDb);

  // Get all store numbers
  const stores = storesDb
    .prepare("SELECT store_number FROM stores ORDER BY CAST(store_number AS INTEGER)")
    .all() as { store_number: string }[];

  console.log(`Found ${stores.length} stores, concurrency=${CONCURRENCY}`);

  // Extract API credentials once
  console.log("Extracting Algolia API credentials...");
  const keyResult = await extractAlgoliaKey({ timeout: 60000 });
  if (!keyResult.success || !keyResult.apiKey || !keyResult.appId) {
    console.error("Failed to extract API credentials");
    process.exit(1);
  }
  const { apiKey, appId } = keyResult;
  console.log("API credentials extracted successfully\n");

  // Process stores with bounded concurrency
  const results: StoreResult[] = [];
  let completed = 0;

  async function processStore(storeNumber: string): Promise<StoreResult> {
    const start = Date.now();
    const storePath = join(storesDir, `${storeNumber}.db`);

    try {
      // Skip if already populated
      if (existsSync(storePath)) {
        const storeDb = new Database(storePath, { readonly: true });
        try {
          const existing = (storeDb.prepare("SELECT COUNT(*) as c FROM products").get() as { c: number }).c;
          if (existing > 0) {
            completed++;
            const durationMs = Date.now() - start;
            console.log(`[${completed}/${stores.length}] Store ${storeNumber}: ${existing} products (skipped)`);
            return { storeNumber, success: true, productCount: existing, durationMs };
          }
        } finally {
          storeDb.close();
        }
      }

      // Atomic refresh: write to temp file, then rename
      const result = await refreshCatalogToFile(storePath, apiKey, appId, storeNumber);
      const durationMs = Date.now() - start;

      if (result.success) {
        completed++;
        console.log(
          `[${completed}/${stores.length}] Store ${storeNumber}: ${result.productsAdded} products (${(durationMs / 1000).toFixed(1)}s)`
        );
        return { storeNumber, success: true, productCount: result.productsAdded, durationMs };
      } else {
        completed++;
        console.error(`[${completed}/${stores.length}] Store ${storeNumber}: FAILED - ${result.error} (${(durationMs / 1000).toFixed(1)}s)`);
        return { storeNumber, success: false, error: result.error, durationMs };
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      completed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${completed}/${stores.length}] Store ${storeNumber}: ERROR - ${msg} (${(durationMs / 1000).toFixed(1)}s)`);
      return { storeNumber, success: false, error: msg, durationMs };
    }
  }

  // Semaphore-based concurrency pool
  const allStoreNumbers = stores.map((s) => s.store_number);
  const running = new Set<Promise<StoreResult>>();

  for (const storeNumber of allStoreNumbers) {
    while (running.size >= CONCURRENCY) {
      await Promise.race(running);
    }

    const promise = processStore(storeNumber).then((result) => {
      running.delete(promise);
      results.push(result);
      return result;
    });
    running.add(promise);
  }

  // Wait for remaining
  await Promise.all(running);

  // Summary
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalProducts = succeeded.reduce((sum, r) => sum + (r.productCount ?? 0), 0);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log("\n=== Summary ===");
  console.log(`Succeeded: ${succeeded.length}/${results.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Total products: ${totalProducts.toLocaleString()}`);
  console.log(`Total wall time: ${(totalDuration / 1000 / 60).toFixed(1)} store-minutes`);

  if (failed.length > 0) {
    console.log("\nFailed stores:");
    for (const f of failed) {
      console.log(`  Store ${f.storeNumber}: ${f.error}`);
    }
  }

  // Cleanup
  settingsDb.close();
  storesDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
