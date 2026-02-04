/**
 * Tests for the merged Product type.
 * Validates that the Product schema includes both base product fields
 * and store-specific fields (formerly in StoreProduct).
 */

import { describe, it, expect } from "vitest";
import { ProductSchema, type Product } from "../../src/types/product.js";

describe("ProductSchema", () => {
  // ==========================================================================
  // Base Product Fields (required)
  // ==========================================================================

  describe("base product fields", () => {
    it("accepts a minimal valid product with required fields", () => {
      const minimal = {
        productId: "12345",
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
        // Store-specific fields (all nullable)
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

      const result = ProductSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it("requires productId to be a string", () => {
      const invalid = {
        productId: 12345, // number instead of string
        name: "Test Product",
        isSoldByWeight: false,
        isAlcohol: false,
      };

      const result = ProductSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("requires name to be present", () => {
      const invalid = {
        productId: "12345",
        // missing name
        isSoldByWeight: false,
        isAlcohol: false,
      };

      const result = ProductSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // Store-Specific Fields (formerly StoreProduct)
  // ==========================================================================

  describe("store-specific fields (merged from StoreProduct)", () => {
    it("accepts store pricing fields as nullable", () => {
      const withPricing: Product = {
        productId: "12345",
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
        // Pricing fields
        priceInStore: 4.99,
        priceInStoreLoyalty: 3.99,
        priceDelivery: 5.49,
        priceDeliveryLoyalty: 4.49,
        unitPrice: "$2.99/lb",
        // Other store fields
        aisle: null,
        shelf: null,
        isAvailable: null,
        isSoldAtStore: null,
        lastUpdated: null,
      };

      const result = ProductSchema.safeParse(withPricing);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priceInStore).toBe(4.99);
        expect(result.data.priceInStoreLoyalty).toBe(3.99);
        expect(result.data.unitPrice).toBe("$2.99/lb");
      }
    });

    it("accepts store location fields (aisle, shelf)", () => {
      const withLocation: Product = {
        productId: "12345",
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
        aisle: "7",
        shelf: "A",
        isAvailable: true,
        isSoldAtStore: true,
        lastUpdated: "2025-01-15T10:30:00Z",
      };

      const result = ProductSchema.safeParse(withLocation);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aisle).toBe("7");
        expect(result.data.shelf).toBe("A");
        expect(result.data.isAvailable).toBe(true);
        expect(result.data.isSoldAtStore).toBe(true);
        expect(result.data.lastUpdated).toBe("2025-01-15T10:30:00Z");
      }
    });

    it("allows all store-specific fields to be null", () => {
      const allNullStoreFields: Product = {
        productId: "12345",
        name: "Test Product",
        brand: "Test Brand",
        description: "A test product",
        packSize: "16 oz",
        imageUrl: "https://example.com/image.jpg",
        ingredients: "Water, Sugar",
        allergens: "Contains milk",
        isSoldByWeight: false,
        isAlcohol: false,
        upc: "012345678901",
        categoryPath: "Beverages > Soft Drinks",
        tagsFilter: '["Organic"]',
        tagsPopular: '["Wegmans Brand"]',
        // All store-specific fields null
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

      const result = ProductSchema.safeParse(allNullStoreFields);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Full Product (all fields populated)
  // ==========================================================================

  describe("complete product with all fields", () => {
    it("accepts a fully populated product", () => {
      const fullProduct: Product = {
        // Base product fields
        productId: "12345",
        name: "Organic Whole Milk",
        brand: "Wegmans",
        description: "Fresh organic whole milk",
        packSize: "1 gallon",
        imageUrl: "https://example.com/milk.jpg",
        ingredients: "Organic Milk, Vitamin D3",
        allergens: "Contains: Milk",
        isSoldByWeight: false,
        isAlcohol: false,
        upc: "012345678901",
        categoryPath: "Dairy > Milk > Whole Milk",
        tagsFilter: '["Organic", "Gluten Free"]',
        tagsPopular: '["Wegmans Brand", "Family Size"]',
        // Store-specific fields
        priceInStore: 5.99,
        priceInStoreLoyalty: 4.99,
        priceDelivery: 6.49,
        priceDeliveryLoyalty: 5.49,
        unitPrice: "$5.99/gallon",
        aisle: "3",
        shelf: "B",
        isAvailable: true,
        isSoldAtStore: true,
        lastUpdated: "2025-01-15T10:30:00Z",
      };

      const result = ProductSchema.safeParse(fullProduct);
      expect(result.success).toBe(true);
      if (result.success) {
        // Verify base fields
        expect(result.data.productId).toBe("12345");
        expect(result.data.name).toBe("Organic Whole Milk");
        expect(result.data.brand).toBe("Wegmans");
        expect(result.data.categoryPath).toBe("Dairy > Milk > Whole Milk");

        // Verify store-specific fields
        expect(result.data.priceInStore).toBe(5.99);
        expect(result.data.aisle).toBe("3");
        expect(result.data.isAvailable).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Verify storeNumber is NOT in the schema (per-store DB refactor)
  // ==========================================================================

  describe("storeNumber removal", () => {
    it("does not include storeNumber field in the schema", () => {
      // Get the schema shape keys
      const schemaShape = ProductSchema.shape;
      const keys = Object.keys(schemaShape);

      expect(keys).not.toContain("storeNumber");
    });
  });

  // ==========================================================================
  // Type inference verification
  // ==========================================================================

  describe("type inference", () => {
    it("infers correct types for numeric price fields", () => {
      const product: Product = {
        productId: "12345",
        name: "Test",
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
        priceInStore: 4.99,
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

      // TypeScript should allow number or null for price fields
      const price: number | null = product.priceInStore;
      expect(typeof price).toBe("number");
    });
  });
});
