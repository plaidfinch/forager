/**
 * Binary search for optimal CONCURRENCY value in fetchCatalog.
 *
 * Tests different concurrency levels and measures wall-clock time.
 * Reports the point of diminishing returns.
 *
 * Usage:
 *   npx tsx bench/concurrency-search.ts
 */

import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { homedir } from "node:os";
import DatabaseImpl from "better-sqlite3";
import { ensureApiCredentials } from "../src/algolia/credentials.js";

// We need to re-implement fetchCatalog inline with a configurable concurrency
// parameter, since the module constant isn't configurable.
// Instead, we'll patch the module by dynamically importing and testing.

// Actually, the cleanest approach: copy the core fetch logic here with
// concurrency as a parameter.

const STORE_NUMBER = "30";
const MAX_HITS_PER_QUERY = 1000;
const MAX_BACKOFF_MS = 30000;

function getDataDir(): string {
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) return join(xdgDataHome, "forager");
  return join(homedir(), ".local", "share", "forager");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AlgoliaResult {
  hits: Array<{ objectID: string; [key: string]: unknown }>;
  nbHits: number;
  facets?: Record<string, Record<string, number>>;
}

interface AlgoliaResponse {
  results: AlgoliaResult[];
}

type QueryResult =
  | { success: true; status: number; result: AlgoliaResult }
  | { success: false; status: number; error: string };

interface SplitTask {
  name: string;
  filter: string | null;
}

