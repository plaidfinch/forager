/**
 * Database connection management.
 *
 * Provides two connection types:
 * - Read-write connection for CRUD operations (via typed functions)
 * - Read-only connection for raw SQL queries (safe by SQLite enforcement)
 */

import Database from "better-sqlite3";
import { initializeSchema } from "./schema.js";

export interface DatabaseConnection {
  /** Read-write connection for CRUD operations */
  db: Database.Database;
  /** Read-only connection for raw queries - SQLite enforces read-only at engine level */
  readonlyDb: Database.Database;
  /** Path to the database file */
  path: string;
}

let currentConnection: DatabaseConnection | null = null;

/**
 * Open database connections. Creates the database file if it doesn't exist.
 * Initializes schema if needed.
 *
 * Opens two connections:
 * - A read-write connection for CRUD operations
 * - A read-only connection for raw queries (SQLite enforces this at engine level)
 *
 * @param dbPath - Path to database file, or ":memory:" for in-memory database
 * @throws If a database is already open
 */
export function openDatabase(dbPath: string): DatabaseConnection {
  if (currentConnection !== null) {
    throw new Error("Database already open. Close it first before opening another.");
  }

  // Primary read-write connection
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  // Initialize schema (idempotent)
  initializeSchema(db);

  // Read-only connection for raw queries
  // For :memory: databases, we can't open a second readonly connection,
  // so we use the same connection but the query executor enforces read-only via parsing
  let readonlyDb: Database.Database;
  if (dbPath === ":memory:") {
    // In-memory databases can't have a separate readonly connection
    // We'll still use the same db but rely on the query parser for safety
    readonlyDb = db;
  } else {
    // File-based databases can have a true readonly connection
    readonlyDb = new Database(dbPath, { readonly: true });
  }

  currentConnection = {
    db,
    readonlyDb,
    path: dbPath,
  };

  return currentConnection;
}

/**
 * Close all database connections.
 * Safe to call multiple times (idempotent).
 */
export function closeDatabase(): void {
  if (currentConnection !== null) {
    // Close readonly connection if it's separate
    if (currentConnection.readonlyDb !== currentConnection.db) {
      currentConnection.readonlyDb.close();
    }
    currentConnection.db.close();
    currentConnection = null;
  }
}

/**
 * Get the current database connection.
 *
 * @throws If no database is open
 */
export function getDatabase(): DatabaseConnection {
  if (currentConnection === null) {
    throw new Error("No database open. Call openDatabase() first.");
  }

  return currentConnection;
}
