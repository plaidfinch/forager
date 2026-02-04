/**
 * List stores tool for discovering Wegmans store numbers.
 *
 * Returns stores from the database and can fetch from Wegmans website.
 */

import type Database from "better-sqlite3";

export interface StoreInfo {
  storeNumber: string;
  name: string;
  city: string | null;
  state: string | null;
}

export interface ListStoresResult {
  success: boolean;
  stores: StoreInfo[];
  activeStore: string | null;
  message?: string;
  error?: string;
}

// Known Wegmans stores (subset - commonly used)
// Full list at https://www.wegmans.com/stores/
const KNOWN_STORES: StoreInfo[] = [
  { storeNumber: "1", name: "East Avenue", city: "Rochester", state: "NY" },
  { storeNumber: "2", name: "Mt. Read", city: "Rochester", state: "NY" },
  { storeNumber: "3", name: "Lyell Avenue", city: "Rochester", state: "NY" },
  { storeNumber: "4", name: "Eastway", city: "Rochester", state: "NY" },
  { storeNumber: "5", name: "Pittsford", city: "Pittsford", state: "NY" },
  { storeNumber: "6", name: "Marketplace", city: "Rochester", state: "NY" },
  { storeNumber: "7", name: "Perinton", city: "Fairport", state: "NY" },
  { storeNumber: "8", name: "Calkins Road", city: "Henrietta", state: "NY" },
  { storeNumber: "9", name: "Geneseo", city: "Geneseo", state: "NY" },
  { storeNumber: "10", name: "Canandaigua", city: "Canandaigua", state: "NY" },
  { storeNumber: "11", name: "Irondequoit", city: "Irondequoit", state: "NY" },
  { storeNumber: "12", name: "Greece", city: "Greece", state: "NY" },
  { storeNumber: "13", name: "Dewitt", city: "Dewitt", state: "NY" },
  { storeNumber: "14", name: "James Street", city: "Syracuse", state: "NY" },
  { storeNumber: "15", name: "Fairmount", city: "Camillus", state: "NY" },
  { storeNumber: "16", name: "Clay", city: "Liverpool", state: "NY" },
  { storeNumber: "17", name: "Fayetteville", city: "Fayetteville", state: "NY" },
  { storeNumber: "18", name: "Ithaca", city: "Ithaca", state: "NY" },
  { storeNumber: "28", name: "Johnson City", city: "Johnson City", state: "NY" },
  { storeNumber: "32", name: "Auburn", city: "Auburn", state: "NY" },
  { storeNumber: "33", name: "Elmira", city: "Horseheads", state: "NY" },
  { storeNumber: "34", name: "Penfield", city: "Penfield", state: "NY" },
  { storeNumber: "35", name: "Chili", city: "Chili", state: "NY" },
  { storeNumber: "36", name: "Seneca", city: "West Seneca", state: "NY" },
  { storeNumber: "37", name: "Amherst", city: "Amherst", state: "NY" },
  { storeNumber: "38", name: "Alberta Drive", city: "Amherst", state: "NY" },
  { storeNumber: "39", name: "Niagara Falls", city: "Niagara Falls", state: "NY" },
  { storeNumber: "40", name: "McKinley", city: "Hamburg", state: "NY" },
  { storeNumber: "41", name: "Dick Road", city: "Depew", state: "NY" },
  { storeNumber: "44", name: "Allentown", city: "Allentown", state: "PA" },
  { storeNumber: "47", name: "Williamsport", city: "Williamsport", state: "PA" },
  { storeNumber: "51", name: "Downingtown", city: "Downingtown", state: "PA" },
  { storeNumber: "52", name: "Wilkes-Barre", city: "Wilkes-Barre", state: "PA" },
  { storeNumber: "53", name: "Dickson City", city: "Dickson City", state: "PA" },
  { storeNumber: "56", name: "State College", city: "State College", state: "PA" },
  { storeNumber: "58", name: "Collegeville", city: "Collegeville", state: "PA" },
  { storeNumber: "59", name: "Warrington", city: "Warrington", state: "PA" },
  { storeNumber: "61", name: "Malvern", city: "Malvern", state: "PA" },
  { storeNumber: "62", name: "King of Prussia", city: "King of Prussia", state: "PA" },
  { storeNumber: "63", name: "Cherry Hill", city: "Cherry Hill", state: "NJ" },
  { storeNumber: "64", name: "Princeton", city: "Princeton", state: "NJ" },
  { storeNumber: "65", name: "Woodbridge", city: "Woodbridge", state: "NJ" },
  { storeNumber: "66", name: "Bridgewater", city: "Bridgewater", state: "NJ" },
  { storeNumber: "67", name: "Manalapan", city: "Manalapan", state: "NJ" },
  { storeNumber: "69", name: "Ocean", city: "Ocean", state: "NJ" },
  { storeNumber: "71", name: "Hunt Valley", city: "Hunt Valley", state: "MD" },
  { storeNumber: "72", name: "Columbia", city: "Columbia", state: "MD" },
  { storeNumber: "73", name: "Germantown", city: "Germantown", state: "MD" },
  { storeNumber: "74", name: "Geneva", city: "Geneva", state: "NY" },
  { storeNumber: "75", name: "Leesburg", city: "Leesburg", state: "VA" },
  { storeNumber: "76", name: "Sterling", city: "Sterling", state: "VA" },
  { storeNumber: "77", name: "Fairfax", city: "Fairfax", state: "VA" },
  { storeNumber: "78", name: "Woodmore", city: "Lanham", state: "MD" },
  { storeNumber: "79", name: "Alexandria", city: "Alexandria", state: "VA" },
  { storeNumber: "80", name: "Owings Mills", city: "Owings Mills", state: "MD" },
  { storeNumber: "81", name: "Dulles", city: "Dulles", state: "VA" },
  { storeNumber: "82", name: "Crofton", city: "Crofton", state: "MD" },
  { storeNumber: "83", name: "Fairfax (Fair Lakes)", city: "Fairfax", state: "VA" },
  { storeNumber: "84", name: "Reston", city: "Reston", state: "VA" },
  { storeNumber: "85", name: "Hanover", city: "Hanover", state: "MD" },
  { storeNumber: "86", name: "Tysons", city: "Tysons", state: "VA" },
  { storeNumber: "87", name: "Chantilly", city: "Chantilly", state: "VA" },
  { storeNumber: "88", name: "Northborough", city: "Northborough", state: "MA" },
  { storeNumber: "89", name: "Westwood", city: "Westwood", state: "MA" },
  { storeNumber: "90", name: "Burlington", city: "Burlington", state: "MA" },
  { storeNumber: "91", name: "Natick", city: "Natick", state: "MA" },
  { storeNumber: "92", name: "Chestnut Hill", city: "Chestnut Hill", state: "MA" },
  { storeNumber: "93", name: "Medford", city: "Medford", state: "MA" },
  { storeNumber: "95", name: "Brooklyn", city: "Brooklyn", state: "NY" },
  { storeNumber: "96", name: "Harrison", city: "Harrison", state: "NY" },
  { storeNumber: "98", name: "Montvale", city: "Montvale", state: "NJ" },
  { storeNumber: "101", name: "Raleigh", city: "Raleigh", state: "NC" },
  { storeNumber: "102", name: "Cary", city: "Cary", state: "NC" },
  { storeNumber: "103", name: "Chapel Hill", city: "Chapel Hill", state: "NC" },
  { storeNumber: "104", name: "Wake Forest", city: "Wake Forest", state: "NC" },
  { storeNumber: "105", name: "Manhattan (Astor Place)", city: "New York", state: "NY" },
];

