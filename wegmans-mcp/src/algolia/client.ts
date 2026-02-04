/**
 * Algolia HTTP client for Wegmans product search.
 *
 * Provides functions to build search requests, parse responses,
 * and transform Algolia hits to our domain types.
 */

import {
  AlgoliaMultiQueryResponseSchema,
  type AlgoliaProductHit,
  type AlgoliaMultiQueryResponse,
} from "../types/algolia.js";
import type {
  Product,
  StoreProduct,
  Serving,
  NutritionFact,
} from "../types/product.js";

// ============================================================================
// Constants
// ============================================================================

export const ALGOLIA_APP_ID = "QGPPR19V8V";
export const ALGOLIA_PRODUCTS_INDEX = "products";

/**
 * Base URL for Algolia API requests.
 * Uses the distributed search network (DSN) for performance.
 */
const ALGOLIA_BASE_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;

// ============================================================================
// Request Building
// ============================================================================

export interface SearchRequestOptions {
  /** Search query text (empty string for browsing) */
  query?: string;
  /** Store number (required for product queries) */
  storeNumber: string;
  /** Number of hits per page (default: 20) */
  hitsPerPage?: number;
  /** Page number for pagination (0-indexed) */
  page?: number;
  /** Fulfillment type filter */
  fulfillmentType?: "instore" | "pickup" | "delivery";
  /** Additional raw Algolia filter string (e.g., 'filterTags:Organic') */
  filters?: string;
}

export interface AlgoliaSearchRequest {
  requests: Array<{
    indexName: string;
    query: string;
    filters: string;
    hitsPerPage: number;
    page: number;
    facets: string[];
    analytics: boolean;
    analyticsTags: string[];
  }>;
}

/**
 * Build an Algolia multi-query search request.
 */
export function buildSearchRequest(
  options: SearchRequestOptions
): AlgoliaSearchRequest {
  const {
    query = "",
    storeNumber,
    hitsPerPage = 20,
    page = 0,
    fulfillmentType = "instore",
    filters: userFilters,
  } = options;

  // Build base filter string matching Wegmans' format
  const baseFilters = [
    `storeNumber:${storeNumber}`,
    `fulfilmentType:${fulfillmentType}`,
    "excludeFromWeb:false",
    "isSoldAtStore:true",
  ].join(" AND ");

  // Merge with user-provided filters
  const filters = userFilters
    ? `${baseFilters} AND ${userFilters}`
    : baseFilters;

  // Analytics tags for tracking
  const analyticsTags = [
    "product-search",
    "organic",
    `store-${storeNumber}`,
    `fulfillment-${fulfillmentType}`,
    "anonymous",
  ];

  return {
    requests: [
      {
        indexName: ALGOLIA_PRODUCTS_INDEX,
        query,
        filters,
        hitsPerPage,
        page,
        facets: ["*"], // Request all facets
        analytics: true,
        analyticsTags,
      },
    ],
  };
}

// ============================================================================
// Response Parsing
// ============================================================================

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Parse an Algolia multi-query response using our Zod schema.
 */
export function parseSearchResponse(
  raw: unknown
): ParseResult<AlgoliaMultiQueryResponse> {
  const result = AlgoliaMultiQueryResponseSchema.safeParse(raw);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    error: result.error.issues.map((i) => i.message).join("; "),
  };
}

// ============================================================================
// Hit Transformations
// ============================================================================

/**
 * Get the product ID from an Algolia hit.
 * Handles various field name variations.
 */
function getProductId(hit: AlgoliaProductHit): string {
  return hit.productId ?? hit.productID ?? hit.skuId ?? "";
}

/**
 * Extract the deepest (leaf) category path from an Algolia hit.
 * Returns the most specific category level available.
 */
function extractLeafCategoryPath(hit: AlgoliaProductHit): string | null {
  const cats = hit.categories;
  if (!cats) return null;
  return cats.lvl4 ?? cats.lvl3 ?? cats.lvl2 ?? cats.lvl1 ?? cats.lvl0 ?? null;
}

/**
 * Transform an Algolia hit to a Product domain object.
 */
export function transformHitToProduct(hit: AlgoliaProductHit): Product {
  return {
    productId: getProductId(hit),
    name: hit.productName ?? "",
    brand: hit.consumerBrandName ?? null,
    description: hit.productDescription ?? null,
    packSize: hit.packSize ?? null,
    imageUrl: hit.images?.[0] ?? null,
    ingredients: hit.ingredients ?? null,
    allergens: hit.allergensAndWarnings ?? null,
    isSoldByWeight: hit.isSoldByWeight ?? false,
    isAlcohol: hit.isAlcoholItem ?? false,
    upc: hit.upc?.[0] ?? null,
    categoryPath: extractLeafCategoryPath(hit),
    tagsFilter: hit.filterTags ? JSON.stringify(hit.filterTags) : null,
    tagsPopular: hit.popularTags ? JSON.stringify(hit.popularTags) : null,
  };
}

