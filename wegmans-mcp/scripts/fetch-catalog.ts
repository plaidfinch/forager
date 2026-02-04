#!/usr/bin/env npx tsx
/**
 * Fetches the full Wegmans product catalog for a store using minimum queries.
 *
 * Strategy:
 * 1. Start with a broad query (all products)
 * 2. If > 1000 results, dynamically split by best available facet
 * 3. Recursively split until all buckets are <= 1000
 * 4. Execute all leaf queries, deduplicate by productId
 *
 * Usage: npx tsx scripts/fetch-catalog.ts [storeNumber]
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ALGOLIA_APP_ID = "QGPPR19V8V";
const ALGOLIA_API_KEY = "9a10b1401634e9a6e55161c3a60c200d";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
const MAX_HITS_PER_QUERY = 1000;
const DEFAULT_STORE = "74";

// Concurrency settings (benchmarked optimal: 30)
const CONCURRENCY = 30;          // Parallel requests during fetch phase
const BASE_DELAY_MS = 20;        // Base delay between batches
const MAX_BACKOFF_MS = 30000;    // Max delay on rate limit
const PLANNING_DELAY_MS = 30;    // Delay during planning phase (sequential)

interface AlgoliaHit {
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

async function algoliaQuery(
  storeNumber: string,
  options: QueryOptions
): Promise<AlgoliaResult> {
  const result = await algoliaQueryWithStatus(storeNumber, options);
  if (!result.success || !result.result) {
    throw new Error(result.error ?? `Algolia error: ${result.status}`);
  }
  return result.result;
}

async function algoliaQueryWithStatus(
  storeNumber: string,
  options: QueryOptions
): Promise<QueryResult> {
  const baseFilters = `storeNumber:${storeNumber} AND isSoldAtStore:true`;
  const filters = options.filters
    ? `${baseFilters} AND ${options.filters}`
    : baseFilters;

  try {
    const response = await fetch(ALGOLIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-API-Key": ALGOLIA_API_KEY,
        "X-Algolia-Application-Id": ALGOLIA_APP_ID,
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

interface SplitTask {
  name: string;
  filter: string | null; // null = no additional filter (root query)
}

/**
 * Find the best facet to split on for a given result set.
 * Goals: minimize total queries while maximizing coverage.
 *
 * Strategy:
 * 1. Use category facets (they partition products, no overlap)
 * 2. Fall back to boolean facets (ebtEligible, isAvailable) for non-categorized
 * 3. Avoid array facets (fulfilmentType) that cause overlap
 */
