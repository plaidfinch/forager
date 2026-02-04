/**
 * Store fetching and caching logic.
 *
 * Fetches the Wegmans store list from their API and caches in the database.
 */

import type Database from "better-sqlite3";

const STORES_API_URL = "https://www.wegmans.com/api/stores";
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface StoreInfo {
  storeNumber: string;
  name: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  streetAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  hasPickup: boolean | null;
  hasDelivery: boolean | null;
  hasECommerce: boolean | null;
}

interface ApiStore {
  storeNumber: number;
  name: string;
  city?: string;
  stateAbbreviation?: string;
  zip?: string;
  streetAddress?: string;
  latitude?: number;
  longitude?: number;
  hasPickup?: boolean;
  hasDelivery?: boolean;
  hasECommerce?: boolean;
}

/**
 * Transform API response to our StoreInfo format.
 */
function transformApiStore(apiStore: ApiStore): StoreInfo {
  return {
    storeNumber: String(apiStore.storeNumber),
    name: apiStore.name,
    city: apiStore.city ?? null,
    state: apiStore.stateAbbreviation ?? null,
    zipCode: apiStore.zip ?? null,
    streetAddress: apiStore.streetAddress ?? null,
    latitude: apiStore.latitude ?? null,
    longitude: apiStore.longitude ?? null,
    hasPickup: apiStore.hasPickup ?? null,
    hasDelivery: apiStore.hasDelivery ?? null,
    hasECommerce: apiStore.hasECommerce ?? null,
  };
}

/**
 * Fetch stores from Wegmans API.
 */
export async function fetchStoresFromApi(): Promise<StoreInfo[]> {
  const response = await fetch(STORES_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch stores: ${response.status} ${response.statusText}`);
  }

  const apiStores = (await response.json()) as ApiStore[];
  return apiStores.map(transformApiStore);
}

/**
 * Get the timestamp of the last store cache update.
 */
function getStoresCacheTimestamp(db: Database.Database): Date | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'stores_last_updated'")
    .get() as { value: string } | undefined;
  return row ? new Date(row.value) : null;
}

/**
 * Check if the stores cache is stale (>24h old).
 */
export function isStoresCacheStale(db: Database.Database): boolean {
  const lastUpdated = getStoresCacheTimestamp(db);
  if (!lastUpdated) return true;
  return Date.now() - lastUpdated.getTime() > STALE_THRESHOLD_MS;
}

/**
 * Get stores from the database cache.
 */
export function getStoresFromCache(db: Database.Database): StoreInfo[] {
  const rows = db
    .prepare(`
      SELECT store_number, name, city, state, zip_code, street_address,
             latitude, longitude, has_pickup, has_delivery, has_ecommerce
      FROM stores
      ORDER BY CAST(store_number AS INTEGER)
    `)
    .all() as Array<{
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
    }>;

  return rows.map((row) => ({
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
  }));
}

/**
 * Save stores to the database cache.
 */
export function saveStoresToCache(db: Database.Database, stores: StoreInfo[]): void {
  const upsertStore = db.prepare(`
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

  const updateTimestamp = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES ('stores_last_updated', ?)
  `);

  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    for (const store of stores) {
      upsertStore.run({
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
        lastUpdated: now,
      });
    }
    updateTimestamp.run(now);
  });

  transaction();
}

/**
 * Get stores, fetching from API if cache is stale or empty.
 * Returns cached data on fetch failure if available.
 */
export async function getStores(db: Database.Database): Promise<{
  stores: StoreInfo[];
  fromCache: boolean;
  error?: string;
}> {
  const cached = getStoresFromCache(db);
  const isStale = isStoresCacheStale(db);

  // If we have fresh cache, return it
  if (cached.length > 0 && !isStale) {
    return { stores: cached, fromCache: true };
  }

  // Try to fetch fresh data
  try {
    const fresh = await fetchStoresFromApi();
    saveStoresToCache(db, fresh);
    return { stores: fresh, fromCache: false };
  } catch (err) {
    // If fetch fails but we have stale cache, return it with warning
    if (cached.length > 0) {
      return {
        stores: cached,
        fromCache: true,
        error: `Using cached data: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // No cache and fetch failed
    throw err;
  }
}
