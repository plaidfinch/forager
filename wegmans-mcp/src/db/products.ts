/**
 * Product CRUD operations.
 *
 * Handles products, store_products, servings, and nutrition_facts tables.
 */

import type Database from "better-sqlite3";
import type {
  Product,
  StoreProduct,
  Serving,
  NutritionFact,
} from "../types/product.js";

// ============================================================================
// Products
// ============================================================================

/**
 * Insert or update a product.
 */
export function upsertProduct(db: Database.Database, product: Product): void {
  const stmt = db.prepare(`
    INSERT INTO products (
      product_id, name, brand, description, pack_size,
      image_url, ingredients, allergens, is_sold_by_weight, is_alcohol, upc
    ) VALUES (
      @productId, @name, @brand, @description, @packSize,
      @imageUrl, @ingredients, @allergens, @isSoldByWeight, @isAlcohol, @upc
    )
    ON CONFLICT(product_id) DO UPDATE SET
      name = excluded.name,
      brand = excluded.brand,
      description = excluded.description,
      pack_size = excluded.pack_size,
      image_url = excluded.image_url,
      ingredients = excluded.ingredients,
      allergens = excluded.allergens,
      is_sold_by_weight = excluded.is_sold_by_weight,
      is_alcohol = excluded.is_alcohol,
      upc = excluded.upc
  `);

  stmt.run({
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    description: product.description,
    packSize: product.packSize,
    imageUrl: product.imageUrl,
    ingredients: product.ingredients,
    allergens: product.allergens,
    isSoldByWeight: product.isSoldByWeight ? 1 : 0,
    isAlcohol: product.isAlcohol ? 1 : 0,
    upc: product.upc,
  });
}

interface ProductRow {
  product_id: string;
  name: string;
  brand: string | null;
  description: string | null;
  pack_size: string | null;
  image_url: string | null;
  ingredients: string | null;
  allergens: string | null;
  is_sold_by_weight: number;
  is_alcohol: number;
  upc: string | null;
}

function rowToProduct(row: ProductRow): Product {
  return {
    productId: row.product_id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    packSize: row.pack_size,
    imageUrl: row.image_url,
    ingredients: row.ingredients,
    allergens: row.allergens,
    isSoldByWeight: row.is_sold_by_weight === 1,
    isAlcohol: row.is_alcohol === 1,
    upc: row.upc,
  };
}

/**
 * Get a product by ID.
 */
export function getProduct(db: Database.Database, productId: string): Product | null {
  const stmt = db.prepare(`SELECT * FROM products WHERE product_id = ?`);
  const row = stmt.get(productId) as ProductRow | undefined;

  if (!row) {
    return null;
  }

  return rowToProduct(row);
}

/**
 * Delete a product and all related data (cascades via foreign keys).
 */
export function deleteProduct(db: Database.Database, productId: string): boolean {
  const stmt = db.prepare(`DELETE FROM products WHERE product_id = ?`);
  const result = stmt.run(productId);

  return result.changes > 0;
}

// ============================================================================
// Store Products
// ============================================================================

/**
 * Insert or update store-specific product data.
 */
export function upsertStoreProduct(db: Database.Database, sp: StoreProduct): void {
  const stmt = db.prepare(`
    INSERT INTO store_products (
      product_id, store_number, price_in_store, price_in_store_loyalty,
      price_delivery, price_delivery_loyalty, unit_price,
      aisle, shelf, is_available, is_sold_at_store, last_updated
    ) VALUES (
      @productId, @storeNumber, @priceInStore, @priceInStoreLoyalty,
      @priceDelivery, @priceDeliveryLoyalty, @unitPrice,
      @aisle, @shelf, @isAvailable, @isSoldAtStore, @lastUpdated
    )
    ON CONFLICT(product_id, store_number) DO UPDATE SET
      price_in_store = excluded.price_in_store,
      price_in_store_loyalty = excluded.price_in_store_loyalty,
      price_delivery = excluded.price_delivery,
      price_delivery_loyalty = excluded.price_delivery_loyalty,
      unit_price = excluded.unit_price,
      aisle = excluded.aisle,
      shelf = excluded.shelf,
      is_available = excluded.is_available,
      is_sold_at_store = excluded.is_sold_at_store,
      last_updated = excluded.last_updated
  `);

  stmt.run({
    productId: sp.productId,
    storeNumber: sp.storeNumber,
    priceInStore: sp.priceInStore,
    priceInStoreLoyalty: sp.priceInStoreLoyalty,
    priceDelivery: sp.priceDelivery,
    priceDeliveryLoyalty: sp.priceDeliveryLoyalty,
    unitPrice: sp.unitPrice,
    aisle: sp.aisle,
    shelf: sp.shelf,
    isAvailable: sp.isAvailable ? 1 : 0,
    isSoldAtStore: sp.isSoldAtStore ? 1 : 0,
    lastUpdated: sp.lastUpdated,
  });
}

interface StoreProductRow {
  product_id: string;
  store_number: string;
  price_in_store: number | null;
  price_in_store_loyalty: number | null;
  price_delivery: number | null;
  price_delivery_loyalty: number | null;
  unit_price: string | null;
  aisle: string | null;
  shelf: string | null;
  is_available: number;
  is_sold_at_store: number;
  last_updated: string | null;
}

