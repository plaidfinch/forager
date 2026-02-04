/**
 * Tests for store CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeStoresSchema } from "../../src/db/schema.js";
import {
  upsertStore,
  getStore,
  getAllStores,
  deleteStore,
} from "../../src/db/stores.js";
import type { Store } from "../../src/types/product.js";

describe("Store CRUD Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeStoresSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  const testStore: Store = {
    storeNumber: "74",
    name: "Geneva",
    city: "Geneva",
    state: "NY",
    zipCode: "14456",
    streetAddress: "300 Hamilton Street",
    latitude: 42.8647,
    longitude: -76.9977,
    hasPickup: true,
    hasDelivery: true,
    hasECommerce: true,
    lastUpdated: "2024-01-15T10:00:00Z",
  };

  describe("upsertStore", () => {
    it("inserts a new store", () => {
      upsertStore(db, testStore);

      const result = db
        .prepare(`SELECT * FROM stores WHERE store_number = ?`)
        .get("74") as Record<string, unknown>;

      expect(result).toBeDefined();
      expect(result["store_number"]).toBe("74");
      expect(result["name"]).toBe("Geneva");
      expect(result["city"]).toBe("Geneva");
      expect(result["state"]).toBe("NY");
    });

    it("updates existing store on conflict", () => {
      upsertStore(db, testStore);
      upsertStore(db, { ...testStore, name: "Geneva Updated" });

      const count = db
        .prepare(`SELECT COUNT(*) as c FROM stores`)
        .get() as { c: number };

      const result = getStore(db, "74");

      expect(count.c).toBe(1);
      expect(result?.name).toBe("Geneva Updated");
    });

    it("handles null fields correctly", () => {
      const minimalStore: Store = {
        storeNumber: "99",
        name: "Test Store",
        city: null,
        state: null,
        zipCode: null,
        streetAddress: null,
        latitude: null,
        longitude: null,
        hasPickup: null,
        hasDelivery: null,
        hasECommerce: null,
        lastUpdated: null,
      };

      upsertStore(db, minimalStore);

      const result = getStore(db, "99");

      expect(result).toBeDefined();
      expect(result?.storeNumber).toBe("99");
      expect(result?.city).toBeNull();
      expect(result?.latitude).toBeNull();
    });
  });

  describe("getStore", () => {
    it("returns store by store number", () => {
      upsertStore(db, testStore);

      const result = getStore(db, "74");

      expect(result).toBeDefined();
      expect(result?.storeNumber).toBe("74");
      expect(result?.name).toBe("Geneva");
      expect(result?.latitude).toBe(42.8647);
    });

    it("returns null for non-existent store", () => {
      const result = getStore(db, "99999");

      expect(result).toBeNull();
    });

    it("converts boolean fields correctly", () => {
      upsertStore(db, testStore);

      const result = getStore(db, "74");

      expect(result?.hasPickup).toBe(true);
      expect(result?.hasDelivery).toBe(true);
      expect(result?.hasECommerce).toBe(true);
    });
  });

  describe("getAllStores", () => {
    it("returns empty array when no stores", () => {
      const result = getAllStores(db);

      expect(result).toEqual([]);
    });

    it("returns all stores", () => {
      upsertStore(db, testStore);
      upsertStore(db, {
        ...testStore,
        storeNumber: "75",
        name: "Rochester",
      });

      const result = getAllStores(db);

      expect(result.length).toBe(2);
      expect(result.map((s) => s.storeNumber).sort()).toEqual(["74", "75"]);
    });

    it("returns stores sorted by store number", () => {
      upsertStore(db, { ...testStore, storeNumber: "99" });
      upsertStore(db, { ...testStore, storeNumber: "01" });
      upsertStore(db, { ...testStore, storeNumber: "50" });

      const result = getAllStores(db);

      expect(result.map((s) => s.storeNumber)).toEqual(["01", "50", "99"]);
    });
  });

  describe("deleteStore", () => {
    it("deletes existing store", () => {
      upsertStore(db, testStore);

      const deleted = deleteStore(db, "74");

      expect(deleted).toBe(true);
      expect(getStore(db, "74")).toBeNull();
    });

    it("returns false for non-existent store", () => {
      const deleted = deleteStore(db, "99999");

      expect(deleted).toBe(false);
    });
  });
});
