/**
 * Database connection management for multi-database architecture.
 *
 * Three database types:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations from Wegmans API
 * - stores/{storeNumber}.db: Product data for each store
 *
 * Store connections are pooled by store number with inode-based
 * invalidation: if the underlying file is atomically swapped
 * (e.g. by refreshCatalogToFile), the next access detects the
 * new inode and transparently reopens the connection.
 */

import Database from "better-sqlite3";
import { existsSync, statSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  initializeSettingsSchema,
  initializeStoresSchema,
  initializeStoreDataSchema,
} from "./schema.js";

interface CachedStoreConnection {
  db: Database.Database;
  readonlyDb: Database.Database;
  path: string;
  ino: number;
  lastAccessed: number;
}

interface ConnectionState {
  settings: Database.Database;
  stores: Database.Database;
  dataDir: string;
  storePool: Map<string, CachedStoreConnection>;
}

let state: ConnectionState | null = null;

let poolTtlMs = 5 * 60 * 1000; // 5 minutes

/** Set the pool TTL for testing. */
export function setPoolTtlMs(ms: number): void {
  poolTtlMs = ms;
}

/**
 * Open settings and stores databases.
 * Creates the stores/ subdirectory for per-store databases.
 */
export function openDatabases(dataDir: string): void {
  if (state !== null) {
    throw new Error(
      "Databases already open. Close them first before opening again."
    );
  }

  const storesDir = join(dataDir, "stores");
  if (!existsSync(storesDir)) {
    mkdirSync(storesDir, { recursive: true });
  }

  // Clean up leftover .tmp files from crashed refresh operations
  const storeFiles = readdirSync(storesDir);
  for (const file of storeFiles) {
    if (file.endsWith(".tmp")) {
      try {
        unlinkSync(join(storesDir, file));
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  const settingsPath = join(dataDir, "settings.db");
  const settings = new Database(settingsPath);
  settings.pragma("foreign_keys = ON");
  initializeSettingsSchema(settings);

  const storesPath = join(dataDir, "stores.db");
  const stores = new Database(storesPath);
  stores.pragma("foreign_keys = ON");
  initializeStoresSchema(stores);

  state = {
    settings,
    stores,
    dataDir,
    storePool: new Map(),
  };
}

/**
 * Open a store connection and add it to the pool.
 *
 * If the store is already in the pool, this is a no-op (use
 * getStoreDataDb to get the connection — it handles invalidation).
 */
export function openStoreDatabase(
  dataDir: string,
  storeNumber: string
): void {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }

  // If already in pool, skip
  if (state.storePool.has(storeNumber)) {
    return;
  }

  const entry = openStoreEntry(dataDir, storeNumber);
  state.storePool.set(storeNumber, entry);
}

/**
 * Get the settings database connection.
 */
export function getSettingsDb(): Database.Database {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }
  return state.settings;
}

/**
 * Get the stores database connection.
 */
export function getStoresDb(): Database.Database {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }
  return state.stores;
}

/**
 * Get a store's data connections (read-write and read-only).
 *
 * Checks the file inode on every call. If the file has been
 * atomically swapped (different inode), the old connections are
 * closed and fresh ones opened transparently.
 *
 * If the store is not in the pool but the file exists, it is
 * opened lazily.
 *
 * @param storeNumber - Store number to get connections for
 * @throws If databases not initialized or store file does not exist
 */
export function getStoreDataDb(storeNumber: string): {
  db: Database.Database;
  readonlyDb: Database.Database;
} {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }

  // Evict connections that haven't been accessed within the TTL
  const now = Date.now();
  for (const [key, entry] of state.storePool) {
    if (key !== storeNumber && now - entry.lastAccessed >= poolTtlMs) {
      closeStoreEntry(entry);
      state.storePool.delete(key);
    }
  }

  const cached = state.storePool.get(storeNumber);

  if (cached) {
    // Check if file was swapped (inode changed)
    const currentIno = statSync(cached.path).ino;
    if (currentIno === cached.ino) {
      cached.lastAccessed = Date.now();
      return { db: cached.db, readonlyDb: cached.readonlyDb };
    }

    // Inode changed — close stale connections, reopen below
    closeStoreEntry(cached);
    state.storePool.delete(storeNumber);
  }

  // Open lazily (or reopen after invalidation)
  const storePath = join(state.dataDir, "stores", `${storeNumber}.db`);
  if (!existsSync(storePath)) {
    throw new Error(
      `Store ${storeNumber} database not found at ${storePath}`
    );
  }

  const newEntry = openStoreEntry(state.dataDir, storeNumber);
  state.storePool.set(storeNumber, newEntry);
  return { db: newEntry.db, readonlyDb: newEntry.readonlyDb };
}

/**
 * Close all database connections.
 * Safe to call multiple times (idempotent).
 */
export function closeDatabases(): void {
  if (state !== null) {
    // Close all pooled store connections
    for (const entry of state.storePool.values()) {
      closeStoreEntry(entry);
    }
    state.storePool.clear();

    state.stores.close();
    state.settings.close();
    state = null;
  }
}

// --- Internal helpers ---

function openStoreEntry(
  dataDir: string,
  storeNumber: string
): CachedStoreConnection {
  const storePath = join(dataDir, "stores", `${storeNumber}.db`);

  const db = new Database(storePath);
  db.pragma("foreign_keys = ON");
  initializeStoreDataSchema(db);

  const readonlyDb = new Database(storePath, { readonly: true });

  const ino = statSync(storePath).ino;

  return { db, readonlyDb, path: storePath, ino, lastAccessed: Date.now() };
}

function closeStoreEntry(entry: CachedStoreConnection): void {
  try {
    if (entry.readonlyDb !== entry.db) {
      entry.readonlyDb.close();
    }
    entry.db.close();
  } catch {
    // Ignore close errors (db may already be closed)
  }
}
