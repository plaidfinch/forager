/**
 * Integration tests for the search tool.
 *
 * These tests make real API requests to Algolia.
 * Run manually with: npm test -- tests/tools/search.integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore } from "../../src/db/stores.js";
import { getProduct, getStoreProduct } from "../../src/db/products.js";
import { searchTool } from "../../src/tools/search.js";
import type { Store } from "../../src/types/product.js";

// Skip in CI - these require network access
const SKIP_INTEGRATION = process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

// Known working API key and store from exploration
const TEST_API_KEY = "9a10b1401634e9a6e55161c3a60c200d";
const TEST_STORE = "74"; // Geneva, NY

describe.skipIf(SKIP_INTEGRATION)("searchTool (integration)", () => {
  let db: Database.Database;

  const testStore: Store = {
    storeNumber: TEST_STORE,
    name: "Geneva",
    city: "Geneva",
    state: "NY",
    zipCode: "14456",
    streetAddress: "300 Hamilton Street",
    latitude: 42.8647,
    longitude: -76.9977,
    hasPickup: true,
    hasDelivery: true,
    hasECommerce: true,
    lastUpdated: null,
  };

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    upsertStore(db, testStore);
  });

  afterEach(() => {
    db.close();
  });

  it("fetches and stores real products", { timeout: 30000 }, async () => {
    const result = await searchTool(db, {
      query: "milk",
      storeNumber: TEST_STORE,
      apiKey: TEST_API_KEY,
      hitsPerPage: 5,
    });

    console.log("Search tool result:", {
      success: result.success,
      productsAdded: result.productsAdded,
      totalHits: result.totalHits,
      error: result.error,
    });

    expect(result.success).toBe(true);
    expect(result.productsAdded).toBeGreaterThan(0);
    expect(result.totalHits).toBeGreaterThan(0);

    // Verify products are in the database
    const productCount = db
      .prepare("SELECT COUNT(*) as count FROM products")
      .get() as { count: number };

    expect(productCount.count).toBe(result.productsAdded);

    // Verify store products were also created
    const storeProductCount = db
      .prepare("SELECT COUNT(*) as count FROM store_products WHERE store_number = ?")
      .get(TEST_STORE) as { count: number };

    expect(storeProductCount.count).toBe(result.productsAdded);

    // Check a specific product has expected structure
    const firstProduct = db
      .prepare("SELECT product_id FROM products LIMIT 1")
      .get() as { product_id: string } | undefined;

    if (firstProduct) {
      const product = getProduct(db, firstProduct.product_id);
      const storeProduct = getStoreProduct(db, firstProduct.product_id, TEST_STORE);

      console.log("Sample product:", {
        id: product?.productId,
        name: product?.name,
        brand: product?.brand,
        price: storeProduct?.priceInStore,
        aisle: storeProduct?.aisle,
      });

      expect(product).not.toBeNull();
      expect(product?.name).toBeTruthy();
      expect(storeProduct).not.toBeNull();
      expect(storeProduct?.storeNumber).toBe(TEST_STORE);
    }
  });

  it("handles empty search results gracefully", { timeout: 30000 }, async () => {
    const result = await searchTool(db, {
      query: "xyznonexistent12345",
      storeNumber: TEST_STORE,
      apiKey: TEST_API_KEY,
    });

    expect(result.success).toBe(true);
    expect(result.productsAdded).toBe(0);
    expect(result.totalHits).toBe(0);
  });

  it("returns error with invalid API key", { timeout: 30000 }, async () => {
    const result = await searchTool(db, {
      query: "milk",
      storeNumber: TEST_STORE,
      apiKey: "invalid-key",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
