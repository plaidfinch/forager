/**
 * Property-based tests for database operations.
 * Verifies invariants like upsert idempotence hold for arbitrary inputs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import { initializeStoreDataSchema } from "../../src/db/schema.js";
import {
  upsertProduct,
  getProduct,
  upsertServing,
  getServing,
} from "../../src/db/products.js";
import type { Product, Serving } from "../../src/types/product.js";

describe("Database Property Tests", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Using per-store database schema (products table has all fields)
    initializeStoreDataSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  // Arbitrary generators for our types
  // In per-store database design, Product includes all fields (base + store-specific)
  const productArbitrary = fc.record({
    productId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
    name: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    brand: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
    description: fc.option(fc.string({ maxLength: 1000 }), { nil: null }),
    packSize: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    imageUrl: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
    ingredients: fc.option(fc.string({ maxLength: 2000 }), { nil: null }),
    allergens: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
    isSoldByWeight: fc.boolean(),
    isAlcohol: fc.boolean(),
    upc: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
    categoryPath: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
    tagsFilter: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
    tagsPopular: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
    priceInStore: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
    priceInStoreLoyalty: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
    priceDelivery: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
    priceDeliveryLoyalty: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
    unitPrice: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    aisle: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    shelf: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
    isAvailable: fc.option(fc.boolean(), { nil: null }),
    isSoldAtStore: fc.option(fc.boolean(), { nil: null }),
    lastUpdated: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
  }) as fc.Arbitrary<Product>;

  describe("Product upsert properties", () => {
    it("upsert is idempotent - same result after multiple upserts", () => {
      fc.assert(
        fc.property(productArbitrary, (product) => {
          upsertProduct(db, product);
          const afterFirst = getProduct(db, product.productId);

          upsertProduct(db, product);
          const afterSecond = getProduct(db, product.productId);

          // Count should be 1
          const count = db
            .prepare("SELECT COUNT(*) as c FROM products WHERE product_id = ?")
            .get(product.productId) as { c: number };

          expect(count.c).toBe(1);

          // Data should be identical
          expect(afterFirst).toEqual(afterSecond);
        }),
        { numRuns: 50 }
      );
    });

    it("upsert then get returns equivalent data", () => {
      fc.assert(
        fc.property(productArbitrary, (product) => {
          upsertProduct(db, product);
          const retrieved = getProduct(db, product.productId);

          expect(retrieved).not.toBeNull();
          expect(retrieved?.productId).toBe(product.productId);
          expect(retrieved?.name).toBe(product.name);
          expect(retrieved?.brand).toBe(product.brand);
          expect(retrieved?.isSoldByWeight).toBe(product.isSoldByWeight);
          expect(retrieved?.isAlcohol).toBe(product.isAlcohol);
        }),
        { numRuns: 50 }
      );
    });
  });

  // Note: StoreProduct upsert properties test removed - no longer needed
  // In per-store database design, all product data is in the products table

  describe("Serving upsert properties", () => {
    it("upsert is idempotent with valid foreign key", () => {
      // First create a product (with all required fields for per-store schema)
      const product: Product = {
        productId: "TESTPROD",
        name: "Test Product",
        brand: null,
        description: null,
        packSize: null,
        imageUrl: null,
        ingredients: null,
        allergens: null,
        isSoldByWeight: false,
        isAlcohol: false,
        upc: null,
        categoryPath: null,
        tagsFilter: null,
        tagsPopular: null,
        priceInStore: null,
        priceInStoreLoyalty: null,
        priceDelivery: null,
        priceDeliveryLoyalty: null,
        unitPrice: null,
        aisle: null,
        shelf: null,
        isAvailable: null,
        isSoldAtStore: null,
        lastUpdated: null,
      };
      upsertProduct(db, product);

      const servingArbitrary = fc.record({
        productId: fc.constant("TESTPROD"),
        servingSize: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
        servingSizeUnit: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
        servingsPerContainer: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
        householdMeasurement: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
      }) as fc.Arbitrary<Serving>;

      fc.assert(
        fc.property(servingArbitrary, (serving) => {
          upsertServing(db, serving);
          const afterFirst = getServing(db, serving.productId);

          upsertServing(db, serving);
          const afterSecond = getServing(db, serving.productId);

          // Count should be 1
          const count = db
            .prepare("SELECT COUNT(*) as c FROM servings WHERE product_id = ?")
            .get(serving.productId) as { c: number };

          expect(count.c).toBe(1);

          // Data should be identical
          expect(afterFirst).toEqual(afterSecond);
        }),
        { numRuns: 30 }
      );
    });
  });
});
