/**
 * Tests for database connection management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import DatabaseImpl from "better-sqlite3";
import {
  openDatabases,
  openStoreDatabase,
  getSettingsDb,
  getStoresDb,
  getStoreDataDb,
  getActiveStoreNumber,
  closeDatabases,
} from "../../src/db/connection.js";
import { initializeStoreDataSchema } from "../../src/db/schema.js";

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

  describe("inode-based invalidation", () => {
    beforeEach(() => {
      openDatabases(testDir);
    });

    it("detects file swap and reopens connection", () => {
      openStoreDatabase(testDir, "74");

      // Write a marker into the original database
      const { db: rwDb } = getStoreDataDb("74");
      rwDb.exec(
        `INSERT INTO products (product_id, name) VALUES ('marker', 'Original')`
      );

      // Create a replacement database with different content
      const storePath = join(testDir, "stores", "74.db");
      const tmpPath = storePath + ".tmp";
      const tmpDb = new DatabaseImpl(tmpPath);
      tmpDb.pragma("foreign_keys = ON");
      initializeStoreDataSchema(tmpDb);
      tmpDb.exec(
        `INSERT INTO products (product_id, name) VALUES ('swapped', 'New')`
      );
      tmpDb.close();

      // Atomically swap the file
      renameSync(tmpPath, storePath);

      // The next call should detect the inode change and reopen
      const { readonlyDb } = getStoreDataDb("74");
      const rows = readonlyDb
        .prepare(`SELECT product_id FROM products`)
        .all() as Array<{ product_id: string }>;
      const ids = rows.map((r) => r.product_id);

      expect(ids).not.toContain("marker");
      expect(ids).toContain("swapped");
    });

    it("reuses connection when file has not changed", () => {
      openStoreDatabase(testDir, "74");
      const { readonlyDb: db1 } = getStoreDataDb("74");
      const { readonlyDb: db2 } = getStoreDataDb("74");

      // Same object reference — connection was reused, not reopened
      expect(db2).toBe(db1);
    });
  });

  describe("multi-store connection pool", () => {
    beforeEach(() => {
      openDatabases(testDir);
    });

    it("holds connections to multiple stores simultaneously", () => {
      openStoreDatabase(testDir, "74");
      openStoreDatabase(testDir, "101");

      // Both should be accessible
      const { readonlyDb: db74 } = getStoreDataDb("74");
      const { readonlyDb: db101 } = getStoreDataDb("101");

      expect(db74).toBeDefined();
      expect(db101).toBeDefined();
      expect(db74).not.toBe(db101);
    });

    it("getStoreDataDb opens store on demand if not in pool", () => {
      // Don't call openStoreDatabase — getStoreDataDb should open it lazily
      // But the file must exist on disk first
      const storePath = join(testDir, "stores", "74.db");
      const db = new DatabaseImpl(storePath);
      db.pragma("foreign_keys = ON");
      initializeStoreDataSchema(db);
      db.exec(
        `INSERT INTO products (product_id, name) VALUES ('p1', 'Test')`
      );
      db.close();

      const { readonlyDb } = getStoreDataDb("74");
      const rows = readonlyDb
        .prepare(`SELECT product_id FROM products`)
        .all() as Array<{ product_id: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].product_id).toBe("p1");
    });

    it("getStoreDataDb throws if database file does not exist", () => {
      expect(() => getStoreDataDb("999")).toThrow();
    });
  });
});
