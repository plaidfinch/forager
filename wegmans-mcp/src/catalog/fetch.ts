/**
 * Catalog fetching logic for full product scrape.
 *
 * Fetches the complete Wegmans product catalog using dynamic splitting
 * to work around the 1000 result limit.
 */

const MAX_HITS_PER_QUERY = 1000;

/**
 * Build the Algolia API URL for a given app ID.
 */
function getAlgoliaUrl(appId: string): string {
  return `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
}

// Concurrency settings (benchmarked optimal: 30)
const CONCURRENCY = 30;
const BASE_DELAY_MS = 20;
const MAX_BACKOFF_MS = 30000;
const PLANNING_DELAY_MS = 30;

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

interface QueryResult {
  success: boolean;
  status: number;
  result?: AlgoliaResult;
  error?: string;
}

interface SplitTask {
  name: string;
  filter: string | null;
}

export interface FetchProgress {
  phase: "planning" | "fetching";
  current: number;
  total: number;
  message: string;
}

export interface FetchResult {
  success: boolean;
  products: AlgoliaHit[];
  queryCount: number;
  totalProducts: number;
  coverage: number;
  error?: string;
}

/** Split array into chunks of size n */
function chunk<T>(arr: T[], n: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    chunks.push(arr.slice(i, i + n));
  }
  return chunks;
}

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
    return {
      success: true,
      status: 200,
      result: data.results[0],
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
  const result = await algoliaQueryWithStatus(apiKey, appId, storeNumber, options);
  if (!result.success || !result.result) {
    throw new Error(result.error ?? `Algolia error: ${result.status}`);
  }
  return result.result;
}

/**
 * Find the best facet to split on for a given result set.
 */
function findBestSplit(
  facets: Record<string, Record<string, number>>,
  currentCount: number
): { attr: string; values: Array<{ value: string; count: number }> } | null {
  const priorityAttrs = [
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

  const skipAttrs = new Set([
    "storeNumber",
    "fulfilmentType",
    "digitalCouponsOfferIds",
    "category.key",
    "category.seo",
    "categoryPageId",
    "consumerBrandName",
    "filterTags",
    "popularTags",
    "keywords",
    "loyaltyInstoreDiscount.name",
    "loyaltyDeliveryDiscount.name",
    "discountType",
    "maxQuantity",
  ]);

  for (const attr of priorityAttrs) {
    if (skipAttrs.has(attr)) continue;

    const values = facets[attr];
    if (!values) continue;

    const valueCounts = Object.entries(values).map(([v, c]) => ({
      value: v,
      count: c,
    }));

    if (valueCounts.length < 2) continue;
    if (valueCounts.length > 30) continue;

    const maxBucket = Math.max(...valueCounts.map((v) => v.count));
    if (maxBucket >= currentCount) continue;

    return { attr, values: valueCounts };
  }

  return null;
}

/**
 * Fetch the complete product catalog for a store.
 *
 * @param apiKey - Algolia API key
 * @param appId - Algolia application ID
 * @param storeNumber - Store number to fetch
 * @param onProgress - Optional callback for progress updates
 * @returns Fetch result with all products
 */
export async function fetchCatalog(
  apiKey: string,
  appId: string,
  storeNumber: string,
  onProgress?: (progress: FetchProgress) => void
): Promise<FetchResult> {
  const report = (progress: FetchProgress) => {
    if (onProgress) onProgress(progress);
  };

  try {
    // Get total count
    report({ phase: "planning", current: 0, total: 0, message: "Analyzing catalog structure..." });

    const rootResult = await algoliaQuery(apiKey, appId, storeNumber, {
      hitsPerPage: 0,
      facets: ["*"],
    });

    const totalProducts = rootResult.nbHits;

    // Build query plan
    const queue: SplitTask[] = [{ name: "root", filter: null }];
    const ready: SplitTask[] = [];
    let iterations = 0;
    const maxIterations = 500;

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const task = queue.shift()!;

      report({
        phase: "planning",
        current: ready.length,
        total: ready.length + queue.length,
        message: `Building query plan... (${ready.length} queries)`,
      });

      const result = await algoliaQuery(apiKey, appId, storeNumber, {
        filters: task.filter ?? undefined,
        hitsPerPage: 0,
        facets: ["*"],
      });

      const count = result.nbHits;

      if (count === 0) continue;

      if (count <= MAX_HITS_PER_QUERY) {
        ready.push(task);
        continue;
      }

      const split = findBestSplit(result.facets ?? {}, count);

      if (split) {
        const coveredCount = split.values.reduce((sum, v) => sum + v.count, 0);
        const uncoveredCount = count - coveredCount;

        for (const { value } of split.values) {
          const quotedValue = value.includes(" ") ? `"${value}"` : value;
          const newFilter = task.filter
            ? `${task.filter} AND ${split.attr}:${quotedValue}`
            : `${split.attr}:${quotedValue}`;

          queue.push({
            name: `${split.attr}:${value}`,
            filter: newFilter,
          });
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

          queue.push({
            name: `NOT ${split.attr}`,
            filter: remainderFilter,
          });
        }
      } else {
        ready.push(task);
      }

      await sleep(PLANNING_DELAY_MS);
    }

    report({
      phase: "planning",
      current: ready.length,
      total: ready.length,
      message: `Query plan complete: ${ready.length} queries`,
    });

    // Execute queries
    const products = new Map<string, AlgoliaHit>();
    let completed = 0;
    let currentDelay = BASE_DELAY_MS;

    const batches = chunk(ready, CONCURRENCY);

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map(async (task) => {
          const result = await algoliaQueryWithStatus(apiKey, appId, storeNumber, {
            filters: task.filter ?? undefined,
            hitsPerPage: MAX_HITS_PER_QUERY,
          });
          return { task, result };
        })
      );

      const rateLimited = results.filter((r) => r.result.status === 429);
      if (rateLimited.length > 0) {
        currentDelay = Math.min(currentDelay * 2, MAX_BACKOFF_MS);
        await sleep(currentDelay);

        for (const { task } of rateLimited) {
          const retryResult = await algoliaQueryWithStatus(apiKey, appId, storeNumber, {
            filters: task.filter ?? undefined,
            hitsPerPage: MAX_HITS_PER_QUERY,
          });

          if (retryResult.success && retryResult.result) {
            for (const hit of retryResult.result.hits) {
              const id = hit.productId ?? hit.productID ?? hit.objectID;
              if (!products.has(id)) {
                products.set(id, hit);
              }
            }
          }

          completed++;
          await sleep(currentDelay);
        }
      } else {
        currentDelay = BASE_DELAY_MS;
      }

      for (const { result } of results) {
        if (result.status === 429) continue;

        if (result.success && result.result) {
          for (const hit of result.result.hits) {
            const id = hit.productId ?? hit.productID ?? hit.objectID;
            if (!products.has(id)) {
              products.set(id, hit);
            }
          }
          completed++;
        } else {
          completed++;
        }
      }

      report({
        phase: "fetching",
        current: completed,
        total: ready.length,
        message: `Fetching products... ${completed}/${ready.length} (${products.size} products)`,
      });

      await sleep(currentDelay);
    }

    const coverage = (products.size / totalProducts) * 100;

    return {
      success: true,
      products: Array.from(products.values()),
      queryCount: ready.length,
      totalProducts,
      coverage,
    };
  } catch (err) {
    return {
      success: false,
      products: [],
      queryCount: 0,
      totalProducts: 0,
      coverage: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
