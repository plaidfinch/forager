/**
 * Benchmark: fetch every store's catalog using fetchCatalogs.
 *
 * Uses a single global worker pool (2000 concurrent workers) that
 * interleaves planning and fetching across all stores.
 *
 * Usage:
 *   npx tsx bench/fetch-all-stores.ts
 */

import { performance } from "node:perf_hooks";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import DatabaseImpl from "better-sqlite3";
import { ensureApiCredentials } from "../src/algolia/credentials.js";
import { fetchCatalogs } from "../src/catalog/fetch.js";

function getDataDir(): string {
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) return join(xdgDataHome, "forager");
  return join(homedir(), ".local", "share", "forager");
}

async function main() {
  const dataDir = getDataDir();
  const logPath = join(dataDir, "bench-fetch-all.log");
  const log = createWriteStream(logPath);
  const logLine = (msg: string) => { log.write(msg + "\n"); };

  console.log(`Log: ${logPath}`);

  const settingsDb = new DatabaseImpl(join(dataDir, "settings.db"));
  const creds = await ensureApiCredentials(settingsDb);
  settingsDb.close();
  if (!creds) {
    console.error("Failed to obtain API credentials");
    process.exit(1);
  }

  const storesDb = new DatabaseImpl(join(dataDir, "stores.db"), { readonly: true });
  const stores = storesDb
    .prepare("SELECT store_number, name FROM stores ORDER BY store_number")
    .all() as Array<{ store_number: string; name: string }>;
  storesDb.close();

  const allStoreNumbers = stores.map((s) => s.store_number);

  console.log(`Fetching ${stores.length} stores...`);
  const t0 = performance.now();

  // Per-store timing and coverage
  const storeFirstBatch = new Map<string, number>();
  const storeFinished = new Map<string, number>();
  const storeExpected = new Map<string, number>();
  const storeFetched = new Map<string, number>();
  let storesCompleted = 0;
  let totalFetched = 0;
  let totalExpected = 0;
  let lastStatusMs = 0;
  let lastProgress = "";

  // Print status to stdout at most once per second
  function maybeStatus(force?: boolean) {
    const now = performance.now() - t0;
    if (!force && now - lastStatusMs < 1000) return;
    lastStatusMs = now;
    const secs = (now / 1000).toFixed(1);
    const line = `  ${secs}s  ${storesCompleted}/${stores.length} stores  ${totalFetched.toLocaleString()} products  ${lastProgress}`;
    console.log(line);
    logLine(line);
  }

  for await (const batch of fetchCatalogs(creds.apiKey, creds.appId, allStoreNumbers, {
    onProgress: (p) => { lastProgress = p.message; },
  })) {
    if ("hits" in batch) {
      if (!storeFirstBatch.has(batch.storeNumber)) {
        storeFirstBatch.set(batch.storeNumber, performance.now() - t0);
      }
      totalFetched += batch.hits.length;
    } else {
      storeFinished.set(batch.storeNumber, performance.now() - t0);
      storeExpected.set(batch.storeNumber, batch.expectedProducts);
      storeFetched.set(batch.storeNumber, batch.fetchedProducts);
      totalExpected += batch.expectedProducts;
      storesCompleted++;
    }
    maybeStatus();
  }
  maybeStatus(true);

  const elapsed = performance.now() - t0;

  // Per-store results
  const storeResults = stores.map((s) => ({
    storeNumber: s.store_number,
    name: s.name,
    expected: storeExpected.get(s.store_number) ?? 0,
    fetched: storeFetched.get(s.store_number) ?? 0,
    firstBatchMs: storeFirstBatch.get(s.store_number) ?? 0,
    finishedMs: storeFinished.get(s.store_number) ?? 0,
  }));

  // Timing distribution
  const finishTimes = storeResults.map((r) => r.finishedMs).sort((a, b) => a - b);
  const firstBatchTimes = storeResults.map((r) => r.firstBatchMs).filter(t => t > 0).sort((a, b) => a - b);

  const lines: string[] = [];
  const out = (msg: string) => { lines.push(msg); };

  out("\nFirst batch timing (when first hits arrived):");
  if (firstBatchTimes.length > 0) {
    out(`  p0:   ${(firstBatchTimes[0]! / 1000).toFixed(1)}s`);
    out(`  p50:  ${(firstBatchTimes[Math.floor(firstBatchTimes.length * 0.5)]! / 1000).toFixed(1)}s`);
    out(`  p90:  ${(firstBatchTimes[Math.floor(firstBatchTimes.length * 0.9)]! / 1000).toFixed(1)}s`);
    out(`  p100: ${(firstBatchTimes[firstBatchTimes.length - 1]! / 1000).toFixed(1)}s`);
  }

  out("\nStore completion timing:");
  out(`  p0:   ${(finishTimes[0]! / 1000).toFixed(1)}s`);
  out(`  p50:  ${(finishTimes[Math.floor(finishTimes.length * 0.5)]! / 1000).toFixed(1)}s`);
  out(`  p90:  ${(finishTimes[Math.floor(finishTimes.length * 0.9)]! / 1000).toFixed(1)}s`);
  out(`  p100: ${(finishTimes[finishTimes.length - 1]! / 1000).toFixed(1)}s`);

  const hdr =  "Store | Name                           | Expected | Fetched |    Pct | First batch | Finished";
  const rule = "------|--------------------------------|----------|---------|--------|-------------|--------";
  function storeRow(r: typeof storeResults[number]): string {
    const pct = r.expected > 0 ? ((r.fetched / r.expected) * 100).toFixed(1) : "N/A";
    return `${r.storeNumber.padStart(5)} | ${r.name.padEnd(30)} | ${String(r.expected).padStart(8)} | ${String(r.fetched).padStart(7)} | ${pct.padStart(5)}% | ${(r.firstBatchMs / 1000).toFixed(1).padStart(9)}s | ${(r.finishedMs / 1000).toFixed(1).padStart(6)}s`;
  }

  // Stores with coverage issues (sorted worst first)
  const underFetched = storeResults
    .filter((r) => r.expected > 0 && r.fetched < r.expected)
    .sort((a, b) => (a.fetched / a.expected) - (b.fetched / b.expected));
  if (underFetched.length > 0) {
    out(`\nStores with incomplete coverage (${underFetched.length}):`);
    out(hdr);
    out(rule);
    for (const r of underFetched) out(storeRow(r));
  }

  // Slowest 10 stores
  const byFinish = [...storeResults].sort((a, b) => b.finishedMs - a.finishedMs);
  out("\nSlowest 10 stores:");
  out(hdr);
  out(rule);
  for (const r of byFinish.slice(0, 10)) out(storeRow(r));

  // Fastest 10 stores
  const byFinishAsc = [...storeResults].sort((a, b) => a.finishedMs - b.finishedMs);
  out("\nFastest 10 stores:");
  out(hdr);
  out(rule);
  for (const r of byFinishAsc.slice(0, 10)) out(storeRow(r));

  const totalPct = totalExpected > 0 ? ((totalFetched / totalExpected) * 100).toFixed(1) : "N/A";

  out(`\nSummary:`);
  out(`  Stores:              ${stores.length}`);
  out(`  Expected products:   ${totalExpected.toLocaleString()}`);
  out(`  Fetched products:    ${totalFetched.toLocaleString()}`);
  out(`  Coverage:            ${totalPct}%`);
  out(`  Total wall time:     ${(elapsed / 1000).toFixed(1)}s`);

  // Write full report to log, print summary to stdout
  for (const line of lines) logLine(line);
  log.end();

  // Print summary to stdout
  console.log(`\nDone in ${(elapsed / 1000).toFixed(1)}s — ${totalFetched.toLocaleString()}/${totalExpected.toLocaleString()} products (${totalPct}%) across ${stores.length} stores`);
  if (underFetched.length > 0) {
    console.log(`  ${underFetched.length} stores with incomplete coverage — see ${logPath}`);
  }
  console.log(`Full report: ${logPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
