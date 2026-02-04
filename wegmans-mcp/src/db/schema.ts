/**
 * Database schema initialization for Wegmans product data.
 *
 * Normalized schema supporting:
 * - Multi-store product data (prices vary by store)
 * - Nutrition information
 * - API key caching
 */

import type Database from "better-sqlite3";

/**
 * Initialize all database tables. Safe to call multiple times (idempotent).
 */
export function initializeSchema(db: Database.Database): void {
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
      has_pickup INTEGER,
      has_delivery INTEGER,
      has_ecommerce INTEGER,
      last_updated TEXT
    )
  `);

  // Products table (store-independent metadata)
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
      upc TEXT
    )
  `);

  // Store-specific product data (prices, availability, aisle location)
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_products (
      product_id TEXT NOT NULL,
      store_number TEXT NOT NULL,
      price_in_store REAL,
      price_in_store_loyalty REAL,
      price_delivery REAL,
      price_delivery_loyalty REAL,
      unit_price TEXT,
      aisle TEXT,
      shelf TEXT,
      is_available INTEGER NOT NULL DEFAULT 0,
      is_sold_at_store INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT,
      PRIMARY KEY (product_id, store_number),
      FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
      FOREIGN KEY (store_number) REFERENCES stores(store_number) ON DELETE CASCADE
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

  // Create useful indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_store_products_store ON store_products(store_number);
    CREATE INDEX IF NOT EXISTS idx_store_products_product ON store_products(product_id);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_nutrition_facts_product ON nutrition_facts(product_id);
  `);
}
