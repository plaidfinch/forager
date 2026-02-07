/**
 * Benchmark: time a full fetchCatalog call for a large store.
 *
 * Usage:
 *   npx tsx bench/fetch-catalog.ts
 *
 * Requires valid Algolia credentials in settings.db.
 * If none exist, extracts them from Wegmans website first.
 */

import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { homedir } from "node:os";
import DatabaseImpl from "better-sqlite3";
import { fetchCatalog } from "../src/catalog/fetch.js";
import { ensureApiCredentials } from "../src/algolia/credentials.js";

const STORE_NUMBER = "30"; // Fayetteville (large store)

function getDataDir(): string {
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) return join(xdgDataHome, "forager");
  return join(homedir(), ".local", "share", "forager");
}

async function main() {
  const dataDir = getDataDir();
  const settingsPath = join(dataDir, "settings.db");
  const db = new DatabaseImpl(settingsPath);

  const creds = await ensureApiCredentials(db, undefined, (p) => {
    process.stderr.write(`  ${p.message}\n`);
  });
  db.close();

  if (!creds) {
    console.error("Failed to obtain API credentials");
    process.exit(1);
  }

  console.log(`Benchmarking fetchCatalog for store ${STORE_NUMBER}...`);

  const t0 = performance.now();
  let batchCount = 0;
  let totalHits = 0;

  for await (const batch of fetchCatalog(creds.apiKey, creds.appId, STORE_NUMBER, (p) => {
    process.stderr.write(`\r  ${p.message}`);
  })) {
    batchCount++;
    totalHits += batch.length;
  }

  const elapsed = performance.now() - t0;
  console.log(`\n\nResults:`);
  console.log(`  Store:       ${STORE_NUMBER}`);
  console.log(`  Batches:     ${batchCount}`);
  console.log(`  Total hits:  ${totalHits}`);
  console.log(`  Wall time:   ${(elapsed / 1000).toFixed(2)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
