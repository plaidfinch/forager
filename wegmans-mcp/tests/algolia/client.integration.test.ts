/**
 * Integration tests for Algolia HTTP client.
 *
 * These tests make real API requests to Algolia.
 * Run manually with: npm test -- tests/algolia/client.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  searchProducts,
  transformHitToProduct,
  transformHitToStoreProduct,
} from "../../src/algolia/client.js";

// Skip in CI - these require network access
const SKIP_INTEGRATION = process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

// Known working API key from exploration
const TEST_API_KEY = "9a10b1401634e9a6e55161c3a60c200d";
const TEST_STORE_NUMBER = "74"; // Geneva, NY

describe.skipIf(SKIP_INTEGRATION)("Algolia Client (integration)", () => {
  it("searches for products by keyword", { timeout: 30000 }, async () => {
    const result = await searchProducts(TEST_API_KEY, {
      query: "milk",
      storeNumber: TEST_STORE_NUMBER,
      hitsPerPage: 5,
    });

    console.log("Search result:", {
      success: result.success,
      totalHits: result.totalHits,
      hitCount: result.hits.length,
      error: result.error,
    });

    expect(result.success).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.totalHits).toBeGreaterThan(0);

    // Verify hit structure
    const firstHit = result.hits[0];
    expect(firstHit?.productName).toBeDefined();
    expect(firstHit?.storeNumber).toBe(TEST_STORE_NUMBER);
  });

  it("transforms hits to domain types", { timeout: 30000 }, async () => {
    const result = await searchProducts(TEST_API_KEY, {
      query: "yogurt",
      storeNumber: TEST_STORE_NUMBER,
      hitsPerPage: 3,
    });

    expect(result.success).toBe(true);

    for (const hit of result.hits) {
      const product = transformHitToProduct(hit);
      const storeProduct = transformHitToStoreProduct(hit);

      console.log("Product:", {
        id: product.productId,
        name: product.name,
        brand: product.brand,
      });

      console.log("StoreProduct:", {
        price: storeProduct.priceInStore,
        aisle: storeProduct.aisle,
      });

      expect(product.productId).toBeTruthy();
      expect(product.name).toBeTruthy();
      expect(storeProduct.storeNumber).toBe(TEST_STORE_NUMBER);
    }
  });

  it("handles pagination", { timeout: 30000 }, async () => {
    // First page
    const page0 = await searchProducts(TEST_API_KEY, {
      query: "bread",
      storeNumber: TEST_STORE_NUMBER,
      hitsPerPage: 5,
      page: 0,
    });

    expect(page0.success).toBe(true);
    expect(page0.page).toBe(0);
    expect(page0.totalPages).toBeGreaterThan(0);

    if (page0.totalPages > 1) {
      // Second page
      const page1 = await searchProducts(TEST_API_KEY, {
        query: "bread",
        storeNumber: TEST_STORE_NUMBER,
        hitsPerPage: 5,
        page: 1,
      });

      expect(page1.success).toBe(true);
      expect(page1.page).toBe(1);

      // Different products on different pages
      const page0Ids = page0.hits.map((h) => h.productId);
      const page1Ids = page1.hits.map((h) => h.productId);

      const overlap = page0Ids.filter((id) => page1Ids.includes(id));
      expect(overlap.length).toBe(0);
    }
  });

  it("handles empty search results gracefully", { timeout: 30000 }, async () => {
    const result = await searchProducts(TEST_API_KEY, {
      query: "xyznonexistent12345",
      storeNumber: TEST_STORE_NUMBER,
    });

    expect(result.success).toBe(true);
    expect(result.hits.length).toBe(0);
    expect(result.totalHits).toBe(0);
  });

  it("fails gracefully with invalid API key", { timeout: 30000 }, async () => {
    const result = await searchProducts("invalid-key", {
      query: "milk",
      storeNumber: TEST_STORE_NUMBER,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
