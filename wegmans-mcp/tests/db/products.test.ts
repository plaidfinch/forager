/**
 * Tests for product CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore } from "../../src/db/stores.js";
import {
  upsertProduct,
  getProduct,
  upsertStoreProduct,
  getStoreProduct,
  getStoreProductsByProduct,
  upsertServing,
  getServing,
  upsertNutritionFacts,
  getNutritionFacts,
  deleteProduct,
} from "../../src/db/products.js";
import type {
  Product,
  StoreProduct,
  Serving,
  NutritionFact,
  Store,
} from "../../src/types/product.js";

describe("Product CRUD Operations", () => {
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

  const testProduct: Product = {
    productId: "94427",
    name: "Wegmans Vitamin D Whole Milk",
    brand: "Wegmans",
    description: "Fresh whole milk with Vitamin D",
    packSize: "1 gallon",
    imageUrl: "https://wegmans.com/img/94427.jpg",
    ingredients: "Milk, Vitamin D3",
    allergens: "Contains: Milk",
    isSoldByWeight: false,
    isAlcohol: false,
    upc: "077890123456",
  };

  const testStoreProduct: StoreProduct = {
    productId: "94427",
    storeNumber: "74",
    priceInStore: 2.99,
    priceInStoreLoyalty: 2.79,
    priceDelivery: 3.49,
    priceDeliveryLoyalty: 3.29,
    unitPrice: "$2.99/gallon",
    aisle: "Dairy",
    shelf: "1",
    isAvailable: true,
    isSoldAtStore: true,
    lastUpdated: "2024-01-15T10:00:00Z",
  };

  const testServing: Serving = {
    productId: "94427",
    servingSize: "240",
    servingSizeUnit: "mL",
    servingsPerContainer: "about 16",
    householdMeasurement: "1 cup",
  };

  const testNutritionFacts: NutritionFact[] = [
    {
      productId: "94427",
      nutrient: "Calories",
      quantity: 150,
      unit: null,
      percentDaily: 0,
      category: "general",
    },
    {
      productId: "94427",
      nutrient: "Total Fat",
      quantity: 8,
      unit: "g",
      percentDaily: 10,
      category: "general",
    },
    {
      productId: "94427",
      nutrient: "Vitamin D",
      quantity: 3,
      unit: "mcg",
      percentDaily: 15,
      category: "vitamin",
    },
  ];

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    // Insert test store for foreign key constraints
    upsertStore(db, testStore);
  });

  afterEach(() => {
    db.close();
  });

  describe("upsertProduct", () => {
    it("inserts a new product", () => {
      upsertProduct(db, testProduct);

      const result = db
        .prepare(`SELECT * FROM products WHERE product_id = ?`)
        .get("94427") as Record<string, unknown>;

      expect(result).toBeDefined();
      expect(result["product_id"]).toBe("94427");
      expect(result["name"]).toBe("Wegmans Vitamin D Whole Milk");
      expect(result["brand"]).toBe("Wegmans");
    });

    it("updates existing product on conflict", () => {
      upsertProduct(db, testProduct);
      upsertProduct(db, { ...testProduct, name: "Updated Milk" });

      const count = db
        .prepare(`SELECT COUNT(*) as c FROM products`)
        .get() as { c: number };

      const result = getProduct(db, "94427");

      expect(count.c).toBe(1);
      expect(result?.name).toBe("Updated Milk");
    });

    it("handles null fields correctly", () => {
      const minimalProduct: Product = {
        productId: "99999",
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

      upsertProduct(db, minimalProduct);

      const result = getProduct(db, "99999");

      expect(result).toBeDefined();
      expect(result?.brand).toBeNull();
      expect(result?.description).toBeNull();
    });
  });

  describe("getProduct", () => {
    it("returns product by ID", () => {
      upsertProduct(db, testProduct);

      const result = getProduct(db, "94427");

      expect(result).toBeDefined();
      expect(result?.productId).toBe("94427");
      expect(result?.name).toBe("Wegmans Vitamin D Whole Milk");
    });

    it("returns null for non-existent product", () => {
      const result = getProduct(db, "99999");

      expect(result).toBeNull();
    });

    it("converts boolean fields correctly", () => {
      upsertProduct(db, testProduct);

      const result = getProduct(db, "94427");

      expect(result?.isSoldByWeight).toBe(false);
      expect(result?.isAlcohol).toBe(false);
    });
  });

  describe("upsertStoreProduct", () => {
    it("inserts store-specific product data", () => {
      upsertProduct(db, testProduct);
      upsertStoreProduct(db, testStoreProduct);

      const result = db
        .prepare(
          `SELECT * FROM store_products WHERE product_id = ? AND store_number = ?`
        )
        .get("94427", "74") as Record<string, unknown>;

      expect(result).toBeDefined();
      expect(result["price_in_store"]).toBe(2.99);
      expect(result["aisle"]).toBe("Dairy");
    });

    it("updates existing store product on conflict", () => {
      upsertProduct(db, testProduct);
      upsertStoreProduct(db, testStoreProduct);
      upsertStoreProduct(db, { ...testStoreProduct, priceInStore: 3.99 });

      const result = getStoreProduct(db, "94427", "74");

      expect(result?.priceInStore).toBe(3.99);
    });
  });

  describe("getStoreProduct", () => {
    it("returns store-specific product data", () => {
      upsertProduct(db, testProduct);
      upsertStoreProduct(db, testStoreProduct);

      const result = getStoreProduct(db, "94427", "74");

      expect(result).toBeDefined();
      expect(result?.productId).toBe("94427");
      expect(result?.storeNumber).toBe("74");
      expect(result?.priceInStore).toBe(2.99);
      expect(result?.aisle).toBe("Dairy");
    });

    it("returns null for non-existent store product", () => {
      const result = getStoreProduct(db, "94427", "74");

      expect(result).toBeNull();
    });
  });

  describe("getStoreProductsByProduct", () => {
    it("returns all store listings for a product", () => {
      upsertProduct(db, testProduct);
      upsertStore(db, { ...testStore, storeNumber: "75", name: "Rochester" });

      upsertStoreProduct(db, testStoreProduct);
      upsertStoreProduct(db, {
        ...testStoreProduct,
        storeNumber: "75",
        priceInStore: 3.19,
      });

      const result = getStoreProductsByProduct(db, "94427");

      expect(result.length).toBe(2);
      expect(result.map((sp) => sp.storeNumber).sort()).toEqual(["74", "75"]);
    });

    it("returns empty array for product with no store listings", () => {
      upsertProduct(db, testProduct);

      const result = getStoreProductsByProduct(db, "94427");

      expect(result).toEqual([]);
    });
  });

  describe("upsertServing", () => {
    it("inserts serving information", () => {
      upsertProduct(db, testProduct);
      upsertServing(db, testServing);

      const result = db
        .prepare(`SELECT * FROM servings WHERE product_id = ?`)
        .get("94427") as Record<string, unknown>;

      expect(result).toBeDefined();
      expect(result["serving_size"]).toBe("240");
      expect(result["household_measurement"]).toBe("1 cup");
    });

    it("updates existing serving on conflict", () => {
      upsertProduct(db, testProduct);
      upsertServing(db, testServing);
      upsertServing(db, { ...testServing, servingSize: "250" });

      const result = getServing(db, "94427");

      expect(result?.servingSize).toBe("250");
    });
  });

  describe("getServing", () => {
    it("returns serving information", () => {
      upsertProduct(db, testProduct);
      upsertServing(db, testServing);

      const result = getServing(db, "94427");

      expect(result).toBeDefined();
      expect(result?.productId).toBe("94427");
      expect(result?.servingSize).toBe("240");
    });

    it("returns null for product without serving info", () => {
      upsertProduct(db, testProduct);

      const result = getServing(db, "94427");

      expect(result).toBeNull();
    });
  });

  describe("upsertNutritionFacts", () => {
    it("inserts multiple nutrition facts", () => {
      upsertProduct(db, testProduct);
      upsertNutritionFacts(db, testNutritionFacts);

      const results = db
        .prepare(`SELECT * FROM nutrition_facts WHERE product_id = ?`)
        .all("94427") as Array<Record<string, unknown>>;

      expect(results.length).toBe(3);
    });

    it("updates existing nutrition facts on conflict", () => {
      upsertProduct(db, testProduct);
      upsertNutritionFacts(db, testNutritionFacts);
      upsertNutritionFacts(db, [
        { ...testNutritionFacts[0]!, quantity: 160 },
      ]);

      const result = getNutritionFacts(db, "94427");
      const calories = result.find((f) => f.nutrient === "Calories");

      expect(calories?.quantity).toBe(160);
    });

    it("handles empty array", () => {
      upsertProduct(db, testProduct);
      upsertNutritionFacts(db, []);

      const result = getNutritionFacts(db, "94427");

      expect(result).toEqual([]);
    });
  });

  describe("getNutritionFacts", () => {
    it("returns all nutrition facts for a product", () => {
      upsertProduct(db, testProduct);
      upsertNutritionFacts(db, testNutritionFacts);

      const result = getNutritionFacts(db, "94427");

      expect(result.length).toBe(3);
      expect(result.find((f) => f.nutrient === "Calories")).toBeDefined();
      expect(result.find((f) => f.category === "vitamin")).toBeDefined();
    });

    it("returns empty array for product without nutrition facts", () => {
      upsertProduct(db, testProduct);

      const result = getNutritionFacts(db, "94427");

      expect(result).toEqual([]);
    });
  });

  describe("deleteProduct", () => {
    it("deletes product and cascades to related tables", () => {
      upsertProduct(db, testProduct);
      upsertStoreProduct(db, testStoreProduct);
      upsertServing(db, testServing);
      upsertNutritionFacts(db, testNutritionFacts);

      const deleted = deleteProduct(db, "94427");

      expect(deleted).toBe(true);
      expect(getProduct(db, "94427")).toBeNull();
      expect(getStoreProduct(db, "94427", "74")).toBeNull();
      expect(getServing(db, "94427")).toBeNull();
      expect(getNutritionFacts(db, "94427")).toEqual([]);
    });

    it("returns false for non-existent product", () => {
      const deleted = deleteProduct(db, "99999");

      expect(deleted).toBe(false);
    });
  });
});
