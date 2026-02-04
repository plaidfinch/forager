import { z } from "zod";

// ============================================================================
// Price Schemas
// ============================================================================

export const AlgoliaPriceSchema = z
  .object({
    amount: z.number().optional(),
    unitPrice: z.string().optional(),
    channelKey: z.string().optional(),
  })
  .passthrough();

export type AlgoliaPrice = z.infer<typeof AlgoliaPriceSchema>;

// ============================================================================
// Discount Schemas
// ============================================================================

export const AlgoliaDiscountSchema = z
  .object({
    savings: z.number(),
    expiryDate: z.string(),
    name: z.string(),
    triggerQuantity: z.number().optional(),
    discountedQuantity: z.number().optional(),
    cartLimit: z.number().optional(),
  })
  .passthrough();

export type AlgoliaDiscount = z.infer<typeof AlgoliaDiscountSchema>;

// ============================================================================
// Location Schema
// ============================================================================

export const AlgoliaPlanogramSchema = z
  .object({
    aisle: z.string().optional(),
    shelf: z.string().optional(),
  })
  .passthrough();

export type AlgoliaPlanogram = z.infer<typeof AlgoliaPlanogramSchema>;

// ============================================================================
// Nutrition Schemas
// ============================================================================

export const AlgoliaNutrientSchema = z
  .object({
    name: z.string(),
    quantity: z.number().optional(),
    unitOfMeasure: z.string().optional(),
    percentOfDaily: z.number().optional(),
  })
  .passthrough();

export type AlgoliaNutrient = z.infer<typeof AlgoliaNutrientSchema>;

export const AlgoliaServingSchema = z
  .object({
    servingSize: z.string().optional(),
    servingSizeUom: z.string().optional(),
    servingsPerContainer: z.string().optional(),
    householdMeasurement: z.string().optional(),
  })
  .passthrough();

export type AlgoliaServing = z.infer<typeof AlgoliaServingSchema>;

export const AlgoliaNutritionEntrySchema = z
  .object({
    general: z.array(AlgoliaNutrientSchema).optional(),
    vitamins: z.array(AlgoliaNutrientSchema).optional(),
    contains: z.string().optional(),
  })
  .passthrough();

export const AlgoliaNutritionSchema = z
  .object({
    serving: AlgoliaServingSchema.optional(),
    nutritions: z.array(AlgoliaNutritionEntrySchema).optional(),
  })
  .passthrough();

export type AlgoliaNutrition = z.infer<typeof AlgoliaNutritionSchema>;

// ============================================================================
// Category Schemas
// ============================================================================

export const AlgoliaCategorySchema = z
  .object({
    name: z.string(),
    key: z.string(),
    seo: z.string().optional(),
  })
  .passthrough();

export type AlgoliaCategory = z.infer<typeof AlgoliaCategorySchema>;

export const AlgoliaCategoryNodesSchema = z
  .object({
    lvl0: z.string().optional(),
    lvl1: z.string().optional(),
    lvl2: z.string().optional(),
    lvl3: z.string().optional(),
    lvl4: z.string().optional(),
  })
  .passthrough();

export type AlgoliaCategoryNodes = z.infer<typeof AlgoliaCategoryNodesSchema>;

export const AlgoliaCategoriesHierarchySchema = z
  .object({
    lvl0: z.string().optional(),
    lvl1: z.string().optional(),
    lvl2: z.string().optional(),
    lvl3: z.string().optional(),
    lvl4: z.string().optional(),
  })
  .passthrough();

// ============================================================================
// Product Hit Schema
// ============================================================================

