/**
 * Tests for read-only SQL query execution.
 *
 * Uses file-based databases to test true SQLite read-only enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore } from "../../src/db/stores.js";
import { upsertProduct, upsertStoreProduct } from "../../src/db/products.js";
import { executeQuery, type QueryResult } from "../../src/db/queries.js";
import type { Store, Product } from "../../src/types/product.js";

describe("Read-Only SQL Query Execution", () => {
  let testDir: string;
  let testDbPath: string;
  let db: Database.Database;
  let readonlyDb: Database.Database;

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

  const testProducts: Product[] = [
    {
      productId: "94427",
      name: "Wegmans Vitamin D Whole Milk",
      brand: "Wegmans",
      description: null,
      packSize: "1 gallon",
      imageUrl: null,
      ingredients: null,
      allergens: "Contains: Milk",
      isSoldByWeight: false,
      isAlcohol: false,
      upc: null,
    },
    {
      productId: "94428",
      name: "Wegmans 2% Milk",
      brand: "Wegmans",
      description: null,
      packSize: "1 gallon",
      imageUrl: null,
      ingredients: null,
      allergens: "Contains: Milk",
      isSoldByWeight: false,
      isAlcohol: false,
      upc: null,
    },
    {
      productId: "12345",
      name: "Organic Bananas",
      brand: null,
      description: null,
      packSize: "1 lb",
      imageUrl: null,
      ingredients: null,
      allergens: null,
      isSoldByWeight: true,
      isAlcohol: false,
      upc: null,
    },
  ];

  beforeEach(() => {
    // Create temp directory and file-based database
    testDir = join(tmpdir(), `wegmans-query-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create and populate with read-write connection
    db = new Database(testDbPath);
    db.pragma("foreign_keys = ON");
    initializeSchema(db);
    upsertStore(db, testStore);

    for (const product of testProducts) {
      upsertProduct(db, product);
      upsertStoreProduct(db, {
        productId: product.productId,
        storeNumber: "74",
        priceInStore: product.productId === "94427" ? 2.99 : product.productId === "94428" ? 2.79 : 0.69,
        priceInStoreLoyalty: null,
        priceDelivery: null,
        priceDeliveryLoyalty: null,
        unitPrice: null,
        aisle: product.productId.startsWith("944") ? "Dairy" : "Produce",
        shelf: null,
        isAvailable: true,
        isSoldAtStore: true,
        lastUpdated: null,
      });
    }

    // Open read-only connection for queries
    readonlyDb = new Database(testDbPath, { readonly: true });
  });

  afterEach(() => {
    readonlyDb.close();
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("executeQuery - SELECT queries", () => {
    it("executes SELECT queries and returns rows", () => {
      const result = executeQuery(readonlyDb, "SELECT * FROM products ORDER BY product_id");

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBe(3);
    });

    it("supports positional parameters", () => {
      const result = executeQuery(
        readonlyDb,
        "SELECT * FROM products WHERE brand = ?",
        ["Wegmans"]
      );

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBe(2);
    });

    it("supports named parameters", () => {
      const result = executeQuery(
        readonlyDb,
        "SELECT * FROM products WHERE brand = @brand",
        { brand: "Wegmans" }
      );

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBe(2);
    });

    it("handles empty result sets", () => {
      const result = executeQuery(
        readonlyDb,
        "SELECT * FROM products WHERE brand = ?",
        ["NonExistent"]
      );

      expect(result.success).toBe(true);
      expect(result.rows).toEqual([]);
    });

    it("returns column names", () => {
      const result = executeQuery(readonlyDb, "SELECT product_id, name FROM products LIMIT 1");

      expect(result.success).toBe(true);
      expect(result.columns).toContain("product_id");
      expect(result.columns).toContain("name");
    });

    it("handles JOIN queries", () => {
      const result = executeQuery(
        readonlyDb,
        `SELECT p.name, sp.price_in_store, sp.aisle
         FROM products p
         JOIN store_products sp ON p.product_id = sp.product_id
         WHERE sp.aisle = ?`,
        ["Dairy"]
      );

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBe(2);
    });

    it("handles aggregate queries", () => {
      const result = executeQuery(
        readonlyDb,
        "SELECT COUNT(*) as total, AVG(price_in_store) as avg_price FROM store_products"
      );

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBe(1);
      expect((result.rows?.[0] as Record<string, unknown>)?.["total"]).toBe(3);
    });

    it("returns error for invalid SQL", () => {
      const result = executeQuery(readonlyDb, "SELECT * FROM nonexistent_table");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("no such table");
    });

    it("returns error for SQL syntax errors", () => {
      const result = executeQuery(readonlyDb, "SELEKT * FROM products");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("executeQuery - PRAGMA queries", () => {
    it("allows PRAGMA queries", () => {
      const result = executeQuery(readonlyDb, "PRAGMA table_info(products)");

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBeGreaterThan(0);
    });
  });

  describe("executeQuery - EXPLAIN queries", () => {
    it("allows EXPLAIN queries", () => {
      const result = executeQuery(readonlyDb, "EXPLAIN SELECT * FROM products");

      expect(result.success).toBe(true);
      expect(result.rows?.length).toBeGreaterThan(0);
    });
  });

  describe("executeQuery - blocks write operations", () => {
    // better-sqlite3's stmt.all() throws "This statement does not return data"
    // for non-SELECT statements before it even tries to write.
    // This is effectively the same protection - write operations fail.

    it("blocks INSERT", () => {
      const result = executeQuery(
        readonlyDb,
        "INSERT INTO products (product_id, name, is_sold_by_weight, is_alcohol) VALUES (?, ?, ?, ?)",
        ["99999", "Test", 0, 0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("blocks UPDATE", () => {
      const result = executeQuery(
        readonlyDb,
        "UPDATE products SET name = ? WHERE product_id = ?",
        ["Updated", "94427"]
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("blocks DELETE", () => {
      const result = executeQuery(
        readonlyDb,
        "DELETE FROM products WHERE product_id = ?",
        ["94427"]
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("blocks DROP", () => {
      const result = executeQuery(readonlyDb, "DROP TABLE products");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("blocks CREATE", () => {
      const result = executeQuery(
        readonlyDb,
        "CREATE TABLE test (id INTEGER PRIMARY KEY)"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
