/**
 * Tests for the query tool.
 *
 * Uses file-based databases to test true SQLite read-only enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initializeStoreDataSchema } from "../../src/db/schema.js";
import { upsertProduct } from "../../src/db/products.js";
import { queryTool } from "../../src/tools/query.js";
import type { Product } from "../../src/types/product.js";

describe("queryTool", () => {
  let testDir: string;
  let testDbPath: string;
  let db: Database.Database;
  let readonlyDb: Database.Database;

  // In per-store database design, Product contains all fields (base + store-specific)
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
      categoryPath: null,
      tagsFilter: null,
      tagsPopular: null,
      priceInStore: 2.99,
      priceInStoreLoyalty: null,
      priceDelivery: null,
      priceDeliveryLoyalty: null,
      unitPrice: null,
      aisle: "Dairy",
      shelf: null,
      isAvailable: true,
      isSoldAtStore: true,
      lastUpdated: null,
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
      categoryPath: null,
      tagsFilter: null,
      tagsPopular: null,
      priceInStore: 2.79,
      priceInStoreLoyalty: null,
      priceDelivery: null,
      priceDeliveryLoyalty: null,
      unitPrice: null,
      aisle: "Dairy",
      shelf: null,
      isAvailable: true,
      isSoldAtStore: true,
      lastUpdated: null,
    },
  ];

  beforeEach(() => {
    // Create temp directory and file-based database
    testDir = join(tmpdir(), `wegmans-query-tool-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create and populate with read-write connection
    // Using per-store database schema (no separate store_products table)
    db = new Database(testDbPath);
    db.pragma("foreign_keys = ON");
    initializeStoreDataSchema(db);

    for (const product of testProducts) {
      upsertProduct(db, product);
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

  it("executes SELECT and returns columns and rows", () => {
    const result = queryTool(readonlyDb, "SELECT product_id, name FROM products ORDER BY product_id");

    expect(result.success).toBe(true);
    expect(result.columns).toEqual(["product_id", "name"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.rows?.[0]).toEqual({
      product_id: "94427",
      name: "Wegmans Vitamin D Whole Milk",
    });
    expect(result.rows?.[1]).toEqual({
      product_id: "94428",
      name: "Wegmans 2% Milk",
    });
    expect(result.error).toBeUndefined();
  });

  it("returns empty rows for no matches", () => {
    const result = queryTool(readonlyDb, "SELECT * FROM products WHERE brand = 'NonExistent'");

    expect(result.success).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    // Should still return columns even with no rows
    expect(result.columns).toBeDefined();
    expect(result.columns?.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("rejects non-SELECT statements", () => {
    const result = queryTool(
      readonlyDb,
      "INSERT INTO products (product_id, name, is_sold_by_weight, is_alcohol) VALUES ('99999', 'Test', 0, 0)"
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.rows).toBeUndefined();
    expect(result.columns).toBeUndefined();
    expect(result.rowCount).toBeUndefined();
  });

  it("handles SQL syntax errors gracefully", () => {
    const result = queryTool(readonlyDb, "SELEKT * FROM products");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("syntax");
    expect(result.rows).toBeUndefined();
    expect(result.columns).toBeUndefined();
    expect(result.rowCount).toBeUndefined();
  });
});
