/**
 * Integration tests for the search tool.
 *
 * These tests make real API requests to Algolia.
 * Run manually with: npm test -- tests/tools/search.integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeStoreDataSchema } from "../../src/db/schema.js";
import { getProduct } from "../../src/db/products.js";
import { searchTool } from "../../src/tools/search.js";

// Skip in CI - these require network access
const SKIP_INTEGRATION = process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

// Known working API key and store from exploration
const TEST_API_KEY = "9a10b1401634e9a6e55161c3a60c200d";
const TEST_STORE = "74"; // Geneva, NY

describe.skipIf(SKIP_INTEGRATION)("searchTool (integration)", () => {
  let db: Database.Database;

  beforeEach(() => {
    // Using per-store database schema
    db = new Database(":memory:");
    initializeStoreDataSchema(db);
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

    // Check a specific product has expected structure
    // In per-store database design, product contains pricing/location fields
    const firstProduct = db
      .prepare("SELECT product_id FROM products LIMIT 1")
      .get() as { product_id: string } | undefined;

    if (firstProduct) {
      const product = getProduct(db, firstProduct.product_id);

      console.log("Sample product:", {
        id: product?.productId,
        name: product?.name,
        brand: product?.brand,
        price: product?.priceInStore,
        aisle: product?.aisle,
      });

      expect(product).not.toBeNull();
      expect(product?.name).toBeTruthy();
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
    // Verify error indicates authentication/authorization failure
    expect(result.error).toMatch(/invalid|unauthorized|forbidden|403|401/i);
  });
});
