/**
 * Database connection management for multi-database architecture.
 *
 * Three database files:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations from Wegmans API
 * - stores/{storeNumber}.db: Product data for each store
 *
 * Provides two connection types per database:
 * - Read-write connection for CRUD operations (via typed functions)
 * - Read-only connection for raw SQL queries (safe by SQLite enforcement)
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  initializeSettingsSchema,
  initializeStoresSchema,
  initializeStoreDataSchema,
} from "./schema.js";

/**
 * Connection state for multi-database architecture.
 */
export interface DatabaseConnections {
  /** Settings database (API keys, global settings) */
  settings: Database.Database;
  /** Stores database (store locations) */
  stores: Database.Database;
  /** Per-store product data (null if no store selected) */
  storeData: Database.Database | null;
  /** Read-only connection for store data queries */
  storeDataReadonly: Database.Database | null;
  /** Currently active store number */
  activeStoreNumber: string | null;
}

let connections: DatabaseConnections | null = null;

/**
 * Open settings and stores databases.
 * Creates the stores/ subdirectory for per-store databases.
 *
 * Directory structure:
 * - $dataDir/settings.db
 * - $dataDir/stores.db
 * - $dataDir/stores/ (subdirectory for store databases)
 *
 * @param dataDir - Base directory for all database files
 * @throws If databases are already open
 */
export function openDatabases(dataDir: string): void {
  if (connections !== null) {
    throw new Error("Databases already open. Close them first before opening again.");
  }

  // Create stores subdirectory if it doesn't exist
  const storesDir = join(dataDir, "stores");
  if (!existsSync(storesDir)) {
    mkdirSync(storesDir, { recursive: true });
  }

  // Open settings database
  const settingsPath = join(dataDir, "settings.db");
  const settings = new Database(settingsPath);
  settings.pragma("foreign_keys = ON");
  initializeSettingsSchema(settings);

  // Open stores database
  const storesPath = join(dataDir, "stores.db");
  const stores = new Database(storesPath);
  stores.pragma("foreign_keys = ON");
  initializeStoresSchema(stores);

  connections = {
    settings,
    stores,
    storeData: null,
    storeDataReadonly: null,
    activeStoreNumber: null,
  };
}

/**
 * Open a store-specific database for product data.
 * Closes any previously open store database.
 *
 * @param dataDir - Base directory for all database files
 * @param storeNumber - Store number to open (e.g., "74")
 * @throws If base databases (settings/stores) are not initialized
 */
export function openStoreDatabase(dataDir: string, storeNumber: string): void {
  if (connections === null) {
    throw new Error("Databases not initialized. Call openDatabases() first.");
  }

  // Close existing store database if switching stores
  if (connections.storeData !== null) {
    if (connections.storeDataReadonly !== null && connections.storeDataReadonly !== connections.storeData) {
      connections.storeDataReadonly.close();
    }
    connections.storeData.close();
  }

  // Open store-specific database
  const storePath = join(dataDir, "stores", `${storeNumber}.db`);
  const storeData = new Database(storePath);
  storeData.pragma("foreign_keys = ON");
  initializeStoreDataSchema(storeData);

  // Open readonly connection for queries
  const storeDataReadonly = new Database(storePath, { readonly: true });

  connections.storeData = storeData;
  connections.storeDataReadonly = storeDataReadonly;
  connections.activeStoreNumber = storeNumber;
}

/**
 * Get the settings database connection.
 *
 * @throws If databases are not initialized
 */
export function getSettingsDb(): Database.Database {
  if (connections === null) {
    throw new Error("Databases not initialized. Call openDatabases() first.");
  }
  return connections.settings;
}

/**
 * Get the stores database connection.
 *
 * @throws If databases are not initialized
 */
export function getStoresDb(): Database.Database {
  if (connections === null) {
    throw new Error("Databases not initialized. Call openDatabases() first.");
  }
  return connections.stores;
}

/**
 * Get the store data database connection (read-write and read-only).
 *
 * @throws If databases are not initialized or no store is selected
 */
export function getStoreDataDb(): { db: Database.Database; readonlyDb: Database.Database } {
  if (connections === null) {
    throw new Error("Databases not initialized. Call openDatabases() first.");
  }
  if (connections.storeData === null || connections.storeDataReadonly === null) {
    throw new Error("No store selected. Call openStoreDatabase() first.");
  }
  return {
    db: connections.storeData,
    readonlyDb: connections.storeDataReadonly,
  };
}

/**
 * Get the currently active store number.
 *
 * @returns The store number or null if no store is selected
 */
export function getActiveStoreNumber(): string | null {
  if (connections === null) {
    return null;
  }
  return connections.activeStoreNumber;
}

/**
 * Close all database connections.
 * Safe to call multiple times (idempotent).
 */
export function closeDatabases(): void {
  if (connections !== null) {
    // Close store data connections first (if open)
    if (connections.storeDataReadonly !== null && connections.storeDataReadonly !== connections.storeData) {
      connections.storeDataReadonly.close();
    }
    if (connections.storeData !== null) {
      connections.storeData.close();
    }

    // Close stores and settings databases
    connections.stores.close();
    connections.settings.close();

    connections = null;
  }
}