function rowToStoreProduct(row: StoreProductRow): StoreProduct {
  return {
    productId: row.product_id,
    storeNumber: row.store_number,
    priceInStore: row.price_in_store,
    priceInStoreLoyalty: row.price_in_store_loyalty,
    priceDelivery: row.price_delivery,
    priceDeliveryLoyalty: row.price_delivery_loyalty,
    unitPrice: row.unit_price,
    aisle: row.aisle,
    shelf: row.shelf,
    isAvailable: row.is_available === 1,
    isSoldAtStore: row.is_sold_at_store === 1,
    lastUpdated: row.last_updated,
  };
}

/**
 * Get store-specific product data.
 */
export function getStoreProduct(
  db: Database.Database,
  productId: string,
  storeNumber: string
): StoreProduct | null {
  const stmt = db.prepare(
    `SELECT * FROM store_products WHERE product_id = ? AND store_number = ?`
  );
  const row = stmt.get(productId, storeNumber) as StoreProductRow | undefined;

  if (!row) {
    return null;
  }

  return rowToStoreProduct(row);
}

/**
 * Get all store listings for a product.
 */
export function getStoreProductsByProduct(
  db: Database.Database,
  productId: string
): StoreProduct[] {
  const stmt = db.prepare(
    `SELECT * FROM store_products WHERE product_id = ? ORDER BY store_number`
  );
  const rows = stmt.all(productId) as StoreProductRow[];

  return rows.map(rowToStoreProduct);
}

// ============================================================================
// Servings
// ============================================================================

/**
 * Insert or update serving information.
 */
export function upsertServing(db: Database.Database, serving: Serving): void {
  const stmt = db.prepare(`
    INSERT INTO servings (
      product_id, serving_size, serving_size_unit,
      servings_per_container, household_measurement
    ) VALUES (
      @productId, @servingSize, @servingSizeUnit,
      @servingsPerContainer, @householdMeasurement
    )
    ON CONFLICT(product_id) DO UPDATE SET
      serving_size = excluded.serving_size,
      serving_size_unit = excluded.serving_size_unit,
      servings_per_container = excluded.servings_per_container,
      household_measurement = excluded.household_measurement
  `);

  stmt.run({
    productId: serving.productId,
    servingSize: serving.servingSize,
    servingSizeUnit: serving.servingSizeUnit,
    servingsPerContainer: serving.servingsPerContainer,
    householdMeasurement: serving.householdMeasurement,
  });
}

interface ServingRow {
  product_id: string;
  serving_size: string | null;
  serving_size_unit: string | null;
  servings_per_container: string | null;
  household_measurement: string | null;
}

function rowToServing(row: ServingRow): Serving {
  return {
    productId: row.product_id,
    servingSize: row.serving_size,
    servingSizeUnit: row.serving_size_unit,
    servingsPerContainer: row.servings_per_container,
    householdMeasurement: row.household_measurement,
  };
}

/**
 * Get serving information for a product.
 */
export function getServing(db: Database.Database, productId: string): Serving | null {
  const stmt = db.prepare(`SELECT * FROM servings WHERE product_id = ?`);
  const row = stmt.get(productId) as ServingRow | undefined;

  if (!row) {
    return null;
  }

  return rowToServing(row);
}

// ============================================================================
// Nutrition Facts
// ============================================================================

/**
 * Insert or update nutrition facts. Handles multiple facts at once.
 */
export function upsertNutritionFacts(
  db: Database.Database,
  facts: NutritionFact[]
): void {
  if (facts.length === 0) {
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO nutrition_facts (
      product_id, nutrient, quantity, unit, percent_daily, category
    ) VALUES (
      @productId, @nutrient, @quantity, @unit, @percentDaily, @category
    )
    ON CONFLICT(product_id, nutrient) DO UPDATE SET
      quantity = excluded.quantity,
      unit = excluded.unit,
      percent_daily = excluded.percent_daily,
      category = excluded.category
  `);

  const upsertMany = db.transaction((facts: NutritionFact[]) => {
    for (const fact of facts) {
      stmt.run({
        productId: fact.productId,
        nutrient: fact.nutrient,
        quantity: fact.quantity,
        unit: fact.unit,
        percentDaily: fact.percentDaily,
        category: fact.category,
      });
    }
  });

  upsertMany(facts);
}

interface NutritionFactRow {
  product_id: string;
  nutrient: string;
  quantity: number | null;
  unit: string | null;
  percent_daily: number | null;
  category: "general" | "vitamin";
}

function rowToNutritionFact(row: NutritionFactRow): NutritionFact {
  return {
    productId: row.product_id,
    nutrient: row.nutrient,
    quantity: row.quantity,
    unit: row.unit,
    percentDaily: row.percent_daily,
    category: row.category,
  };
}

/**
 * Get all nutrition facts for a product.
 */
export function getNutritionFacts(
  db: Database.Database,
  productId: string
): NutritionFact[] {
  const stmt = db.prepare(
    `SELECT * FROM nutrition_facts WHERE product_id = ? ORDER BY nutrient`
  );
  const rows = stmt.all(productId) as NutritionFactRow[];

  return rows.map(rowToNutritionFact);
}
