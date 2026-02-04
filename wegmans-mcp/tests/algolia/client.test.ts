/**
 * Tests for Algolia HTTP client.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSearchRequest,
  parseSearchResponse,
  transformHitToProduct,
  transformHitToStoreProduct,
  transformHitToServing,
  transformHitToNutritionFacts,
  ALGOLIA_APP_ID,
  ALGOLIA_PRODUCTS_INDEX,
} from "../../src/algolia/client.js";
import { AlgoliaMultiQueryResponseSchema } from "../../src/types/algolia.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots", "responses");

describe("Algolia Client", () => {
  describe("constants", () => {
    it("exports correct App ID", () => {
      expect(ALGOLIA_APP_ID).toBe("QGPPR19V8V");
    });

    it("exports correct products index name", () => {
      expect(ALGOLIA_PRODUCTS_INDEX).toBe("products");
    });
  });

  describe("buildSearchRequest", () => {
    it("builds request for keyword search", () => {
      const request = buildSearchRequest({
        query: "yogurt",
        storeNumber: "74",
      });

      expect(request.requests).toBeDefined();
      expect(request.requests.length).toBeGreaterThan(0);
      expect(request.requests[0]?.query).toBe("yogurt");
      expect(request.requests[0]?.indexName).toBe("products");
    });

    it("includes store number in filters", () => {
      const request = buildSearchRequest({
        query: "milk",
        storeNumber: "74",
      });

      const filters = request.requests[0]?.filters;
      expect(filters).toContain("storeNumber:74");
    });

    it("supports hitsPerPage parameter", () => {
      const request = buildSearchRequest({
        query: "bread",
        storeNumber: "74",
        hitsPerPage: 50,
      });

      expect(request.requests[0]?.hitsPerPage).toBe(50);
    });

    it("supports page parameter for pagination", () => {
      const request = buildSearchRequest({
        query: "cheese",
        storeNumber: "74",
        page: 2,
      });

      expect(request.requests[0]?.page).toBe(2);
    });

    it("uses default hitsPerPage of 20", () => {
      const request = buildSearchRequest({
        query: "eggs",
        storeNumber: "74",
      });

      expect(request.requests[0]?.hitsPerPage).toBe(20);
    });

    it("builds request without query for browsing", () => {
      const request = buildSearchRequest({
        storeNumber: "74",
      });

      expect(request.requests[0]?.query).toBe("");
    });
  });

  describe("parseSearchResponse", () => {
    it("parses captured multi-query response", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );

      const result = parseSearchResponse(raw);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.results.length).toBeGreaterThan(0);
      expect(result.data?.results[0]?.hits.length).toBeGreaterThan(0);
    });

    it("returns error for invalid response", () => {
      const result = parseSearchResponse({ invalid: true });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("extracts hit count from response", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );

      const result = parseSearchResponse(raw);

      expect(result.data?.results[0]?.nbHits).toBeGreaterThan(0);
    });
  });

  describe("transformHitToProduct", () => {
    it("extracts product from captured hit", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );
      const parsed = AlgoliaMultiQueryResponseSchema.parse(raw);
      const hit = parsed.results[0]?.hits[0];

      expect(hit).toBeDefined();
      if (!hit) return;

      const product = transformHitToProduct(hit);

      expect(product.productId).toBeTruthy();
      expect(product.name).toBeTruthy();
      expect(typeof product.isSoldByWeight).toBe("boolean");
      expect(typeof product.isAlcohol).toBe("boolean");
    });

    it("handles missing optional fields", () => {
      const minimalHit = {
        objectID: "74-99999",
        productId: "99999",
        productName: "Test Product",
        storeNumber: "74",
      };

      const product = transformHitToProduct(minimalHit as any);

      expect(product.productId).toBe("99999");
      expect(product.name).toBe("Test Product");
      expect(product.brand).toBeNull();
      expect(product.description).toBeNull();
    });
  });

  describe("transformHitToStoreProduct", () => {
    it("extracts store product from captured hit", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );
      const parsed = AlgoliaMultiQueryResponseSchema.parse(raw);
      const hit = parsed.results[0]?.hits[0];

      expect(hit).toBeDefined();
      if (!hit) return;

      const storeProduct = transformHitToStoreProduct(hit);

      expect(storeProduct.productId).toBeTruthy();
      expect(storeProduct.storeNumber).toBeTruthy();
      expect(typeof storeProduct.isAvailable).toBe("boolean");
      expect(typeof storeProduct.isSoldAtStore).toBe("boolean");
    });

    it("extracts pricing fields", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );
      const parsed = AlgoliaMultiQueryResponseSchema.parse(raw);
      const hit = parsed.results[0]?.hits[0];

      if (!hit) return;

      const storeProduct = transformHitToStoreProduct(hit);

      // At least one price should be present
      const hasPrice =
        storeProduct.priceInStore !== null ||
        storeProduct.priceDelivery !== null;

      expect(hasPrice).toBe(true);
    });
  });

  describe("transformHitToServing", () => {
    it("extracts serving info when present", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );
      const parsed = AlgoliaMultiQueryResponseSchema.parse(raw);

      // Find a hit with nutrition data
      let serving = null;
      for (const result of parsed.results) {
        for (const hit of result.hits) {
          if (hit.nutrition?.serving) {
            serving = transformHitToServing(hit);
            break;
          }
        }
        if (serving) break;
      }

      if (serving) {
        expect(serving.productId).toBeTruthy();
      }
    });

    it("returns null when no serving data", () => {
      const minimalHit = {
        objectID: "74-99999",
        productId: "99999",
        productName: "Test Product",
        storeNumber: "74",
      };

      const serving = transformHitToServing(minimalHit as any);

      expect(serving).toBeNull();
    });
  });

  describe("transformHitToNutritionFacts", () => {
    it("extracts nutrition facts when present", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-1-200.json"), "utf-8")
      );
      const parsed = AlgoliaMultiQueryResponseSchema.parse(raw);

      // Find a hit with nutrition data
      let facts: any[] = [];
      for (const result of parsed.results) {
        for (const hit of result.hits) {
          if (hit.nutrition?.nutritions) {
            facts = transformHitToNutritionFacts(hit);
            break;
          }
        }
        if (facts.length > 0) break;
      }

      if (facts.length > 0) {
        expect(facts[0]?.productId).toBeTruthy();
        expect(facts[0]?.nutrient).toBeTruthy();
        expect(["general", "vitamin"]).toContain(facts[0]?.category);
      }
    });

    it("returns empty array when no nutrition data", () => {
      const minimalHit = {
        objectID: "74-99999",
        productId: "99999",
        productName: "Test Product",
        storeNumber: "74",
      };

      const facts = transformHitToNutritionFacts(minimalHit as any);

      expect(facts).toEqual([]);
    });
  });
});
