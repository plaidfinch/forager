/**
 * Tests that Algolia response data can be transformed into our domain types.
 * This validates the alignment between the API schema and our normalized schema.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlgoliaMultiQueryResponseSchema,
  type AlgoliaProductHit,
} from "../../src/types/algolia.js";
import {
  ProductSchema,
  StoreProductSchema,
  ServingSchema,
  NutritionFactSchema,
  type Product,
  type StoreProduct,
  type Serving,
  type NutritionFact,
} from "../../src/types/product.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots", "responses");

// ============================================================================
// Transform functions (these will eventually live in src/transforms/)
// ============================================================================

function transformToProduct(hit: AlgoliaProductHit): Product {
  return {
    productId: hit.productId ?? hit.productID ?? hit.skuId ?? "",
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
  };
}

function transformToStoreProduct(hit: AlgoliaProductHit): StoreProduct {
  return {
    productId: hit.productId ?? hit.productID ?? hit.skuId ?? "",
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

function transformToServing(hit: AlgoliaProductHit): Serving | null {
  const serving = hit.nutrition?.serving;
  if (!serving) return null;

  return {
    productId: hit.productId ?? hit.productID ?? hit.skuId ?? "",
    servingSize: serving.servingSize ?? null,
    servingSizeUnit: serving.servingSizeUom ?? null,
    servingsPerContainer: serving.servingsPerContainer ?? null,
    householdMeasurement: serving.householdMeasurement ?? null,
  };
}

function transformToNutritionFacts(hit: AlgoliaProductHit): NutritionFact[] {
  const productId = hit.productId ?? hit.productID ?? hit.skuId ?? "";
  const facts: NutritionFact[] = [];

  const nutritions = hit.nutrition?.nutritions;
  if (!nutritions) return facts;

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
// Tests
// ============================================================================

describe("Algolia → Domain Type Transformation", () => {
  // Load a real product hit for testing
  function getTestHit(): AlgoliaProductHit {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      if (typeof raw !== "object" || raw === null || !("results" in raw)) {
        continue;
      }

      const parsed = AlgoliaMultiQueryResponseSchema.parse(raw);
      const hit = parsed.results[0]?.hits[0];
      if (hit) return hit;
    }

    throw new Error("No test hit found");
  }

  it("transforms to Product and validates schema", () => {
    const hit = getTestHit();
    const product = transformToProduct(hit);

    // Validate against schema
    const result = ProductSchema.safeParse(product);
    expect(result.success).toBe(true);

    // Verify key fields
    expect(product.productId).toBeTruthy();
    expect(product.name).toBeTruthy();

    console.log("Transformed Product:", {
      productId: product.productId,
      name: product.name,
      brand: product.brand,
      packSize: product.packSize,
    });
  });

  it("transforms to StoreProduct and validates schema", () => {
    const hit = getTestHit();
    const storeProduct = transformToStoreProduct(hit);

    // Validate against schema
    const result = StoreProductSchema.safeParse(storeProduct);
    expect(result.success).toBe(true);

    // Verify key fields
    expect(storeProduct.productId).toBeTruthy();
    expect(storeProduct.storeNumber).toBeTruthy();

    console.log("Transformed StoreProduct:", {
      productId: storeProduct.productId,
      storeNumber: storeProduct.storeNumber,
      priceInStore: storeProduct.priceInStore,
      aisle: storeProduct.aisle,
    });
  });

  it("transforms to Serving and validates schema", () => {
    const hit = getTestHit();
    const serving = transformToServing(hit);

    if (serving) {
      // Validate against schema
      const result = ServingSchema.safeParse(serving);
      expect(result.success).toBe(true);

      console.log("Transformed Serving:", serving);
    } else {
      console.log("No serving data in test hit");
    }
  });

  it("transforms to NutritionFacts and validates schema", () => {
    const hit = getTestHit();
    const facts = transformToNutritionFacts(hit);

    // Validate each fact against schema
    for (const fact of facts) {
      const result = NutritionFactSchema.safeParse(fact);
      if (!result.success) {
        console.error("Invalid fact:", fact, result.error.format());
      }
      expect(result.success).toBe(true);
    }

    console.log(`Transformed ${facts.length} NutritionFacts`);
    if (facts.length > 0) {
      console.log("Sample facts:", facts.slice(0, 3));
    }
  });

  it("handles products without nutrition data", () => {
    // Create a minimal hit without nutrition
    const minimalHit: AlgoliaProductHit = {
      objectID: "74-99999",
      productId: "99999",
      productName: "Test Product",
      storeNumber: "74",
    };

    const product = transformToProduct(minimalHit);
    const storeProduct = transformToStoreProduct(minimalHit);
    const serving = transformToServing(minimalHit);
    const facts = transformToNutritionFacts(minimalHit);

    expect(ProductSchema.safeParse(product).success).toBe(true);
    expect(StoreProductSchema.safeParse(storeProduct).success).toBe(true);
    expect(serving).toBeNull();
    expect(facts).toHaveLength(0);
  });
});