function findBestSplit(
  facets: Record<string, Record<string, number>>,
  currentCount: number
): { attr: string; values: Array<{ value: string; count: number }> } | null {
  // Try attributes in priority order
  const priorityAttrs = [
    // Category facets - partition products cleanly
    "categories.lvl0",
    "categories.lvl1",
    "categories.lvl2",
    "categories.lvl3",
    // Boolean facets - for products without categories
    "ebtEligible",
    "isAvailable",
    "isLoyalty",
    "isAlcoholItem",
    "hasOffers",
  ];

  // Skip these - they cause overlapping buckets or too many values
  const skipAttrs = new Set([
    "storeNumber",
    "fulfilmentType",      // Array - products have multiple
    "digitalCouponsOfferIds", // Too many values
    "category.key",        // Too many values
    "category.seo",        // Too many values
    "categoryPageId",      // Too many values
    "consumerBrandName",   // Too many values
    "filterTags",          // Array - products have multiple
    "popularTags",         // Array
    "keywords",            // Array
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

    // Need at least 2 values to split
    if (valueCounts.length < 2) continue;

    // Skip if too many values
    if (valueCounts.length > 30) continue;

    const maxBucket = Math.max(...valueCounts.map((v) => v.count));

    // Must actually reduce the problem
    if (maxBucket >= currentCount) continue;

    // Found a usable split
    return { attr, values: valueCounts };
  }

  return null;
}

async function main() {
  const storeNumber = process.argv[2] ?? DEFAULT_STORE;
  console.log(`Fetching catalog for store ${storeNumber}\n`);

  const startTime = Date.now();

  // Start with root query to get total count
  console.log("Analyzing catalog structure...");
  const rootResult = await algoliaQuery(storeNumber, {
    hitsPerPage: 0,
    facets: ["*"],
  });

  const totalProducts = rootResult.nbHits;
  console.log(`Total products: ${totalProducts}\n`);

  // Queue of tasks to process
  const queue: SplitTask[] = [{ name: "root", filter: null }];
  const ready: SplitTask[] = [];
  let iterations = 0;
  const maxIterations = 500;

  console.log("Building query plan (dynamic splitting)...");

  while (queue.length > 0 && iterations < maxIterations) {
    iterations++;
    const task = queue.shift()!;

    // Get count and facets for this filter
    const result = await algoliaQuery(storeNumber, {
      filters: task.filter ?? undefined,
      hitsPerPage: 0,
      facets: ["*"],
    });

    const count = result.nbHits;

    if (count === 0) {
      continue;
    }

    if (count <= MAX_HITS_PER_QUERY) {
      // Small enough to fetch directly
      ready.push(task);
      continue;
    }

    // Need to split
    const split = findBestSplit(result.facets ?? {}, count);

    if (split) {
      const shortName =
        task.name.length > 40 ? "..." + task.name.slice(-37) : task.name;
      console.log(
        `  Split "${shortName}" (${count}) by ${split.attr} -> ${split.values.length} buckets`
      );

      // Calculate how many products are covered by the split
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

      // If there are uncovered products, add a "NOT any of these" query
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

        console.log(`    + remainder (${uncoveredCount} without ${split.attr})`);
      }
    } else {
      // Can't split further
      console.warn(
        `  Warning: "${task.name}" (${count}) can't be split, fetching first 1000`
      );
      ready.push(task);
    }

    // Small delay to avoid hammering the API during planning
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  if (iterations >= maxIterations) {
    console.warn(`\nWarning: Hit iteration limit (${maxIterations})`);
  }

  console.log(`\nQuery plan complete: ${ready.length} queries`);
  console.log(`\nFetching products (concurrency: ${CONCURRENCY})...`);

  // Execute all ready queries with concurrency and rate limit handling
  const products = new Map<string, AlgoliaHit>();
  let completed = 0;
  let currentDelay = BASE_DELAY_MS;

  const batches = chunk(ready, CONCURRENCY);

  for (const batch of batches) {
    // Execute batch concurrently
    const results = await Promise.all(
      batch.map(async (task) => {
        const result = await algoliaQueryWithStatus(storeNumber, {
          filters: task.filter ?? undefined,
          hitsPerPage: MAX_HITS_PER_QUERY,
        });
        return { task, result };
      })
    );

    // Check for rate limiting
    const rateLimited = results.filter((r) => r.result.status === 429);
    if (rateLimited.length > 0) {
      currentDelay = Math.min(currentDelay * 2, MAX_BACKOFF_MS);
      console.log(
        `  ⚠️  Rate limited on ${rateLimited.length} requests, backing off ${currentDelay}ms...`
      );
      await sleep(currentDelay);

      // Retry rate-limited queries sequentially
      for (const { task } of rateLimited) {
        const retryResult = await algoliaQueryWithStatus(storeNumber, {
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
      // Reset delay on successful batch
      currentDelay = BASE_DELAY_MS;
    }

    // Process successful results
    for (const { task, result } of results) {
      if (result.status === 429) continue; // Already handled above

      if (result.success && result.result) {
        let newCount = 0;
        for (const hit of result.result.hits) {
          const id = hit.productId ?? hit.productID ?? hit.objectID;
          if (!products.has(id)) {
            products.set(id, hit);
            newCount++;
          }
        }

        completed++;
        const pct = ((completed / ready.length) * 100).toFixed(1);

        const shortName =
          task.name.length > 50 ? "..." + task.name.slice(-47) : task.name;
        const cappedNote =
          result.result.nbHits > MAX_HITS_PER_QUERY
            ? ` (capped, ${result.result.nbHits} total)`
            : "";

        console.log(
          `  [${completed}/${ready.length}] ${pct}% - ${shortName}: ${result.result.hits.length}${cappedNote} (${products.size} total)`
        );
      } else {
        // Log error but continue
        console.error(`  ❌ Failed: ${task.name} - ${result.error}`);
        completed++;
      }
    }

    await sleep(currentDelay);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const coverage = ((products.size / totalProducts) * 100).toFixed(1);

  console.log(`\nComplete!`);
  console.log(`  Queries: ${ready.length}`);
  console.log(`  Unique products: ${products.size} / ${totalProducts} (${coverage}%)`);
  console.log(`  Time: ${elapsed}s`);

  // Save results
  const outputPath = join(
    process.cwd(),
    "snapshots",
    `catalog-store-${storeNumber}.json`
  );
  const output = {
    storeNumber,
    fetchedAt: new Date().toISOString(),
    queryCount: ready.length,
    productCount: products.size,
    totalProducts,
    coverage: `${coverage}%`,
    products: Array.from(products.values()),
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`  Saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
