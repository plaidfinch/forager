import { z } from "zod";

// ============================================================================
// Store Schema
// ============================================================================

export const StoreSchema = z.object({
  storeNumber: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  streetAddress: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  hasPickup: z.boolean().nullable(),
  hasDelivery: z.boolean().nullable(),
  hasECommerce: z.boolean().nullable(),
  lastUpdated: z.string().nullable(),
});

export type Store = z.infer<typeof StoreSchema>;

// ============================================================================
// Product Schema (store-independent product metadata)
// ============================================================================

export const ProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  packSize: z.string().nullable(),
  imageUrl: z.string().nullable(),
  ingredients: z.string().nullable(),
  allergens: z.string().nullable(),
  isSoldByWeight: z.boolean(),
  isAlcohol: z.boolean(),
  upc: z.string().nullable(), // Primary UPC (first from array)
  // Category & Tags
  categoryPath: z.string().nullable(), // Full leaf path, e.g., "Dairy > Milk > Whole Milk"
  tagsFilter: z.string().nullable(), // JSON array, e.g., '["Organic", "Gluten Free"]'
  tagsPopular: z.string().nullable(), // JSON array, e.g., '["Wegmans Brand"]'
});

export type Product = z.infer<typeof ProductSchema>;

// ============================================================================
// StoreProduct Schema (store-specific price and location)
// ============================================================================

export const StoreProductSchema = z.object({
  productId: z.string(),
  storeNumber: z.string(),
  // Pricing
  priceInStore: z.number().nullable(),
  priceInStoreLoyalty: z.number().nullable(),
  priceDelivery: z.number().nullable(),
  priceDeliveryLoyalty: z.number().nullable(),
  unitPrice: z.string().nullable(), // e.g., "$2.99/gallon"
  // Location
  aisle: z.string().nullable(),
  shelf: z.string().nullable(),
  // Availability
  isAvailable: z.boolean(),
  isSoldAtStore: z.boolean(),
  // Metadata
  lastUpdated: z.string().nullable(),
});

export type StoreProduct = z.infer<typeof StoreProductSchema>;

// ============================================================================
// Serving Schema
// ============================================================================

export const ServingSchema = z.object({
  productId: z.string(),
  servingSize: z.string().nullable(),
  servingSizeUnit: z.string().nullable(),
  servingsPerContainer: z.string().nullable(),
  householdMeasurement: z.string().nullable(),
});

export type Serving = z.infer<typeof ServingSchema>;

// ============================================================================
// NutritionFact Schema
// ============================================================================

export const NutritionFactSchema = z.object({
  productId: z.string(),
  nutrient: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  percentDaily: z.number().nullable(),
  category: z.enum(["general", "vitamin"]),
});

export type NutritionFact = z.infer<typeof NutritionFactSchema>;

// ============================================================================
// ApiKey Schema (for caching extracted Algolia API keys)
// ============================================================================

export const ApiKeySchema = z.object({
  id: z.number().optional(),
  key: z.string(),
  appId: z.string(),
  extractedAt: z.string(), // ISO timestamp
  expiresAt: z.string().nullable(), // ISO timestamp, null if unknown
});

export type ApiKey = z.infer<typeof ApiKeySchema>;