export const AlgoliaProductHitSchema = z
  .object({
    // Core Identification
    objectID: z.string(),
    productId: z.string().optional(),
    productID: z.string().optional(),
    skuId: z.string().optional(),
    storeNumber: z.string().optional(),
    slug: z.string().optional(),

    // Product Information
    productName: z.string().optional(),
    webProductDescription: z.string().optional(),
    productDescription: z.string().optional(),
    consumerBrandName: z.string().optional(),
    packSize: z.string().optional(),
    upc: z.array(z.string()).optional(),
    images: z.array(z.string()).optional(),

    // Categorization
    category: z.array(AlgoliaCategorySchema).optional(),
    categories: AlgoliaCategoriesHierarchySchema.optional(),
    categoryNodes: AlgoliaCategoryNodesSchema.optional(),
    categoryPageId: z.array(z.string()).optional(),
    categoryFacets: z.record(z.string(), z.array(z.string())).optional(),

    // Pricing
    price_inStore: AlgoliaPriceSchema.optional(),
    price_inStoreLoyalty: AlgoliaPriceSchema.optional(),
    price_delivery: AlgoliaPriceSchema.optional(),
    price_deliveryLoyalty: AlgoliaPriceSchema.optional(),
    bottleDeposit: z.number().optional(),

    // Discounts & Offers
    isLoyalty: z.boolean().optional(),
    discountType: z.string().optional(),
    hasOffers: z.boolean().optional(),
    loyaltyInstoreDiscount: z.array(AlgoliaDiscountSchema).optional(),
    loyaltyDeliveryDiscount: z.array(AlgoliaDiscountSchema).optional(),
    digitalCouponsOfferIds: z.array(z.string()).optional(),

    // Availability & Fulfillment
    isAvailable: z.boolean().optional(),
    isSoldAtStore: z.boolean().optional(),
    fulfilmentType: z.array(z.string()).optional(),
    excludeFromWeb: z.boolean().optional(),
    isIWSProduct: z.boolean().optional(),
    maxQuantity: z.number().optional(),

    // Store Location
    planogram: AlgoliaPlanogramSchema.optional(),

    // Product Attributes
    isNewItem: z.boolean().optional(),
    isAlcoholItem: z.boolean().optional(),
    isSoldByWeight: z.boolean().optional(),
    restrictedOTC: z.boolean().optional(),
    requiredMinimumAgeToBuy: z.number().optional(),
    ebtEligible: z.boolean().optional(),
    onlineSellByUnit: z.string().optional(),
    onlineApproxUnitWeight: z.number().optional(),

    // Tags & Keywords
    popularTags: z.array(z.string()).optional(),
    filterTags: z.array(z.string()).optional(),
    wellnessKeys: z.array(z.string()).optional(),
    productKeywords: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),

    // Nutrition
    nutrition: AlgoliaNutritionSchema.optional(),
    ingredients: z.string().nullable().optional(),
    allergensAndWarnings: z.string().nullable().optional(),
    instructions: z.string().nullable().optional(),

    // Ratings
    averageStarRating: z.number().optional(),
    reviewCount: z.number().optional(),

    // Metadata
    lastUpdated: z.string().optional(),
    taxCode: z.string().optional(),
    soldByVendor: z.string().optional(),
  })
  .passthrough(); // Allow unknown fields

export type AlgoliaProductHit = z.infer<typeof AlgoliaProductHitSchema>;

// ============================================================================
// Discovery Page Hit Schema (simpler)
// ============================================================================

export const AlgoliaDiscoveryHitSchema = z
  .object({
    objectID: z.string(),
    title: z.string().optional(),
    url: z.string().optional(),
    redirect_term: z.string().optional(),
  })
  .passthrough();

export type AlgoliaDiscoveryHit = z.infer<typeof AlgoliaDiscoveryHitSchema>;

// ============================================================================
// Query Result Schemas
// ============================================================================

export const AlgoliaExhaustiveSchema = z
  .object({
    nbHits: z.boolean().optional(),
    typo: z.boolean().optional(),
  })
  .passthrough();

export const AlgoliaQueryResultSchema = z
  .object({
    hits: z.array(AlgoliaProductHitSchema),
    nbHits: z.number().optional(),
    hitsPerPage: z.number().optional(),
    page: z.number().optional(),
    nbPages: z.number().optional(),
    processingTimeMS: z.number().optional(),
    query: z.string().optional(),
    index: z.string().optional(),
    exhaustive: AlgoliaExhaustiveSchema.optional(),
    exhaustiveNbHits: z.boolean().optional(),
    exhaustiveTypo: z.boolean().optional(),
    facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    facets_stats: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

export type AlgoliaQueryResult = z.infer<typeof AlgoliaQueryResultSchema>;

// ============================================================================
// Response Schemas
// ============================================================================

// Multi-query response (products index with multiple queries)
export const AlgoliaMultiQueryResponseSchema = z.object({
  results: z.array(AlgoliaQueryResultSchema),
});

export type AlgoliaMultiQueryResponse = z.infer<
  typeof AlgoliaMultiQueryResponseSchema
>;

// Single-query response (discovery_pages index)
export const AlgoliaSingleQueryResponseSchema = z
  .object({
    hits: z.array(AlgoliaDiscoveryHitSchema),
    nbHits: z.number().optional(),
    hitsPerPage: z.number().optional(),
    page: z.number().optional(),
    nbPages: z.number().optional(),
    processingTimeMS: z.number().optional(),
    query: z.string().optional(),
    exhaustive: AlgoliaExhaustiveSchema.optional(),
    exhaustiveNbHits: z.boolean().optional(),
    exhaustiveTypo: z.boolean().optional(),
  })
  .passthrough();

export type AlgoliaSingleQueryResponse = z.infer<
  typeof AlgoliaSingleQueryResponseSchema
>;
