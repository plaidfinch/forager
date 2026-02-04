/**
 * Tests for the search tool.
 *
 * Uses mocked Algolia to test database population logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore } from "../../src/db/stores.js";
import {
  getProduct,
  getStoreProduct,
  getServing,
  getNutritionFacts,
} from "../../src/db/products.js";
import { searchTool } from "../../src/tools/search.js";
import type { SearchResult } from "../../src/algolia/client.js";
import type { AlgoliaProductHit } from "../../src/types/algolia.js";
import type { Store } from "../../src/types/product.js";

describe("searchTool", () => {
  let db: Database.Database;

  const testStore: Store = {
    storeNumber: "74",
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

  // Mock hit with full data
  const mockHit: AlgoliaProductHit = {
    objectID: "74-94427",
    productId: "94427",
    productName: "Wegmans Vitamin D Whole Milk",
    consumerBrandName: "Wegmans",
    productDescription: "Fresh whole milk",
    packSize: "1 gallon",
    images: ["https://wegmans.com/img/94427.jpg"],
    ingredients: "Milk, Vitamin D3",
    allergensAndWarnings: "Contains: Milk",
    isSoldByWeight: false,
    isAlcoholItem: false,
    upc: ["077890123456"],
    storeNumber: "74",
    price_inStore: { amount: 2.99, unitPrice: "$2.99/gallon" },
    price_inStoreLoyalty: { amount: 2.79 },
    price_delivery: { amount: 3.49 },
    price_deliveryLoyalty: { amount: 3.29 },
    planogram: { aisle: "Dairy", shelf: "1" },
    isAvailable: true,
    isSoldAtStore: true,
    lastUpdated: "2024-01-15T10:00:00Z",
    nutrition: {
      serving: {
        servingSize: "240",
        servingSizeUom: "mL",
        servingsPerContainer: "about 16",
        householdMeasurement: "1 cup",
      },
      nutritions: [
        {
          general: [
            { name: "Calories", quantity: 150, unitOfMeasure: null, percentOfDaily: 0 },
            { name: "Total Fat", quantity: 8, unitOfMeasure: "g", percentOfDaily: 10 },
          ],
          vitamins: [
            { name: "Vitamin D", quantity: 3, unitOfMeasure: "mcg", percentOfDaily: 15 },
          ],
        },
      ],
    },
  };

  // Mock hit without nutrition data
  const mockHitNoNutrition: AlgoliaProductHit = {
    objectID: "74-94428",
    productId: "94428",
    productName: "Wegmans 2% Milk",
    storeNumber: "74",
    price_inStore: { amount: 2.79 },
    isAvailable: true,
    isSoldAtStore: true,
  };

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    upsertStore(db, testStore);
  });

  afterEach(() => {
    db.close();
  });

  describe("populates database with search results", () => {
    it("inserts products from Algolia hits", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: true,
        hits: [mockHit, mockHitNoNutrition],
        totalHits: 2,
        page: 0,
        totalPages: 1,
      });

      const result = await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        searchFn: mockSearchFn,
      });

      expect(result.success).toBe(true);
      expect(result.productsAdded).toBe(2);
      expect(result.totalHits).toBe(2);

      // Verify product was inserted
      const product = getProduct(db, "94427");
      expect(product).not.toBeNull();
      expect(product?.name).toBe("Wegmans Vitamin D Whole Milk");
      expect(product?.brand).toBe("Wegmans");
    });

    it("inserts store product data", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: true,
        hits: [mockHit],
        totalHits: 1,
        page: 0,
        totalPages: 1,
      });

      await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        searchFn: mockSearchFn,
      });

      const storeProduct = getStoreProduct(db, "94427", "74");
      expect(storeProduct).not.toBeNull();
      expect(storeProduct?.priceInStore).toBe(2.99);
      expect(storeProduct?.aisle).toBe("Dairy");
    });

    it("inserts serving information when present", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: true,
        hits: [mockHit],
        totalHits: 1,
        page: 0,
        totalPages: 1,
      });

      await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        searchFn: mockSearchFn,
      });

      const serving = getServing(db, "94427");
      expect(serving).not.toBeNull();
      expect(serving?.servingSize).toBe("240");
      expect(serving?.householdMeasurement).toBe("1 cup");
    });

    it("inserts nutrition facts when present", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: true,
        hits: [mockHit],
        totalHits: 1,
        page: 0,
        totalPages: 1,
      });

      await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        searchFn: mockSearchFn,
      });

      const facts = getNutritionFacts(db, "94427");
      expect(facts.length).toBe(3);
      expect(facts.find((f) => f.nutrient === "Calories")).toBeDefined();
      expect(facts.find((f) => f.nutrient === "Vitamin D")).toBeDefined();
    });

    it("handles hits without nutrition data", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: true,
        hits: [mockHitNoNutrition],
        totalHits: 1,
        page: 0,
        totalPages: 1,
      });

      const result = await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        searchFn: mockSearchFn,
      });

      expect(result.success).toBe(true);
      expect(result.productsAdded).toBe(1);

      const product = getProduct(db, "94428");
      expect(product).not.toBeNull();

      const serving = getServing(db, "94428");
      expect(serving).toBeNull();

      const facts = getNutritionFacts(db, "94428");
      expect(facts).toEqual([]);
    });

    it("passes hitsPerPage option to search function", async () => {
      let capturedHitsPerPage: number | undefined;

      const mockSearchFn = async (_apiKey: string, options: { hitsPerPage?: number }): Promise<SearchResult> => {
        capturedHitsPerPage = options.hitsPerPage;
        return {
          success: true,
          hits: [],
          totalHits: 0,
          page: 0,
          totalPages: 0,
        };
      };

      await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        hitsPerPage: 50,
        searchFn: mockSearchFn,
      });

      expect(capturedHitsPerPage).toBe(50);
    });
  });

  describe("returns error when Algolia fails", () => {
    it("returns error from failed search", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: false,
        hits: [],
        totalHits: 0,
        page: 0,
        totalPages: 0,
        error: "Invalid API key",
      });

      const result = await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "bad-key",
        searchFn: mockSearchFn,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid API key");
      expect(result.productsAdded).toBeUndefined();
    });

    it("does not insert any products when search fails", async () => {
      const mockSearchFn = async (): Promise<SearchResult> => ({
        success: false,
        hits: [],
        totalHits: 0,
        page: 0,
        totalPages: 0,
        error: "Network error",
      });

      await searchTool(db, {
        query: "milk",
        storeNumber: "74",
        apiKey: "test-key",
        searchFn: mockSearchFn,
      });

      // Verify no products were inserted
      const result = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
      expect(result.count).toBe(0);
    });
  });
});
