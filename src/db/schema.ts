/**
 * Database schema initialization for per-store database architecture.
 *
 * Three separate database files:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations from Wegmans API
 * - stores/{storeNumber}.db: Per-store product data
 */

import type Database from "better-sqlite3";

/**
 * Initialize schema for settings.db - API keys and global settings.
 * Safe to call multiple times (idempotent).
 */
export function initializeSettingsSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // API keys for Algolia access
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      app_id TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      expires_at TEXT
    )
  `);

  // Settings/metadata (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

/**
 * Initialize schema for stores.db - Store locations from Wegmans API.
 * Safe to call multiple times (idempotent).
 */
export function initializeStoresSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Stores table
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      store_number TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      street_address TEXT,
      latitude REAL,
      longitude REAL,
      phone_number TEXT,
      has_pickup INTEGER,
      has_delivery INTEGER,
      has_ecommerce INTEGER,
      has_pharmacy INTEGER,
      sells_alcohol INTEGER,
      open_state TEXT,
      opening_date TEXT,
      zones TEXT,
      last_updated TEXT
    )
  `);

  // Settings/metadata (key-value store for stores_last_updated, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

/**
 * Initialize schema for per-store database (stores/NNN.db) - Product data for a single store.
 * Merges products and store_products tables since each store has its own database.
 * Safe to call multiple times (idempotent).
 */
export function initializeStoreDataSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Merged products table (combines products + store_products fields)
  // No store_number needed since each store has its own database
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      product_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      description TEXT,
      pack_size TEXT,
      image_url TEXT,
      ingredients TEXT,
      allergens TEXT,
      is_sold_by_weight INTEGER NOT NULL DEFAULT 0,
      is_alcohol INTEGER NOT NULL DEFAULT 0,
      upc TEXT,
      category_path TEXT,
      tags_filter TEXT,
      tags_popular TEXT,
      price_in_store REAL,
      price_in_store_loyalty REAL,
      price_delivery REAL,
      price_delivery_loyalty REAL,
      unit_price TEXT,
      aisle TEXT,
      shelf TEXT,
      is_available INTEGER,
      is_sold_at_store INTEGER,
      last_updated TEXT
    )
  `);

  // Serving information (one per product)
  db.exec(`
    CREATE TABLE IF NOT EXISTS servings (
      product_id TEXT PRIMARY KEY,
      serving_size TEXT,
      serving_size_unit TEXT,
      servings_per_container TEXT,
      household_measurement TEXT,
      FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
    )
  `);

  // Nutrition facts (multiple per product)
  db.exec(`
    CREATE TABLE IF NOT EXISTS nutrition_facts (
      product_id TEXT NOT NULL,
      nutrient TEXT NOT NULL,
      quantity REAL,
      unit TEXT,
      percent_daily REAL,
      category TEXT NOT NULL CHECK (category IN ('general', 'vitamin')),
      PRIMARY KEY (product_id, nutrient),
      FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
    )
  `);

  // Categories ontology (for reference/browsing)
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      level INTEGER NOT NULL,
      product_count INTEGER
    )
  `);

  // Tags ontology (for reference/filtering)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      product_count INTEGER,
      PRIMARY KEY (name, type)
    )
  `);

  // Materialized junction table for product tags (replaces json_each view).
  // Drop the legacy view if migrating from an older schema.
  const productTagsType = db
    .prepare(`SELECT type FROM sqlite_master WHERE name = 'product_tags'`)
    .get() as { type: string } | undefined;
  if (productTagsType?.type === "view") {
    db.exec(`DROP VIEW product_tags`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_tags (
      product_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      tag_type TEXT NOT NULL CHECK (tag_type IN ('filter', 'popular')),
      PRIMARY KEY (product_id, tag_name, tag_type),
      FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
    )
  `);

  // View for category lookups
  db.exec(`
    CREATE VIEW IF NOT EXISTS product_categories AS
    SELECT product_id, category_path
    FROM products
    WHERE category_path IS NOT NULL
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_path);
    CREATE INDEX IF NOT EXISTS idx_products_aisle ON products(aisle);
    CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
    CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available);
    CREATE INDEX IF NOT EXISTS idx_products_price ON products(price_in_store);
    CREATE INDEX IF NOT EXISTS idx_nutrition_facts_product ON nutrition_facts(product_id);
    CREATE INDEX IF NOT EXISTS idx_nutrition_nutrient ON nutrition_facts(nutrient, quantity);
    CREATE INDEX IF NOT EXISTS idx_product_tags_name ON product_tags(tag_name, tag_type);
  `);
}
