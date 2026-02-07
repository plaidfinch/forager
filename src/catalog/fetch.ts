/**
 * Catalog fetching logic for full product scrape.
 *
 * Fetches the complete Wegmans product catalog using dynamic splitting
 * to work around the 1000 result limit.
 *
 * Two modes:
 * - fetchCatalog: single-store (thin wrapper around fetchCatalogs)
 * - fetchCatalogs: multi-store with unified global worker pool
 *
 * Two pacing modes controlled by `targetDurationMs`:
 * - Fast (undefined): 2000 concurrent workers, zero delays
 * - Slow (set): 1 worker, inter-task delay = targetDurationMs / knownTotalTasks
 */

import { Agent, setGlobalDispatcher } from "undici";

// Use a pool of 256 keep-alive connections rather than undici's default ~128.
// Workers beyond 256 queue internally in undici waiting for a free socket,
// which reuses existing TLS sessions instead of stampeding new handshakes.
setGlobalDispatcher(new Agent({ connections: 256 }));

/**
 * Algolia enforces a hard limit of 1000 results per query.
 * Queries returning more must be split using facet filters.
 */
const MAX_HITS_PER_QUERY = 1000;

/**
 * Build the Algolia API URL for a given app ID.
 */
function getAlgoliaUrl(appId: string): string {
  return `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
}

/**
 * Number of concurrent workers in fast mode.
 */
const CONCURRENCY = 2000;

/**
 * Maximum backoff delay when rate limited or retrying (milliseconds).
 */
const MAX_BACKOFF_MS = 30000;

/**
 * Maximum retries for transient network errors (status 0 = fetch failed).
 */
const MAX_TRANSIENT_RETRIES = 5;

/**
 * Maximum planning iterations per store to prevent runaway splits.
 */
const MAX_PLAN_ITERATIONS = 500;

export interface AlgoliaHit {
  objectID: string;
  productId?: string;
  productID?: string;
  [key: string]: unknown;
}

interface AlgoliaResult {
  hits: AlgoliaHit[];
  nbHits: number;
  facets?: Record<string, Record<string, number>>;
}

interface AlgoliaResponse {
  results: AlgoliaResult[];
}

interface QueryOptions {
  query?: string;
  filters?: string;
  hitsPerPage?: number;
  facets?: string[];
}

type QueryResult =
  | { success: true; status: number; result: AlgoliaResult }
  | { success: false; status: number; error: string };

interface SplitTask {
  name: string;
  filter: string | null;
}

/**
 * Custom error class that preserves HTTP status code from Algolia responses.
 */
export class AlgoliaError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AlgoliaError";
  }
}

export interface FetchProgress {
  phase: "planning" | "fetching";
  current: number;
  total: number;
  message: string;
}

export interface FetchSummary {
  queryCount: number;
  totalProducts: number;
}

export type CatalogBatch =
  | { storeNumber: string; hits: AlgoliaHit[] }
  | { storeNumber: string; done: true; expectedProducts: number; fetchedProducts: number };

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function algoliaQueryWithStatus(
  apiKey: string,
  appId: string,
  storeNumber: string,
  options: QueryOptions
): Promise<QueryResult> {
  const baseFilters = `storeNumber:${storeNumber} AND isSoldAtStore:true`;
  const filters = options.filters
    ? `${baseFilters} AND ${options.filters}`
    : baseFilters;

  try {
    const response = await fetch(getAlgoliaUrl(appId), {
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
            query: options.query ?? "",
            filters,
            hitsPerPage: options.hitsPerPage ?? 20,
            facets: options.facets ?? [],
          },
        ],
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: `Algolia error: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as AlgoliaResponse;
    const result = data.results[0];
    if (!result) {
      return {
        success: false,
        status: 200,
        error: "No results returned from Algolia",
      };
    }
    return {
      success: true,
      status: 200,
      result,
    };
  } catch (err) {
    return {
      success: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function algoliaQuery(
  apiKey: string,
  appId: string,
  storeNumber: string,
  options: QueryOptions
): Promise<AlgoliaResult> {
  let backoff = 0;
  for (let attempt = 0; ; attempt++) {
    const result = await algoliaQueryWithStatus(apiKey, appId, storeNumber, options);
    if (result.success) return result.result;

    // Retry transient network errors (status 0) and rate limits (429)
    if ((result.status === 0 || result.status === 429) && attempt < MAX_TRANSIENT_RETRIES) {
      backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
      await sleep(backoff);
      continue;
    }

    throw new AlgoliaError(result.error, result.status);
  }
}

/**
 * Find the best facet to split on for a given result set.
 *
 * Strategy:
 * 1. Try preferred attributes first (low cardinality, clean splits).
 * 2. Fall back to any non-skipped facet, preferring fewer values
 *    (fewer child tasks = less overhead).
 */
function findBestSplit(
  facets: Record<string, Record<string, number>>,
  currentCount: number
): { attr: string; values: Array<{ value: string; count: number }> } | null {
  const preferredAttrs = [
    "categories.lvl0",
    "categories.lvl1",
    "categories.lvl2",
    "categories.lvl3",
    "ebtEligible",
    "isAvailable",
    "isLoyalty",
    "isAlcoholItem",
    "hasOffers",
  ];

  // Attributes that are useless for splitting (single-valued per store,
  // truncated at 1000 values, or produce unstable filters).
  const skipAttrs = new Set([
    "storeNumber",
    "fulfilmentType",
    "digitalCouponsOfferIds",
    "category.key",
    "category.seo",
    "categoryPageId",
    "filterTags",
    "popularTags",
    "keywords",
    "discountType",
    "maxQuantity",
  ]);

  /** Check whether an attribute's facet values produce a useful split. */
  function tryAttr(attr: string, maxValues: number):
    { attr: string; values: Array<{ value: string; count: number }> } | null {
    const values = facets[attr];
    if (!values) return null;

    const valueCounts = Object.entries(values).map(([v, c]) => ({
      value: v,
      count: c,
    }));

    if (valueCounts.length < 2) return null;
    if (valueCounts.length > maxValues) return null;

    const maxBucket = Math.max(...valueCounts.map((v) => v.count));
    if (maxBucket >= currentCount) return null;

    return { attr, values: valueCounts };
  }

  // Pass 1: preferred attributes with a tight cardinality cap
  for (const attr of preferredAttrs) {
    const result = tryAttr(attr, 30);
    if (result) return result;
  }

  // Pass 2: preferred attributes again, allowing higher cardinality
  for (const attr of preferredAttrs) {
    const result = tryAttr(attr, 1000);
    if (result) return result;
  }

  // Pass 3: any non-skipped facet, sorted by cardinality (fewest values first)
  const remaining = Object.keys(facets)
    .filter((a) => !skipAttrs.has(a) && !preferredAttrs.includes(a))
    .sort((a, b) => Object.keys(facets[a]!).length - Object.keys(facets[b]!).length);

  for (const attr of remaining) {
    const result = tryAttr(attr, 1000);
    if (result) return result;
  }

  return null;
}

/**
 * Process a single planning task: probe Algolia, decide whether the task
 * fits under MAX_HITS_PER_QUERY or needs splitting.
 *
 * Returns tasks to enqueue (empty if task goes to ready) and whether
 * the task itself is ready.
 */
async function probePlanningTask(
  apiKey: string,
  appId: string,
  storeNumber: string,
  task: SplitTask,
): Promise<{ ready: boolean; children: SplitTask[]; nbHits: number }> {
  const result = await algoliaQuery(apiKey, appId, storeNumber, {
    ...(task.filter ? { filters: task.filter } : {}),
    hitsPerPage: 0,
    facets: ["*"],
  });

  const count = result.nbHits;
  if (count === 0) return { ready: false, children: [], nbHits: 0 };
  if (count <= MAX_HITS_PER_QUERY) return { ready: true, children: [], nbHits: count };

  const split = findBestSplit(result.facets ?? {}, count);
  if (!split) return { ready: true, children: [], nbHits: count };

  const children: SplitTask[] = [];
  const coveredCount = split.values.reduce((sum, v) => sum + v.count, 0);
  const uncoveredCount = count - coveredCount;

  for (const { value } of split.values) {
    const quotedValue = value.includes(" ") ? `"${value}"` : value;
    const newFilter = task.filter
      ? `${task.filter} AND ${split.attr}:${quotedValue}`
      : `${split.attr}:${quotedValue}`;
    children.push({ name: `${split.attr}:${value}`, filter: newFilter });
  }

  if (uncoveredCount > 0) {
    const notClauses = split.values
      .map(({ value }) => {
        const quotedValue = value.includes(" ") ? `"${value}"` : value;
        return `NOT ${split.attr}:${quotedValue}`;
      })
      .join(" AND ");
    const remainderFilter = task.filter
      ? `${task.filter} AND ${notClauses}`
      : notClauses;
    children.push({ name: `NOT ${split.attr}`, filter: remainderFilter });
  }

  return { ready: false, children, nbHits: count };
}

// --- Work item types for the unified queue ---

type WorkItem =
  | { type: "plan"; storeNumber: string; task: SplitTask }
  | { type: "fetch"; storeNumber: string; task: SplitTask };

interface StoreTracker {
  planInflight: number;
  planIterations: number;
  fetchRemaining: number;
  allPlanned: boolean;
  expectedProducts: number;
  fetchedProducts: number;
}

/**
 * Fetch the complete product catalogs for multiple stores as a stream of batches.
 *
 * Uses a single unified work queue with interleaved planning and fetching.
 * Workers pull plan or fetch tasks from the same queue, keeping connections
 * saturated across all stores.
 *
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumbers - Store numbers to fetch
 * @param onProgress - Optional callback for progress updates
 * @param targetDurationMs - Target wall-clock duration for the entire run.
 *   undefined = fast mode (100 workers, no delays),
 *   set = slow mode (1 worker, paced evenly over target duration).
 * @yields CatalogBatch — either hits for a store or a done sentinel
 */
export interface FetchCatalogsOptions {
  onProgress?: ((progress: FetchProgress) => void) | undefined;
  targetDurationMs?: number | undefined;
}

export async function* fetchCatalogs(
  apiKey: string,
  appId: string,
  storeNumbers: string[],
  options?: FetchCatalogsOptions,
): AsyncGenerator<CatalogBatch> {
  if (storeNumbers.length === 0) return;

  const { onProgress, targetDurationMs } = options ?? {};

  const report = (progress: FetchProgress) => {
    if (onProgress) onProgress(progress);
  };

  const isBackground = targetDurationMs !== undefined;
  const concurrency = isBackground ? 1 : CONCURRENCY;

  // Per-store tracking for completion detection
  const trackers = new Map<string, StoreTracker>();
  for (const sn of storeNumbers) {
    trackers.set(sn, {
      planInflight: 0,
      planIterations: 0,
      fetchRemaining: 0,
      allPlanned: false,
      expectedProducts: 0,
      fetchedProducts: 0,
    });
  }

  // Unified work queue
  const queue: WorkItem[] = [];
  for (const sn of storeNumbers) {
    const item: WorkItem = { type: "plan", storeNumber: sn, task: { name: "root", filter: null } };
    queue.push(item);
    trackers.get(sn)!.planInflight++;
  }

  // Yield buffer: generator pulls from here
  const buffer: CatalogBatch[] = [];

  // Progress counters
  let planCompleted = 0;
  let fetchCompleted = 0;
  let fetchTotal = 0;

  // Dynamic task count estimate for slow-mode pacing
  // knownTotalTasks = completed + queue.length + inflight
  let inflight = 0;

  // Worker coordination
  let workersDone = false;
  let workerError: unknown = null;

  let resolveData: () => void;
  let dataReady: Promise<void> = new Promise((r) => { resolveData = r; });
  function signalData() {
    resolveData();
    dataReady = new Promise((r) => { resolveData = r; });
  }

  // Wake workers when new items appear in queue
  let wakeWorkers: () => void;
  let workerWait: Promise<void> = new Promise((r) => { wakeWorkers = r; });
  function signalQueue() {
    wakeWorkers();
    workerWait = new Promise((r) => { wakeWorkers = r; });
  }

  function computeDelay(): number {
    if (!isBackground) return 0;
    const knownTotal = planCompleted + fetchCompleted + queue.length + inflight;
    if (knownTotal <= 0) return 0;
    return Math.floor(targetDurationMs / knownTotal);
  }

  /**
   * Check if a store is fully done (all planning complete, all fetches done).
   * If so, emit the done sentinel.
   */
  function checkStoreCompletion(storeNumber: string): void {
    const tracker = trackers.get(storeNumber)!;
    if (tracker.allPlanned && tracker.fetchRemaining === 0) {
      buffer.push({
        storeNumber,
        done: true,
        expectedProducts: tracker.expectedProducts,
        fetchedProducts: tracker.fetchedProducts,
      });
      signalData();
    }
  }

  /**
   * Mark planning as fully done for a store when planInflight hits 0.
   */
  function checkPlanningComplete(storeNumber: string): void {
    const tracker = trackers.get(storeNumber)!;
    if (tracker.planInflight === 0) {
      tracker.allPlanned = true;
      checkStoreCompletion(storeNumber);
    }
  }

  async function worker() {
    while (true) {
      if (workerError) return;

      const item = queue.shift();
      if (!item) {
        if (inflight === 0) return;
        await workerWait;
        continue;
      }

      inflight++;

      try {
        if (item.type === "plan") {
          const tracker = trackers.get(item.storeNumber)!;

          // Enforce per-store plan iteration limit
          if (tracker.planIterations >= MAX_PLAN_ITERATIONS) {
            // Treat as ready — push a fetch task
            queue.push({ type: "fetch", storeNumber: item.storeNumber, task: item.task });
            fetchTotal++;
            tracker.fetchRemaining++;
            tracker.planInflight--;
            signalQueue();
            inflight--;
            checkPlanningComplete(item.storeNumber);

            if (queue.length === 0 && inflight === 0) signalQueue();
            continue;
          }

          tracker.planIterations++;

          const result = await probePlanningTask(apiKey, appId, item.storeNumber, item.task);

          // Root task (no filter) gives the store's total product count
          if (item.task.filter === null) {
            tracker.expectedProducts = result.nbHits;
          }

          planCompleted++;
          report({
            phase: "planning",
            current: planCompleted,
            total: planCompleted + queue.filter(w => w.type === "plan").length,
            message: `Planning... ${planCompleted} probes done`,
          });

          if (result.ready) {
            // This task is ready to fetch
            queue.push({ type: "fetch", storeNumber: item.storeNumber, task: item.task });
            fetchTotal++;
            tracker.fetchRemaining++;
            signalQueue();
          }

          if (result.children.length > 0) {
            for (const child of result.children) {
              queue.push({ type: "plan", storeNumber: item.storeNumber, task: child });
              tracker.planInflight++;
            }
            signalQueue();
          }

          tracker.planInflight--;
          checkPlanningComplete(item.storeNumber);

        } else {
          // Fetch task
          let backoff = 0;
          let result: QueryResult;
          let attempt = 0;

          while (true) {
            result = await algoliaQueryWithStatus(apiKey, appId, item.storeNumber, {
              ...(item.task.filter ? { filters: item.task.filter } : {}),
              hitsPerPage: MAX_HITS_PER_QUERY,
            });

            // Retry rate limits and transient network errors
            if ((result.status === 429 || result.status === 0) && attempt < MAX_TRANSIENT_RETRIES) {
              attempt++;
              backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
              await sleep(backoff);
              continue;
            }
            break;
          }

          if (!result.success) {
            if (result.status === 401 || result.status === 403) {
              workerError = new AlgoliaError(result.error, result.status);
              signalData();
              signalQueue();
              inflight--;
              return;
            }
            // Other failures: skip this query (best-effort scrape)
          } else if (result.result.hits.length > 0) {
            const tracker = trackers.get(item.storeNumber)!;
            tracker.fetchedProducts += result.result.hits.length;
            buffer.push({ storeNumber: item.storeNumber, hits: result.result.hits });
            signalData();
          }

          fetchCompleted++;
          const tracker = trackers.get(item.storeNumber)!;
          tracker.fetchRemaining--;

          report({
            phase: "fetching",
            current: fetchCompleted,
            total: fetchTotal,
            message: `Fetching products... ${fetchCompleted}/${fetchTotal}`,
          });

          checkStoreCompletion(item.storeNumber);
        }

        // Slow mode pacing
        const delay = computeDelay();
        if (delay > 0) await sleep(delay);

      } catch (err) {
        if (!workerError) workerError = err;
        signalData();
        signalQueue();
        inflight--;
        return;
      }

      inflight--;

      if (queue.length === 0 && inflight === 0) {
        signalQueue();
      }
    }
  }

  // Launch workers
  const workerPromise = Promise.all(
    Array.from({ length: concurrency }, () =>
      worker().catch((err) => { if (!workerError) workerError = err; })
    )
  ).then(
    () => { workersDone = true; signalData(); },
    (err) => { workerError = err; workersDone = true; signalData(); },
  );

  // Consume buffer as an async generator
  while (true) {
    while (buffer.length > 0) {
      yield buffer.shift()!;
    }

    if (workerError) throw workerError;
    if (workersDone && buffer.length === 0) break;

    await dataReady;
  }

  await workerPromise;
}

/**
 * Fetch the complete product catalog for a single store as a stream of batches.
 *
 * Thin wrapper around fetchCatalogs for backward compatibility.
 *
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumber - Store number to fetch
 * @param onProgress - Optional callback for progress updates
 * @param targetDurationMs - Target wall-clock duration for the fetch.
 *   undefined = on-demand (fast), set = background (paced).
 * @yields Batches of product hits
 */
export async function* fetchCatalog(
  apiKey: string,
  appId: string,
  storeNumber: string,
  onProgress?: (progress: FetchProgress) => void,
  targetDurationMs?: number,
): AsyncGenerator<AlgoliaHit[]> {
  for await (const batch of fetchCatalogs(apiKey, appId, [storeNumber], { onProgress, targetDurationMs })) {
    if ("hits" in batch) yield batch.hits;
  }
}
