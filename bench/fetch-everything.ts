/**
 * Clear all data and re-fetch everything from scratch, timed.
 *
 * Usage:
 *   npx tsx bench/fetch-everything.ts
 */

import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import DatabaseImpl from "better-sqlite3";
import { initializeSettingsSchema } from "../src/db/schema.js";
import { ensureApiCredentials } from "../src/algolia/credentials.js";
import { refreshStoresToFile } from "../src/stores/fetch.js";
import { refreshCatalogsToFile } from "../src/catalog/index.js";

function getDataDir(): string {
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) return join(xdgDataHome, "forager");
  return join(homedir(), ".local", "share", "forager");
}

async function main() {
  const dataDir = getDataDir();
  const t0 = performance.now();

  // 1. Clear everything
  console.log(`Clearing ${dataDir}...`);
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
  }
  mkdirSync(join(dataDir, "stores"), { recursive: true });
  console.log("  Done.\n");

  // 2. Initialize settings.db and get credentials
  console.log("Extracting API credentials...");
  const credT0 = performance.now();
  const settingsDb = new DatabaseImpl(join(dataDir, "settings.db"));
  initializeSettingsSchema(settingsDb);
  const creds = await ensureApiCredentials(settingsDb, undefined, (p) => {
    process.stderr.write(`  ${p.message}\n`);
  });
  settingsDb.close();
  if (!creds) {
    console.error("Failed to obtain API credentials");
    process.exit(1);
  }
  const credElapsed = performance.now() - credT0;
  console.log(`  Credentials obtained in ${(credElapsed / 1000).toFixed(1)}s\n`);

  // 3. Fetch stores
  console.log("Fetching stores...");
  const storesT0 = performance.now();
  const storesPath = join(dataDir, "stores.db");
  const storesList = await refreshStoresToFile(storesPath);
  const storesElapsed = performance.now() - storesT0;
  console.log(`  ${storesList.length} stores fetched in ${(storesElapsed / 1000).toFixed(1)}s\n`);

  // 4. Fetch all catalogs
  const storeNumbers = storesList.map((s) => s.storeNumber);
  console.log(`Fetching catalogs for ${storeNumbers.length} stores (fast mode, 100 workers)...`);
  const catT0 = performance.now();

  let lastMsg = "";
  const results = await refreshCatalogsToFile(
    join(dataDir, "stores"),
    creds.apiKey,
    creds.appId,
    storeNumbers,
    (p) => {
      const msg = p.message;
      if (msg !== lastMsg) {
        process.stderr.write(`\r  ${msg}                    `);
        lastMsg = msg;
      }
    },
  );
  const catElapsed = performance.now() - catT0;
  process.stderr.write("\n");

  // Summarize results
  let successCount = 0;
  let failCount = 0;
  let totalProducts = 0;
  for (const [, result] of results) {
    if (result.success) {
      successCount++;
      totalProducts += result.productsAdded;
    } else {
      failCount++;
      console.error(`  FAIL: ${result.error}`);
    }
  }

  const totalElapsed = performance.now() - t0;

  console.log(`\nResults:`);
  console.log(`  Stores:           ${storesList.length}`);
  console.log(`  Catalogs OK:      ${successCount}`);
  console.log(`  Catalogs failed:  ${failCount}`);
  console.log(`  Total products:   ${totalProducts.toLocaleString()}`);
  console.log(`\nTiming:`);
  console.log(`  Credentials:      ${(credElapsed / 1000).toFixed(1)}s`);
  console.log(`  Stores fetch:     ${(storesElapsed / 1000).toFixed(1)}s`);
  console.log(`  Catalog fetch:    ${(catElapsed / 1000).toFixed(1)}s`);
  console.log(`  Total wall time:  ${(totalElapsed / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
