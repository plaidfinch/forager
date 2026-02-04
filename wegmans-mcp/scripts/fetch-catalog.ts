#!/usr/bin/env npx tsx
/**
 * Fetches the full Wegmans product catalog for a store using minimum queries.
 *
 * Strategy:
 * 1. Initial query to get category facet counts
 * 2. For categories ≤1000 products: single query fetches all
 * 3. For categories >1000 products: drill down to subcategories
 * 4. Repeat until all leaf queries are ≤1000 products
 * 5. Execute queries, deduplicate by productId
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

interface FacetCounts {
  [key: string]: number;
}

interface AlgoliaHit {
  objectID: string;
  productId?: string;
  productID?: string;
  [key: string]: unknown;
}

interface AlgoliaResult {
  hits: AlgoliaHit[];
  nbHits: number;
  facets?: {
    [facetName: string]: FacetCounts;
  };
}

interface AlgoliaResponse {
  results: AlgoliaResult[];
}

async function algoliaQuery(
  storeNumber: string,
  options: {
    query?: string;
    filters?: string;
    hitsPerPage?: number;
    facets?: string[];
  }
): Promise<AlgoliaResult> {
  const baseFilters = `storeNumber:${storeNumber} AND isSoldAtStore:true`;
  const filters = options.filters
    ? `${baseFilters} AND ${options.filters}`
    : baseFilters;

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
    throw new Error(`Algolia error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as AlgoliaResponse;
  return data.results[0];
}

interface CategoryNode {
  path: string;
  count: number;
  level: number;
}

interface QueryPlan {
  filters: string[];
  parentOnlyQueries: Array<{
    parentPath: string;
    parentLevel: number;
    childPaths: string[];
    estimatedCount: number;
  }>;
  uncategorizedQuery: string | null; // For products with no category at all
  totalProducts: number;
}

/**
 * Build the list of category filters needed to fetch all products.
 * Recursively drills down into categories that exceed MAX_HITS_PER_QUERY.
 * Also generates queries for products in parent categories but not in subcategories.
 */
async function buildQueryPlan(storeNumber: string): Promise<QueryPlan> {
  console.log("Fetching initial facet counts...");

  const initial = await algoliaQuery(storeNumber, {
    hitsPerPage: 1,
    facets: [
      "categories.lvl0",
      "categories.lvl1",
      "categories.lvl2",
      "categories.lvl3",
    ],
  });

  console.log(`Total products: ${initial.nbHits}`);

  // Build category tree from facets
  const facets = initial.facets ?? {};
  const allCategories: CategoryNode[] = [];

  for (let level = 0; level <= 3; level++) {
    const levelFacets = facets[`categories.lvl${level}`] ?? {};
    for (const [path, count] of Object.entries(levelFacets)) {
      allCategories.push({ path, count, level });
    }
  }

  console.log(`Found ${allCategories.length} total category paths`);

  // Strategy: find the minimal set of category filters
  // Start with level 0, drill down where needed
  const queryFilters: string[] = [];
  const parentOnlyQueries: QueryPlan["parentOnlyQueries"] = [];
  const covered = new Set<string>();

  function findFiltersForCategory(
    targetPath: string,
    targetCount: number,
    targetLevel: number
  ): void {
    if (covered.has(targetPath)) return;

    if (targetCount <= MAX_HITS_PER_QUERY) {
      // This category can be fetched in one query
      queryFilters.push(`categories.lvl${targetLevel}:"${targetPath}"`);
      covered.add(targetPath);
      return;
    }

    // Need to drill down to subcategories
    const prefix = targetPath + " > ";
    const subcategories = allCategories.filter(
      (c) => c.level === targetLevel + 1 && c.path.startsWith(prefix)
    );

    if (subcategories.length === 0) {
      // No subcategories available, just fetch what we can (capped at 1000)
      console.warn(
        `Warning: ${targetPath} has ${targetCount} products but no subcategories. Will only fetch first 1000.`
      );
      queryFilters.push(`categories.lvl${targetLevel}:"${targetPath}"`);
      covered.add(targetPath);
      return;
    }

    // Sum of subcategory counts
    const subcategoryTotal = subcategories.reduce((sum, c) => sum + c.count, 0);

    // Check for uncategorized products (in parent but not in any child)
    const uncategorized = targetCount - subcategoryTotal;
    if (uncategorized > 0) {
      console.log(
        `  ${targetPath}: ${uncategorized} products not in subcategories`
      );
      // Queue a "parent minus children" query to capture these
      parentOnlyQueries.push({
        parentPath: targetPath,
        parentLevel: targetLevel,
        childPaths: subcategories.map((c) => c.path),
        estimatedCount: uncategorized,
      });
    }

    // Recurse into subcategories
    for (const sub of subcategories) {
      findFiltersForCategory(sub.path, sub.count, sub.level);
    }

    covered.add(targetPath);
  }

  // Start with top-level categories
  const level0 = allCategories.filter((c) => c.level === 0);
  console.log("\nPlanning queries:");

  for (const cat of level0) {
    console.log(`  ${cat.path}: ${cat.count} products`);
    findFiltersForCategory(cat.path, cat.count, cat.level);
  }

  // Check for products with no category at all
  const level0Total = level0.reduce((sum, c) => sum + c.count, 0);
  const uncategorizedCount = (initial.nbHits ?? 0) - level0Total;
  let uncategorizedQuery: string | null = null;

  if (uncategorizedCount > 0) {
    // Build a query that excludes all lvl0 categories
    const notClauses = level0
      .map((c) => `NOT categories.lvl0:"${c.path}"`)
      .join(" AND ");
    uncategorizedQuery = notClauses;
    console.log(`\n  Uncategorized (no category): ${uncategorizedCount} products`);
  }

  console.log(`\nQuery plan: ${queryFilters.length} category queries`);
  if (parentOnlyQueries.length > 0) {
    const totalParentOnly = parentOnlyQueries.reduce(
      (sum, q) => sum + q.estimatedCount,
      0
    );
    console.log(
      `           ${parentOnlyQueries.length} parent-only queries (~${totalParentOnly} products)`
    );
  }
  if (uncategorizedQuery) {
    console.log(`           3 uncategorized queries (~${uncategorizedCount} products, split by ebt/availability)`);
  }

  return {
    filters: queryFilters,
    parentOnlyQueries,
    uncategorizedQuery,
    totalProducts: initial.nbHits ?? 0,
  };
}

