/**
 * Store CRUD operations.
 */

import type Database from "better-sqlite3";
import type { Store } from "../types/product.js";

/**
 * Insert or update a store. Uses SQLite upsert (INSERT ... ON CONFLICT).
 */
export function upsertStore(db: Database.Database, store: Store): void {
  const stmt = db.prepare(`
    INSERT INTO stores (
      store_number, name, city, state, zip_code, street_address,
      latitude, longitude, has_pickup, has_delivery, has_ecommerce, last_updated
    ) VALUES (
      @storeNumber, @name, @city, @state, @zipCode, @streetAddress,
      @latitude, @longitude, @hasPickup, @hasDelivery, @hasECommerce, @lastUpdated
    )
    ON CONFLICT(store_number) DO UPDATE SET
      name = excluded.name,
      city = excluded.city,
      state = excluded.state,
      zip_code = excluded.zip_code,
      street_address = excluded.street_address,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      has_pickup = excluded.has_pickup,
      has_delivery = excluded.has_delivery,
      has_ecommerce = excluded.has_ecommerce,
      last_updated = excluded.last_updated
  `);

  stmt.run({
    storeNumber: store.storeNumber,
    name: store.name,
    city: store.city,
    state: store.state,
    zipCode: store.zipCode,
    streetAddress: store.streetAddress,
    latitude: store.latitude,
    longitude: store.longitude,
    hasPickup: store.hasPickup === null ? null : store.hasPickup ? 1 : 0,
    hasDelivery: store.hasDelivery === null ? null : store.hasDelivery ? 1 : 0,
    hasECommerce: store.hasECommerce === null ? null : store.hasECommerce ? 1 : 0,
    lastUpdated: store.lastUpdated,
  });
}

interface StoreRow {
  store_number: string;
  name: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  street_address: string | null;
  latitude: number | null;
  longitude: number | null;
  has_pickup: number | null;
  has_delivery: number | null;
  has_ecommerce: number | null;
  last_updated: string | null;
}

function rowToStore(row: StoreRow): Store {
  return {
    storeNumber: row.store_number,
    name: row.name,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    streetAddress: row.street_address,
    latitude: row.latitude,
    longitude: row.longitude,
    hasPickup: row.has_pickup === null ? null : row.has_pickup === 1,
    hasDelivery: row.has_delivery === null ? null : row.has_delivery === 1,
    hasECommerce: row.has_ecommerce === null ? null : row.has_ecommerce === 1,
    lastUpdated: row.last_updated,
  };
}

/**
 * Get a store by store number.
 */
export function getStore(db: Database.Database, storeNumber: string): Store | null {
  const stmt = db.prepare(`SELECT * FROM stores WHERE store_number = ?`);
  const row = stmt.get(storeNumber) as StoreRow | undefined;

  if (!row) {
    return null;
  }

  return rowToStore(row);
}

/**
 * Get all stores, sorted by store number.
 */
export function getAllStores(db: Database.Database): Store[] {
  const stmt = db.prepare(`SELECT * FROM stores ORDER BY store_number`);
  const rows = stmt.all() as StoreRow[];

  return rows.map(rowToStore);
}

/**
 * Delete a store by store number.
 * @returns true if the store was deleted, false if it didn't exist
 */
export function deleteStore(db: Database.Database, storeNumber: string): boolean {
  const stmt = db.prepare(`DELETE FROM stores WHERE store_number = ?`);
  const result = stmt.run(storeNumber);

  return result.changes > 0;
}
