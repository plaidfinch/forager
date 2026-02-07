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
  closeDatabases,
  setPoolTtlMs,
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

    it("cleans up leftover .tmp files in stores directory", () => {
      // Create the stores directory and a leftover temp file
      const storesDir = join(testDir, "stores");
      mkdirSync(storesDir, { recursive: true });
      const tmpPath = join(storesDir, "74.db.tmp");
      const tmpDb = new DatabaseImpl(tmpPath);
      tmpDb.close();

      expect(existsSync(tmpPath)).toBe(true);

      openDatabases(testDir);

      expect(existsSync(tmpPath)).toBe(false);
    });

    it("does not delete .db files during cleanup", () => {
      // Create the stores directory with a real .db file
      const storesDir = join(testDir, "stores");
      mkdirSync(storesDir, { recursive: true });
      const dbPath = join(storesDir, "74.db");
      const db = new DatabaseImpl(dbPath);
      db.pragma("foreign_keys = ON");
      initializeStoreDataSchema(db);
      db.close();

      openDatabases(testDir);

      expect(existsSync(dbPath)).toBe(true);
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

      const { db } = getStoreDataDb("74");
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      expect(tables.map((t) => t.name)).toContain("products");
      expect(tables.map((t) => t.name)).toContain("servings");
      expect(tables.map((t) => t.name)).toContain("nutrition_facts");
    });

    it("keeps both stores open when switching", () => {
      openStoreDatabase(testDir, "74");
      const { db: db74 } = getStoreDataDb("74");

      // Insert data into store 74
      db74.exec(`INSERT INTO products (product_id, name) VALUES ('p1', 'Product 1')`);

      // Open store 101 as well (doesn't close 74 anymore)
      openStoreDatabase(testDir, "101");
      const { db: db101 } = getStoreDataDb("101");

      // Should be a fresh database with no products
      const products101 = db101
        .prepare(`SELECT * FROM products`)
        .all() as Array<{ product_id: string }>;
      expect(products101.length).toBe(0);

      // Store 74 should still be accessible with its data
      const { db: db74Again } = getStoreDataDb("74");
      const products74 = db74Again
        .prepare(`SELECT * FROM products`)
        .all() as Array<{ product_id: string }>;
      expect(products74.length).toBe(1);
      expect(products74[0].product_id).toBe("p1");
    });

    it("provides readonly connection for store database", () => {
      openStoreDatabase(testDir, "74");

      const { db, readonlyDb } = getStoreDataDb("74");
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

      const { db, readonlyDb } = getStoreDataDb("74");
      expect(db).toBeDefined();
      expect(readonlyDb).toBeDefined();
    });

    it("throws when store database file does not exist", () => {
      openDatabases(testDir);

      expect(() => getStoreDataDb("999")).toThrow(/not found/i);
    });

    it("throws when databases not initialized", () => {
      expect(() => getStoreDataDb("74")).toThrow(/not initialized/i);
    });
  });

  describe("closeDatabases", () => {
    it("closes all connections", () => {
      openDatabases(testDir);
      openStoreDatabase(testDir, "74");

      closeDatabases();

      expect(() => getSettingsDb()).toThrow(/not initialized/i);
      expect(() => getStoresDb()).toThrow(/not initialized/i);
      expect(() => getStoreDataDb("74")).toThrow(/not initialized/i);
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

      const { readonlyDb } = getStoreDataDb("74");

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

  describe("TTL-based eviction", () => {
    beforeEach(() => {
      openDatabases(testDir);
    });

    afterEach(() => {
      setPoolTtlMs(5 * 60 * 1000); // Reset to default
    });

    it("evicts connections that exceed the TTL", () => {
      // Set TTL to 0 so everything expires immediately
      setPoolTtlMs(0);

      // Create two store database files
      for (const num of ["1", "2"]) {
        const path = join(testDir, "stores", `${num}.db`);
        const db = new DatabaseImpl(path);
        db.pragma("foreign_keys = ON");
        initializeStoreDataSchema(db);
        db.close();
      }

      // Access store 1
      const { readonlyDb: db1a } = getStoreDataDb("1");

      // Access store 2 — this should evict store 1 (TTL=0, so store 1 is expired)
      getStoreDataDb("2");

      // Access store 1 again — should be a NEW connection (evicted and reopened)
      const { readonlyDb: db1b } = getStoreDataDb("1");
      expect(db1b).not.toBe(db1a);
    });

    it("keeps connections that are within the TTL", () => {
      // Set TTL to a very large value
      setPoolTtlMs(60 * 60 * 1000); // 1 hour

      // Create two store database files
      for (const num of ["1", "2"]) {
        const path = join(testDir, "stores", `${num}.db`);
        const db = new DatabaseImpl(path);
        db.pragma("foreign_keys = ON");
        initializeStoreDataSchema(db);
        db.close();
      }

      // Access store 1
      const { readonlyDb: db1a } = getStoreDataDb("1");

      // Access store 2
      getStoreDataDb("2");

      // Access store 1 again — should be SAME connection (within TTL)
      const { readonlyDb: db1b } = getStoreDataDb("1");
      expect(db1b).toBe(db1a);
    });
  });
});
