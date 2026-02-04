/**
 * Property-based tests for database operations.
 * Verifies invariants like upsert idempotence hold for arbitrary inputs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore, getStore } from "../../src/db/stores.js";
import {
  upsertProduct,
  getProduct,
  upsertStoreProduct,
  getStoreProduct,
  upsertServing,
  getServing,
} from "../../src/db/products.js";
import type { Store, Product, StoreProduct, Serving } from "../../src/types/product.js";

describe("Database Property Tests", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  // Arbitrary generators for our types
  const storeArbitrary = fc.record({
    storeNumber: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    city: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
    state: fc.option(fc.string({ maxLength: 2 }), { nil: null }),
    zipCode: fc.option(fc.string({ maxLength: 10 }), { nil: null }),
    streetAddress: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
    latitude: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: null }),
    longitude: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: null }),
    hasPickup: fc.option(fc.boolean(), { nil: null }),
    hasDelivery: fc.option(fc.boolean(), { nil: null }),
    hasECommerce: fc.option(fc.boolean(), { nil: null }),
    lastUpdated: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
  }) as fc.Arbitrary<Store>;

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
  }) as fc.Arbitrary<Product>;

  describe("Store upsert properties", () => {
    it("upsert is idempotent - same result after multiple upserts", () => {
      fc.assert(
        fc.property(storeArbitrary, (store) => {
          upsertStore(db, store);
          const afterFirst = getStore(db, store.storeNumber);

          upsertStore(db, store);
          const afterSecond = getStore(db, store.storeNumber);

          // Count should be 1
          const count = db
            .prepare("SELECT COUNT(*) as c FROM stores WHERE store_number = ?")
            .get(store.storeNumber) as { c: number };

          expect(count.c).toBe(1);

          // Data should be identical
          expect(afterFirst).toEqual(afterSecond);
        }),
        { numRuns: 50 }
      );
    });

    it("upsert then get returns equivalent data", () => {
      fc.assert(
        fc.property(storeArbitrary, (store) => {
          upsertStore(db, store);
          const retrieved = getStore(db, store.storeNumber);

          expect(retrieved).not.toBeNull();
          expect(retrieved?.storeNumber).toBe(store.storeNumber);
          expect(retrieved?.name).toBe(store.name);
          expect(retrieved?.city).toBe(store.city);
          expect(retrieved?.hasPickup).toBe(store.hasPickup);
        }),
        { numRuns: 50 }
      );
    });
  });

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

  describe("StoreProduct upsert properties", () => {
    it("upsert is idempotent with valid foreign keys", () => {
      // First create a store and product
      const store: Store = {
        storeNumber: "TEST",
        name: "Test Store",
        city: null,
        state: null,
        zipCode: null,
        streetAddress: null,
        latitude: null,
        longitude: null,
        hasPickup: null,
        hasDelivery: null,
        hasECommerce: null,
        lastUpdated: null,
      };
      upsertStore(db, store);

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
      };
      upsertProduct(db, product);

      // Now test with arbitrary store product data
      const storeProductArbitrary = fc.record({
        productId: fc.constant("TESTPROD"),
        storeNumber: fc.constant("TEST"),
        priceInStore: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
        priceInStoreLoyalty: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
        priceDelivery: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
        priceDeliveryLoyalty: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
        unitPrice: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
        aisle: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
        shelf: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
        isAvailable: fc.boolean(),
        isSoldAtStore: fc.boolean(),
        lastUpdated: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
      }) as fc.Arbitrary<StoreProduct>;

      fc.assert(
        fc.property(storeProductArbitrary, (sp) => {
          upsertStoreProduct(db, sp);
          const afterFirst = getStoreProduct(db, sp.productId, sp.storeNumber);

          upsertStoreProduct(db, sp);
          const afterSecond = getStoreProduct(db, sp.productId, sp.storeNumber);

          // Count should be 1
          const count = db
            .prepare(
              "SELECT COUNT(*) as c FROM store_products WHERE product_id = ? AND store_number = ?"
            )
            .get(sp.productId, sp.storeNumber) as { c: number };

          expect(count.c).toBe(1);

          // Data should be identical
          expect(afterFirst).toEqual(afterSecond);
        }),
        { numRuns: 30 }
      );
    });
  });

  describe("Serving upsert properties", () => {
    it("upsert is idempotent with valid foreign key", () => {
      // First create a product
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
