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
} from "../../src/types/product.js";
import {
  transformHitToProduct,
  transformHitToStoreProduct,
  transformHitToServing,
  transformHitToNutritionFacts,
} from "../../src/algolia/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots", "responses");

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
    const product = transformHitToProduct(hit);

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
    const storeProduct = transformHitToStoreProduct(hit);

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
    const serving = transformHitToServing(hit);

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
    const facts = transformHitToNutritionFacts(hit);

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

    const product = transformHitToProduct(minimalHit);
    const storeProduct = transformHitToStoreProduct(minimalHit);
    const serving = transformHitToServing(minimalHit);
    const facts = transformHitToNutritionFacts(minimalHit);

    expect(ProductSchema.safeParse(product).success).toBe(true);
    expect(StoreProductSchema.safeParse(storeProduct).success).toBe(true);
    expect(serving).toBeNull();
    expect(facts).toHaveLength(0);
  });

  // ==========================================================================
  // Category & Tag Extraction
  // ==========================================================================

  it("extracts leaf category path from hit", () => {
    const hitWithCategory: AlgoliaProductHit = {
      objectID: "74-12345",
      productId: "12345",
      productName: "Whole Milk",
      storeNumber: "74",
      categories: {
        lvl0: "Dairy",
        lvl1: "Dairy > Milk",
        lvl2: "Dairy > Milk > Whole Milk",
      },
    };

    const product = transformHitToProduct(hitWithCategory);

    // Should extract deepest level
    expect(product.categoryPath).toBe("Dairy > Milk > Whole Milk");

    // Schema should validate
    expect(ProductSchema.safeParse(product).success).toBe(true);
  });

  it("extracts filter tags as JSON string", () => {
    const hitWithTags: AlgoliaProductHit = {
      objectID: "74-12345",
      productId: "12345",
      productName: "Organic Milk",
      storeNumber: "74",
      filterTags: ["Organic", "Gluten Free"],
    };

    const product = transformHitToProduct(hitWithTags);

    expect(product.tagsFilter).toBe('["Organic","Gluten Free"]');
    expect(ProductSchema.safeParse(product).success).toBe(true);
  });

  it("extracts popular tags as JSON string", () => {
    const hitWithTags: AlgoliaProductHit = {
      objectID: "74-12345",
      productId: "12345",
      productName: "Wegmans Milk",
      storeNumber: "74",
      popularTags: ["Wegmans Brand", "Family Pack"],
    };

    const product = transformHitToProduct(hitWithTags);

    expect(product.tagsPopular).toBe('["Wegmans Brand","Family Pack"]');
    expect(ProductSchema.safeParse(product).success).toBe(true);
  });

  it("handles products without category or tags", () => {
    const hitNoTaxonomy: AlgoliaProductHit = {
      objectID: "74-99999",
      productId: "99999",
      productName: "Mystery Product",
      storeNumber: "74",
    };

    const product = transformHitToProduct(hitNoTaxonomy);

    expect(product.categoryPath).toBeNull();
    expect(product.tagsFilter).toBeNull();
    expect(product.tagsPopular).toBeNull();
    expect(ProductSchema.safeParse(product).success).toBe(true);
  });
});
