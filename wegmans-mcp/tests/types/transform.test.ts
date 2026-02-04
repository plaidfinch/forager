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
});