async function algoliaQuery(
  apiKey: string,
  appId: string,
  storeNumber: string,
  options: { filters?: string; hitsPerPage?: number; facets?: string[] },
): Promise<QueryResult> {
  const baseFilters = `storeNumber:${storeNumber} AND isSoldAtStore:true`;
  const filters = options.filters
    ? `${baseFilters} AND ${options.filters}`
    : baseFilters;

  try {
    const response = await fetch(
      `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Algolia-API-Key": apiKey,
          "X-Algolia-Application-Id": appId,
        },
        body: JSON.stringify({
          requests: [
            {
              indexName: "products",
              query: "",
              filters,
              hitsPerPage: options.hitsPerPage ?? 20,
              facets: options.facets ?? [],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      return { success: false, status: response.status, error: `${response.status}` };
    }

    const data = (await response.json()) as AlgoliaResponse;
    const result = data.results[0];
    if (!result) return { success: false, status: 200, error: "No results" };
    return { success: true, status: 200, result };
  } catch (err) {
    return { success: false, status: 0, error: String(err) };
  }
}

function findBestSplit(
  facets: Record<string, Record<string, number>>,
  currentCount: number,
): { attr: string; values: Array<{ value: string; count: number }> } | null {
  const priorityAttrs = [
    "categories.lvl0", "categories.lvl1", "categories.lvl2", "categories.lvl3",
    "ebtEligible", "isAvailable", "isLoyalty", "isAlcoholItem", "hasOffers",
  ];
  for (const attr of priorityAttrs) {
    const values = facets[attr];
    if (!values) continue;
    const valueCounts = Object.entries(values).map(([v, c]) => ({ value: v, count: c }));
    if (valueCounts.length < 2 || valueCounts.length > 30) continue;
    const maxBucket = Math.max(...valueCounts.map((v) => v.count));
    if (maxBucket >= currentCount) continue;
    return { attr, values: valueCounts };
  }
  return null;
}

/**
 * Build the query plan (always concurrent, CONCURRENCY=30 for planning).
 * We only need to build it once — the plan is the same regardless of fetch concurrency.
 */
async function buildPlan(
  apiKey: string,
  appId: string,
  storeNumber: string,
): Promise<SplitTask[]> {
  const PLAN_CONCURRENCY = 30;
  const queue: SplitTask[] = [{ name: "root", filter: null }];
  const ready: SplitTask[] = [];
  let inflight = 0;
  let iterations = 0;
  const maxIterations = 500;

  let wakeWorkers: () => void;
  let workerWait: Promise<void> = new Promise((r) => { wakeWorkers = r; });
  function signalQueue() {
    wakeWorkers();
    workerWait = new Promise((r) => { wakeWorkers = r; });
  }

  let firstError: unknown = null;

  async function worker() {
    while (true) {
      if (firstError) return;
      const task = queue.shift();
      if (!task) {
        if (inflight === 0) return;
        await workerWait;
        continue;
      }
      if (iterations >= maxIterations) { ready.push(task); continue; }

      inflight++;
      iterations++;

      try {
        const r = await algoliaQuery(apiKey, appId, storeNumber, {
          ...(task.filter ? { filters: task.filter } : {}),
          hitsPerPage: 0,
          facets: ["*"],
        });
        if (!r.success) throw new Error(r.error);
        const count = r.result.nbHits;
        if (count === 0) { inflight--; if (queue.length === 0 && inflight === 0) signalQueue(); continue; }
        if (count <= MAX_HITS_PER_QUERY) { ready.push(task); inflight--; if (queue.length === 0 && inflight === 0) signalQueue(); continue; }

        const split = findBestSplit(r.result.facets ?? {}, count);
        if (!split) { ready.push(task); inflight--; if (queue.length === 0 && inflight === 0) signalQueue(); continue; }

        const coveredCount = split.values.reduce((sum, v) => sum + v.count, 0);
        for (const { value } of split.values) {
          const qv = value.includes(" ") ? `"${value}"` : value;
          queue.push({ name: `${split.attr}:${value}`, filter: task.filter ? `${task.filter} AND ${split.attr}:${qv}` : `${split.attr}:${qv}` });
        }
        if (count - coveredCount > 0) {
          const notClauses = split.values.map(({ value }) => { const qv = value.includes(" ") ? `"${value}"` : value; return `NOT ${split.attr}:${qv}`; }).join(" AND ");
          queue.push({ name: `NOT ${split.attr}`, filter: task.filter ? `${task.filter} AND ${notClauses}` : notClauses });
        }
        signalQueue();
      } catch (err) {
        if (!firstError) firstError = err;
        inflight--;
        signalQueue();
        return;
      }
      inflight--;
      if (queue.length === 0 && inflight === 0) signalQueue();
    }
  }

  // Warm up
  await algoliaQuery(apiKey, appId, storeNumber, { hitsPerPage: 0, facets: ["*"] });

  await Promise.all(Array.from({ length: PLAN_CONCURRENCY }, () => worker()));
  if (firstError) throw firstError;
  return ready;
}

/**
 * Execute fetch phase with a specific concurrency level.
 * Returns { elapsed, hits, rate429Count }.
 */
async function fetchWithConcurrency(
  apiKey: string,
  appId: string,
  storeNumber: string,
  plan: SplitTask[],
  concurrency: number,
): Promise<{ elapsed: number; hits: number; rate429Count: number }> {
  const taskQueue = [...plan];
  let hits = 0;
  let rate429Count = 0;

  const t0 = performance.now();

  async function fetchWorker() {
    while (true) {
      const task = taskQueue.shift();
      if (!task) return;

      let backoff = 0;
      let result: QueryResult;

      while (true) {
        result = await algoliaQuery(apiKey, appId, storeNumber, {
          ...(task.filter ? { filters: task.filter } : {}),
          hitsPerPage: MAX_HITS_PER_QUERY,
        });

        if (result.status === 429) {
          rate429Count++;
          backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
          await sleep(backoff);
          continue;
        }
        break;
      }

      if (result.success) {
        hits += result.result.hits.length;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.length) }, () => fetchWorker()),
  );

  const elapsed = performance.now() - t0;
  return { elapsed, hits, rate429Count };
}

async function main() {
  const dataDir = getDataDir();
  const settingsPath = join(dataDir, "settings.db");
  const db = new DatabaseImpl(settingsPath);
  const creds = await ensureApiCredentials(db);
  db.close();

  if (!creds) {
    console.error("Failed to obtain API credentials");
    process.exit(1);
  }

  console.log(`Building query plan for store ${STORE_NUMBER}...`);
  const plan = await buildPlan(creds.apiKey, creds.appId, STORE_NUMBER);
  console.log(`Plan: ${plan.length} queries\n`);

  // Test concurrency levels: sweep from low to high
  const levels = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 224];

  console.log("Concurrency | Time (s) | Hits    | 429s | Queries/s");
  console.log("------------|----------|---------|------|----------");

  for (const c of levels) {
    // Brief cooldown between runs to avoid residual rate limiting
    await sleep(2000);

    const result = await fetchWithConcurrency(
      creds.apiKey, creds.appId, STORE_NUMBER, plan, c,
    );

    const timeSec = result.elapsed / 1000;
    const qps = (plan.length / timeSec).toFixed(1);

    console.log(
      `${String(c).padStart(11)} | ${timeSec.toFixed(2).padStart(8)} | ${String(result.hits).padStart(7)} | ${String(result.rate429Count).padStart(4)} | ${qps.padStart(9)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
