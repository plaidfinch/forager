/**
 * Tests for database connection management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  openDatabases,
  openStoreDatabase,
  getSettingsDb,
  getStoresDb,
  getStoreDataDb,
  getActiveStoreNumber,
  closeDatabases,
} from "../../src/db/connection.js";

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