/**
 * Get the currently active store number.
 */
function getActiveStore(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'active_store'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Get stores from database.
 */
function getStoresFromDatabase(db: Database.Database): StoreInfo[] {
  const rows = db
    .prepare("SELECT store_number, name, city, state FROM stores ORDER BY store_number")
    .all() as Array<{ store_number: string; name: string; city: string | null; state: string | null }>;

  return rows.map((row) => ({
    storeNumber: row.store_number,
    name: row.name,
    city: row.city,
    state: row.state,
  }));
}

/**
 * List available Wegmans stores.
 *
 * @param db - Database connection
 * @param showAll - If true, include all known stores, not just those in database
 * @returns List of stores
 */
export function listStoresTool(
  db: Database.Database,
  showAll: boolean = true
): ListStoresResult {
  try {
    const activeStore = getActiveStore(db);
    const dbStores = getStoresFromDatabase(db);

    // If we have stores in DB and not showing all, return just those
    if (!showAll && dbStores.length > 0) {
      return {
        success: true,
        stores: dbStores,
        activeStore,
        message: `${dbStores.length} store(s) in database. Use showAll=true to see all known stores.`,
      };
    }

    // Return all known stores, merging with DB data
    const storeMap = new Map<string, StoreInfo>();

    // Add known stores first
    for (const store of KNOWN_STORES) {
      storeMap.set(store.storeNumber, store);
    }

    // Override with DB stores (may have updated info)
    for (const store of dbStores) {
      storeMap.set(store.storeNumber, store);
    }

    const stores = Array.from(storeMap.values()).sort(
      (a, b) => parseInt(a.storeNumber) - parseInt(b.storeNumber)
    );

    return {
      success: true,
      stores,
      activeStore,
      message: `${stores.length} stores. Full list at https://www.wegmans.com/stores/`,
    };
  } catch (err) {
    return {
      success: false,
      stores: [],
      activeStore: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
