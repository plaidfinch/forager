/**
 * Tests for database connection management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  openDatabase,
  closeDatabase,
  getDatabase,
  type DatabaseConnection,
  openDatabases,
  openStoreDatabase,
  getSettingsDb,
  getStoresDb,
  getStoreDataDb,
  getActiveStoreNumber,
  closeDatabases,
  type DatabaseConnections,
} from "../../src/db/connection.js";

describe("Database Connection", () => {
  let testDbPath: string;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wegmans-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
  });

  afterEach(() => {
    // Ensure database is closed
    try {
      closeDatabase();
    } catch {
      // Ignore if already closed
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("openDatabase", () => {
    it("creates a new database file if it doesn't exist", () => {
      expect(existsSync(testDbPath)).toBe(false);

      const conn = openDatabase(testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
      expect(conn).toBeDefined();
      expect(conn.db).toBeDefined();
      expect(conn.readonlyDb).toBeDefined();
    });

    it("initializes schema on new database", () => {
      const conn = openDatabase(testDbPath);

      // Verify tables exist
      const tables = conn.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      expect(tables.length).toBe(9); // Schema has exactly 9 tables
      expect(tables.map((t) => t.name)).toContain("products");
      expect(tables.map((t) => t.name)).toContain("stores");
    });

    it("opens existing database without reinitializing", () => {
      // Create database and insert data
      const conn1 = openDatabase(testDbPath);
      conn1.db.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);
      closeDatabase();

      // Reopen and verify data persisted
      const conn2 = openDatabase(testDbPath);
      const stores = conn2.db
        .prepare(`SELECT * FROM stores`)
        .all() as Array<{ store_number: string; name: string }>;

      expect(stores.length).toBe(1);
      expect(stores[0]?.store_number).toBe("74");
    });

    it("enables foreign keys", () => {
      const conn = openDatabase(testDbPath);

      const result = conn.db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
      expect(result[0]?.foreign_keys).toBe(1);
    });

    it("throws if opening when already open", () => {
      openDatabase(testDbPath);

      expect(() => openDatabase(testDbPath)).toThrow(/already open/i);
    });

    it("provides separate read-only connection for file-based databases", () => {
      const conn = openDatabase(testDbPath);

      // The readonly connection should be different from the main connection
      expect(conn.readonlyDb).not.toBe(conn.db);

      // Verify readonly connection can read
      conn.db.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);
      const stores = conn.readonlyDb
        .prepare(`SELECT * FROM stores`)
        .all() as Array<{ store_number: string }>;

      expect(stores.length).toBe(1);
    });

    it("readonly connection blocks writes (SQLite enforcement)", () => {
      const conn = openDatabase(testDbPath);

      // Attempting to write via readonly connection should fail
      expect(() => {
        conn.readonlyDb.exec(`INSERT INTO stores (store_number, name) VALUES ('99', 'Test')`);
      }).toThrow(/readonly/i);
    });
  });

  describe("closeDatabase", () => {
    it("closes the database connection", () => {
      openDatabase(testDbPath);
      closeDatabase();

      // Should be able to open again after closing
      const conn = openDatabase(testDbPath);
      expect(conn).toBeDefined();
    });

    it("is idempotent - can be called multiple times", () => {
      openDatabase(testDbPath);
      closeDatabase();
      closeDatabase(); // Should not throw
    });
  });

  describe("getDatabase", () => {
    it("returns the current connection", () => {
      openDatabase(testDbPath);

      const conn = getDatabase();

      expect(conn).toBeDefined();
      expect(conn.db).toBeDefined();
      expect(conn.readonlyDb).toBeDefined();
    });

    it("throws if no database is open", () => {
      expect(() => getDatabase()).toThrow(/no.*open/i);
    });

    it("throws after database is closed", () => {
      openDatabase(testDbPath);
      closeDatabase();

      expect(() => getDatabase()).toThrow(/no.*open/i);
    });
  });

  describe("in-memory database", () => {
    it("supports :memory: path for testing", () => {
      const conn = openDatabase(":memory:");

      expect(conn).toBeDefined();

      // Verify tables exist
      const tables = conn.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      expect(tables.length).toBeGreaterThan(0);
    });

    it("uses same connection for readonly in memory mode", () => {
      const conn = openDatabase(":memory:");

      // For in-memory databases, readonly connection is the same as main
      // (can't open a separate readonly connection to :memory:)
      expect(conn.readonlyDb).toBe(conn.db);
    });
  });
});

// =============================================================================
// Multi-Database Connection Management Tests
// =============================================================================

describe("Multi-Database Connection Management", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wegmans-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Ensure databases are closed
    try {
      closeDatabases();
    } catch {
      // Ignore if already closed
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("openDatabases", () => {
    it("creates settings.db in dataDir", () => {
      openDatabases(testDir);

      expect(existsSync(join(testDir, "settings.db"))).toBe(true);
    });

    it("creates stores.db in dataDir", () => {
      openDatabases(testDir);

      expect(existsSync(join(testDir, "stores.db"))).toBe(true);
    });

    it("creates stores/ subdirectory", () => {
      openDatabases(testDir);

      expect(existsSync(join(testDir, "stores"))).toBe(true);
    });

    it("initializes settings schema with api_keys and settings tables", () => {
      openDatabases(testDir);

      const db = getSettingsDb();
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      expect(tables.map((t) => t.name)).toContain("api_keys");
      expect(tables.map((t) => t.name)).toContain("settings");
    });

    it("initializes stores schema with stores and settings tables", () => {
      openDatabases(testDir);

      const db = getStoresDb();
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      expect(tables.map((t) => t.name)).toContain("stores");
      expect(tables.map((t) => t.name)).toContain("settings");
    });

    it("throws if databases already open", () => {
      openDatabases(testDir);

      expect(() => openDatabases(testDir)).toThrow(/already open/i);
    });
  });

  describe("openStoreDatabase", () => {
    beforeEach(() => {
      openDatabases(testDir);
    });

    it("creates store-specific database in stores/ subdirectory", () => {
      openStoreDatabase(testDir, "74");

      expect(existsSync(join(testDir, "stores", "74.db"))).toBe(true);
    });

    it("initializes store data schema with products table", () => {
      openStoreDatabase(testDir, "74");

      const { db } = getStoreDataDb();
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      expect(tables.map((t) => t.name)).toContain("products");
      expect(tables.map((t) => t.name)).toContain("servings");
      expect(tables.map((t) => t.name)).toContain("nutrition_facts");
    });

    it("sets active store number", () => {
      openStoreDatabase(testDir, "74");

      expect(getActiveStoreNumber()).toBe("74");
    });

    it("switches stores - closes old database and opens new", () => {
      openStoreDatabase(testDir, "74");
      const { db: db74 } = getStoreDataDb();

      // Insert data into store 74
      db74.exec(`INSERT INTO products (product_id, name) VALUES ('p1', 'Product 1')`);

      // Switch to store 101
      openStoreDatabase(testDir, "101");
      const { db: db101 } = getStoreDataDb();

      // Should be a fresh database with no products
      const products = db101
        .prepare(`SELECT * FROM products`)
        .all() as Array<{ product_id: string }>;

      expect(products.length).toBe(0);
      expect(getActiveStoreNumber()).toBe("101");
    });

    it("provides readonly connection for store database", () => {
      openStoreDatabase(testDir, "74");

      const { db, readonlyDb } = getStoreDataDb();
      expect(readonlyDb).toBeDefined();
      expect(readonlyDb).not.toBe(db);
    });

    it("throws if base databases not initialized", () => {
      closeDatabases();

      expect(() => openStoreDatabase(testDir, "74")).toThrow(/not initialized/i);
    });
  });

  describe("getSettingsDb", () => {
    it("returns settings database when initialized", () => {
      openDatabases(testDir);

      const db = getSettingsDb();
      expect(db).toBeDefined();
    });

    it("throws when not initialized", () => {
      expect(() => getSettingsDb()).toThrow(/not initialized/i);
    });
  });

  describe("getStoresDb", () => {
    it("returns stores database when initialized", () => {
      openDatabases(testDir);

      const db = getStoresDb();
      expect(db).toBeDefined();
    });

    it("throws when not initialized", () => {
      expect(() => getStoresDb()).toThrow(/not initialized/i);
    });
  });

  describe("getStoreDataDb", () => {
    it("returns store data database when store is selected", () => {
      openDatabases(testDir);
      openStoreDatabase(testDir, "74");

      const { db, readonlyDb } = getStoreDataDb();
      expect(db).toBeDefined();
      expect(readonlyDb).toBeDefined();
    });

    it("throws when no store selected", () => {
      openDatabases(testDir);

      expect(() => getStoreDataDb()).toThrow(/no store selected/i);
    });

    it("throws when databases not initialized", () => {
      expect(() => getStoreDataDb()).toThrow(/not initialized/i);
    });
  });

  describe("getActiveStoreNumber", () => {
    it("returns null when no store selected", () => {
      openDatabases(testDir);

      expect(getActiveStoreNumber()).toBeNull();
    });

    it("returns store number when store is selected", () => {
      openDatabases(testDir);
      openStoreDatabase(testDir, "74");

      expect(getActiveStoreNumber()).toBe("74");
    });

    it("returns null when databases not initialized", () => {
      expect(getActiveStoreNumber()).toBeNull();
    });
  });

  describe("closeDatabases", () => {
    it("closes all connections", () => {
      openDatabases(testDir);
      openStoreDatabase(testDir, "74");

      closeDatabases();

      expect(() => getSettingsDb()).toThrow(/not initialized/i);
      expect(() => getStoresDb()).toThrow(/not initialized/i);
      expect(() => getStoreDataDb()).toThrow(/not initialized/i);
    });

    it("is idempotent - can be called multiple times", () => {
      openDatabases(testDir);
      closeDatabases();
      closeDatabases(); // Should not throw
    });

    it("allows reopening after close", () => {
      openDatabases(testDir);
      closeDatabases();

      openDatabases(testDir);
      expect(getSettingsDb()).toBeDefined();
    });
  });

  describe("readonly connection enforcement", () => {
    it("store data readonly connection blocks writes", () => {
      openDatabases(testDir);
      openStoreDatabase(testDir, "74");

      const { readonlyDb } = getStoreDataDb();

      expect(() => {
        readonlyDb.exec(`INSERT INTO products (product_id, name) VALUES ('p1', 'Test')`);
      }).toThrow(/readonly/i);
    });
  });
});