/**
 * Transform an Algolia hit to a StoreProduct domain object.
 */
export function transformHitToStoreProduct(hit: AlgoliaProductHit): StoreProduct {
  return {
    productId: getProductId(hit),
    storeNumber: hit.storeNumber ?? "",
    priceInStore: hit.price_inStore?.amount ?? null,
    priceInStoreLoyalty: hit.price_inStoreLoyalty?.amount ?? null,
    priceDelivery: hit.price_delivery?.amount ?? null,
    priceDeliveryLoyalty: hit.price_deliveryLoyalty?.amount ?? null,
    unitPrice: hit.price_inStore?.unitPrice ?? null,
    aisle: hit.planogram?.aisle ?? null,
    shelf: hit.planogram?.shelf ?? null,
    isAvailable: hit.isAvailable ?? false,
    isSoldAtStore: hit.isSoldAtStore ?? false,
    lastUpdated: hit.lastUpdated ?? null,
  };
}

/**
 * Transform an Algolia hit to a Serving domain object.
 * Returns null if no serving data is present.
 */
export function transformHitToServing(hit: AlgoliaProductHit): Serving | null {
  const serving = hit.nutrition?.serving;
  if (!serving) {
    return null;
  }

  return {
    productId: getProductId(hit),
    servingSize: serving.servingSize ?? null,
    servingSizeUnit: serving.servingSizeUom ?? null,
    servingsPerContainer: serving.servingsPerContainer ?? null,
    householdMeasurement: serving.householdMeasurement ?? null,
  };
}

/**
 * Transform an Algolia hit to NutritionFact domain objects.
 * Returns an empty array if no nutrition data is present.
 */
export function transformHitToNutritionFacts(hit: AlgoliaProductHit): NutritionFact[] {
  const productId = getProductId(hit);
  const facts: NutritionFact[] = [];

  const nutritions = hit.nutrition?.nutritions;
  if (!nutritions) {
    return facts;
  }

  for (const entry of nutritions) {
    // General nutrients (calories, fat, protein, etc.)
    if (entry.general) {
      for (const nutrient of entry.general) {
        facts.push({
          productId,
          nutrient: nutrient.name,
          quantity: nutrient.quantity ?? null,
          unit: nutrient.unitOfMeasure ?? null,
          percentDaily: nutrient.percentOfDaily ?? null,
          category: "general",
        });
      }
    }

    // Vitamins
    if (entry.vitamins) {
      for (const vitamin of entry.vitamins) {
        facts.push({
          productId,
          nutrient: vitamin.name,
          quantity: vitamin.quantity ?? null,
          unit: vitamin.unitOfMeasure ?? null,
          percentDaily: vitamin.percentOfDaily ?? null,
          category: "vitamin",
        });
      }
    }
  }

  return facts;
}

// ============================================================================
// HTTP Client
// ============================================================================

export interface SearchResult {
  success: boolean;
  hits: AlgoliaProductHit[];
  totalHits: number;
  page: number;
  totalPages: number;
  error?: string;
}

/**
 * Execute a search request against the Algolia API.
 *
 * @param apiKey - Algolia API key
 * @param request - Search request object
 * @returns Search result with hits
 */
export async function executeSearch(
  apiKey: string,
  request: AlgoliaSearchRequest
): Promise<SearchResult> {
  const url = `${ALGOLIA_BASE_URL}/1/indexes/*/queries`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-API-Key": apiKey,
        "X-Algolia-Application-Id": ALGOLIA_APP_ID,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        success: false,
        hits: [],
        totalHits: 0,
        page: 0,
        totalPages: 0,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const raw = await response.json();
    const parseResult = parseSearchResponse(raw);

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        hits: [],
        totalHits: 0,
        page: 0,
        totalPages: 0,
        error: parseResult.error ?? "Failed to parse response",
      };
    }

    const firstResult = parseResult.data.results[0];
    if (!firstResult) {
      return {
        success: true,
        hits: [],
        totalHits: 0,
        page: 0,
        totalPages: 0,
      };
    }

    const totalHits = firstResult.nbHits ?? 0;
    const hitsPerPage = firstResult.hitsPerPage ?? 20;
    const totalPages = Math.ceil(totalHits / hitsPerPage);

    return {
      success: true,
      hits: firstResult.hits,
      totalHits,
      page: firstResult.page ?? 0,
      totalPages,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      hits: [],
      totalHits: 0,
      page: 0,
      totalPages: 0,
      error: message,
    };
  }
}

/**
 * Search for products in a store.
 *
 * @param apiKey - Algolia API key
 * @param options - Search options
 * @returns Search result with hits
 */
export async function searchProducts(
  apiKey: string,
  options: SearchRequestOptions
): Promise<SearchResult> {
  const request = buildSearchRequest(options);
  return executeSearch(apiKey, request);
}