/**
 * Execute queries and collect all products.
 */
async function fetchAllProducts(
  storeNumber: string,
  plan: QueryPlan
): Promise<Map<string, AlgoliaHit>> {
  const products = new Map<string, AlgoliaHit>();
  // 3 queries for uncategorized (split by ebt/availability) if uncategorizedQuery exists
  const totalQueries =
    plan.filters.length +
    plan.parentOnlyQueries.length +
    (plan.uncategorizedQuery ? 3 : 0);
  let completed = 0;

  console.log(`\nFetching products from category queries...`);

  // First, fetch all category queries
  for (const filter of plan.filters) {
    const result = await algoliaQuery(storeNumber, {
      filters: filter,
      hitsPerPage: MAX_HITS_PER_QUERY,
    });

    for (const hit of result.hits) {
      const id = hit.productId ?? hit.productID ?? hit.objectID;
      if (!products.has(id)) {
        products.set(id, hit);
      }
    }

    completed++;
    const pct = ((completed / totalQueries) * 100).toFixed(1);
    console.log(
      `  [${completed}/${totalQueries}] ${pct}% - ${filter}: ${result.hits.length} hits (${products.size} unique total)`
    );

    // Small delay to be nice to the API
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Then, fetch parent-only products (in parent but not in any subcategory)
  if (plan.parentOnlyQueries.length > 0) {
    console.log(`\nFetching parent-only products...`);

    for (const poq of plan.parentOnlyQueries) {
      // Build filter: "in parent AND NOT in child1 AND NOT in child2 ..."
      const childLevel = poq.parentLevel + 1;
      const notClauses = poq.childPaths
        .map((path) => `NOT categories.lvl${childLevel}:"${path}"`)
        .join(" AND ");
      const filter = `categories.lvl${poq.parentLevel}:"${poq.parentPath}" AND ${notClauses}`;

      const result = await algoliaQuery(storeNumber, {
        filters: filter,
        hitsPerPage: MAX_HITS_PER_QUERY,
      });

      let newCount = 0;
      for (const hit of result.hits) {
        const id = hit.productId ?? hit.productID ?? hit.objectID;
        if (!products.has(id)) {
          products.set(id, hit);
          newCount++;
        }
      }

      completed++;
      const pct = ((completed / totalQueries) * 100).toFixed(1);
      console.log(
        `  [${completed}/${totalQueries}] ${pct}% - ${poq.parentPath} (parent-only): ${result.hits.length} hits, ${newCount} new (${products.size} unique total)`
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Finally, fetch products with no category at all
  // Split by ebtEligible and isAvailable to stay under 1000 per query
  if (plan.uncategorizedQuery) {
    console.log(`\nFetching uncategorized products (split by attributes)...`);

    const uncategorizedSplits = [
      { name: "ebt-eligible", filter: `${plan.uncategorizedQuery} AND ebtEligible:true` },
      { name: "non-ebt, unavailable", filter: `${plan.uncategorizedQuery} AND ebtEligible:false AND isAvailable:false` },
      { name: "non-ebt, available", filter: `${plan.uncategorizedQuery} AND ebtEligible:false AND isAvailable:true` },
    ];

    for (const split of uncategorizedSplits) {
      const result = await algoliaQuery(storeNumber, {
        filters: split.filter,
        hitsPerPage: MAX_HITS_PER_QUERY,
      });

      let newCount = 0;
      for (const hit of result.hits) {
        const id = hit.productId ?? hit.productID ?? hit.objectID;
        if (!products.has(id)) {
          products.set(id, hit);
          newCount++;
        }
      }

      completed++;
      const pct = ((completed / totalQueries) * 100).toFixed(1);

      const cappedNote =
        result.nbHits > MAX_HITS_PER_QUERY
          ? ` (capped, ${result.nbHits} total exist)`
          : "";
      console.log(
        `  [${completed}/${totalQueries}] ${pct}% - uncategorized (${split.name}): ${result.hits.length} hits${cappedNote}, ${newCount} new (${products.size} unique total)`
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return products;
}

async function main() {
  const storeNumber = process.argv[2] ?? DEFAULT_STORE;
  console.log(`Fetching catalog for store ${storeNumber}\n`);

  const startTime = Date.now();

  // Build query plan
  const plan = await buildQueryPlan(storeNumber);

  // Execute queries
  const products = await fetchAllProducts(storeNumber, plan);

  const totalQueries =
    plan.filters.length +
    plan.parentOnlyQueries.length +
    (plan.uncategorizedQuery ? 3 : 0);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const coverage = ((products.size / plan.totalProducts) * 100).toFixed(1);
  console.log(`\nComplete!`);
  console.log(`  Queries: ${totalQueries}`);
  console.log(`  Unique products: ${products.size} / ${plan.totalProducts} (${coverage}%)`);
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
    queryCount: totalQueries,
    productCount: products.size,
    products: Array.from(products.values()),
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`  Saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
