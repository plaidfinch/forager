/**
 * Tests for database schema initialization.
 * Verifies all tables are created and schema is idempotent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";

describe("Database Schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required tables", () => {
    initializeSchema(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();

    // All 9 tables
    expect(tableNames).toContain("api_keys");
    expect(tableNames).toContain("settings");
    expect(tableNames).toContain("stores");
    expect(tableNames).toContain("products");
    expect(tableNames).toContain("store_products");
    expect(tableNames).toContain("servings");
    expect(tableNames).toContain("nutrition_facts");
    expect(tableNames).toContain("categories");
    expect(tableNames).toContain("tags");

    expect(tableNames).toHaveLength(9);
  });

  it("is idempotent - can be called multiple times without error", () => {
    initializeSchema(db);
    initializeSchema(db);
    initializeSchema(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all();
    expect(tables.length).toBeGreaterThan(0);
  });

  it("creates stores table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(stores)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("store_number");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("city");
    expect(columnNames).toContain("state");
    expect(columnNames).toContain("zip_code");
    expect(columnNames).toContain("street_address");
    expect(columnNames).toContain("latitude");
    expect(columnNames).toContain("longitude");
    expect(columnNames).toContain("has_pickup");
    expect(columnNames).toContain("has_delivery");
    expect(columnNames).toContain("has_ecommerce");
    expect(columnNames).toContain("last_updated");

    // Verify primary key
    const pkColumn = columns.find((c) => c.pk === 1);
    expect(pkColumn?.name).toBe("store_number");
  });

  it("creates products table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(products)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("product_id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("brand");
    expect(columnNames).toContain("description");
    expect(columnNames).toContain("pack_size");
    expect(columnNames).toContain("image_url");
    expect(columnNames).toContain("ingredients");
    expect(columnNames).toContain("allergens");
    expect(columnNames).toContain("is_sold_by_weight");
    expect(columnNames).toContain("is_alcohol");
    expect(columnNames).toContain("upc");

    // Verify primary key
    const pkColumn = columns.find((c) => c.pk === 1);
    expect(pkColumn?.name).toBe("product_id");
  });

  it("creates store_products table with composite primary key", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(store_products)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("product_id");
    expect(columnNames).toContain("store_number");
    expect(columnNames).toContain("price_in_store");
    expect(columnNames).toContain("price_in_store_loyalty");
    expect(columnNames).toContain("price_delivery");
    expect(columnNames).toContain("price_delivery_loyalty");
    expect(columnNames).toContain("unit_price");
    expect(columnNames).toContain("aisle");
    expect(columnNames).toContain("shelf");
    expect(columnNames).toContain("is_available");
    expect(columnNames).toContain("is_sold_at_store");
    expect(columnNames).toContain("last_updated");

    // Verify composite primary key (both columns have pk > 0)
    const pkColumns = columns.filter((c) => c.pk > 0);
    expect(pkColumns.length).toBe(2);
    expect(pkColumns.map((c) => c.name).sort()).toEqual(["product_id", "store_number"]);
  });

  it("creates servings table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(servings)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("product_id");
    expect(columnNames).toContain("serving_size");
    expect(columnNames).toContain("serving_size_unit");
    expect(columnNames).toContain("servings_per_container");
    expect(columnNames).toContain("household_measurement");

    // Verify primary key
    const pkColumn = columns.find((c) => c.pk === 1);
    expect(pkColumn?.name).toBe("product_id");
  });

  it("creates nutrition_facts table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(nutrition_facts)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("product_id");
    expect(columnNames).toContain("nutrient");
    expect(columnNames).toContain("quantity");
    expect(columnNames).toContain("unit");
    expect(columnNames).toContain("percent_daily");
    expect(columnNames).toContain("category");

    // Verify composite primary key (product_id + nutrient)
    const pkColumns = columns.filter((c) => c.pk > 0);
    expect(pkColumns.length).toBe(2);
    expect(pkColumns.map((c) => c.name).sort()).toEqual(["nutrient", "product_id"]);
  });

  it("creates api_keys table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(api_keys)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("key");
    expect(columnNames).toContain("app_id");
    expect(columnNames).toContain("extracted_at");
    expect(columnNames).toContain("expires_at");

    // Verify auto-increment primary key
    const pkColumn = columns.find((c) => c.pk === 1);
    expect(pkColumn?.name).toBe("id");
  });

  it("creates foreign key constraints", () => {
    initializeSchema(db);

    // Check store_products foreign keys
    const storeProductsFks = db
      .prepare(`PRAGMA foreign_key_list(store_products)`)
      .all() as Array<{ table: string; from: string; to: string }>;

    expect(storeProductsFks.some((fk) => fk.table === "products")).toBe(true);
    expect(storeProductsFks.some((fk) => fk.table === "stores")).toBe(true);

    // Check servings foreign key
    const servingsFks = db
      .prepare(`PRAGMA foreign_key_list(servings)`)
      .all() as Array<{ table: string; from: string; to: string }>;

    expect(servingsFks.some((fk) => fk.table === "products")).toBe(true);

    // Check nutrition_facts foreign key
    const nutritionFks = db
      .prepare(`PRAGMA foreign_key_list(nutrition_facts)`)
      .all() as Array<{ table: string; from: string; to: string }>;

    expect(nutritionFks.some((fk) => fk.table === "products")).toBe(true);
  });

  // ==========================================================================
  // Categories & Tags Schema
  // ==========================================================================

  it("creates products table with category and tag columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(products)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("category_path");
    expect(columnNames).toContain("tags_filter");
    expect(columnNames).toContain("tags_popular");
  });

  it("creates categories table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(categories)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("path");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("level");
    expect(columnNames).toContain("product_count");

    // Verify primary key
    const pkColumn = columns.find((c) => c.pk === 1);
    expect(pkColumn?.name).toBe("path");
  });

  it("creates tags table with correct columns", () => {
    initializeSchema(db);

    const columns = db
      .prepare(`PRAGMA table_info(tags)`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("name");
    expect(columnNames).toContain("type");
    expect(columnNames).toContain("product_count");

    // Verify composite primary key (name + type)
    const pkColumns = columns.filter((c) => c.pk > 0);
    expect(pkColumns.length).toBe(2);
    expect(pkColumns.map((c) => c.name).sort()).toEqual(["name", "type"]);
  });

  it("creates product_categories view", () => {
    initializeSchema(db);

    const views = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='view' AND name='product_categories'`
      )
      .all() as Array<{ name: string }>;

    expect(views.length).toBe(1);

    // Test the view works
    db.exec(`INSERT INTO products (product_id, name, category_path) VALUES ('123', 'Test', 'Dairy > Milk')`);

    const result = db
      .prepare(`SELECT * FROM product_categories WHERE product_id = '123'`)
      .all() as Array<{ product_id: string; category_path: string }>;

    expect(result.length).toBe(1);
    expect(result[0].category_path).toBe("Dairy > Milk");
  });

  it("creates product_tags view that unpacks JSON arrays", () => {
    initializeSchema(db);

    const views = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='view' AND name='product_tags'`
      )
      .all() as Array<{ name: string }>;

    expect(views.length).toBe(1);

    // Test the view unpacks JSON arrays correctly
    db.exec(`
      INSERT INTO products (product_id, name, tags_filter, tags_popular)
      VALUES ('456', 'Test', '["Organic", "Gluten Free"]', '["Wegmans Brand"]')
    `);

    const result = db
      .prepare(`SELECT * FROM product_tags WHERE product_id = '456' ORDER BY tag_name`)
      .all() as Array<{ product_id: string; tag_name: string; tag_type: string }>;

    expect(result.length).toBe(3);

    // Check filter tags
    const filterTags = result.filter((r) => r.tag_type === "filter");
    expect(filterTags.map((t) => t.tag_name).sort()).toEqual(["Gluten Free", "Organic"]);

    // Check popular tags
    const popularTags = result.filter((r) => r.tag_type === "popular");
    expect(popularTags.map((t) => t.tag_name)).toEqual(["Wegmans Brand"]);
  });

  it("includes categories, tags, and settings tables in total count", () => {
    initializeSchema(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as Array<{ name: string }>;

    // Original 6 + categories + tags + settings = 9
    expect(tables.length).toBe(9);
  });
});
