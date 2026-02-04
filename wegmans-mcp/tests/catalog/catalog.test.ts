/**
 * Tests for catalog management module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { getCatalogStatus } from "../../src/catalog/index.js";
import { populateOntology, getOntologyStats } from "../../src/catalog/ontology.js";
import type { AlgoliaHit } from "../../src/catalog/fetch.js";

describe("Catalog Management", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("getCatalogStatus", () => {
    it("reports empty catalog", () => {
      const status = getCatalogStatus(db);

      expect(status.isEmpty).toBe(true);
      expect(status.isStale).toBe(true);
      expect(status.productCount).toBe(0);
      expect(status.lastUpdated).toBeNull();
    });

    it("reports non-empty catalog with last updated", () => {
      // Insert a product
      db.exec(`
        INSERT INTO products (product_id, name) VALUES ('123', 'Test Product')
      `);

      // Insert a store with lastUpdated
      db.exec(`
        INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')
      `);

      const now = new Date().toISOString();
      db.exec(`
        INSERT INTO store_products (product_id, store_number, last_updated)
        VALUES ('123', '74', '${now}')
      `);

      const status = getCatalogStatus(db);

      expect(status.isEmpty).toBe(false);
      expect(status.productCount).toBe(1);
      expect(status.lastUpdated).not.toBeNull();
    });

    it("reports stale catalog when last_updated is old", () => {
      // Insert a product
      db.exec(`
        INSERT INTO products (product_id, name) VALUES ('123', 'Test Product')
      `);

      db.exec(`
        INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')
      `);

      // Insert with old timestamp (2 days ago)
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      db.exec(`
        INSERT INTO store_products (product_id, store_number, last_updated)
        VALUES ('123', '74', '${oldDate}')
      `);

      const status = getCatalogStatus(db);

      expect(status.isEmpty).toBe(false);
      expect(status.isStale).toBe(true);
    });

    it("reports fresh catalog when last_updated is recent", () => {
      // Insert a product
      db.exec(`
        INSERT INTO products (product_id, name) VALUES ('123', 'Test Product')
      `);

      db.exec(`
        INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')
      `);

      // Insert with recent timestamp (1 hour ago)
      const recentDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      db.exec(`
        INSERT INTO store_products (product_id, store_number, last_updated)
        VALUES ('123', '74', '${recentDate}')
      `);

      const status = getCatalogStatus(db);

      expect(status.isEmpty).toBe(false);
      expect(status.isStale).toBe(false);
    });
  });

  describe("populateOntology", () => {
    it("populates categories from hits", () => {
      const hits: AlgoliaHit[] = [
        {
          objectID: "74-123",
          productId: "123",
          categories: {
            lvl0: "Dairy",
            lvl1: "Dairy > Milk",
            lvl2: "Dairy > Milk > Whole Milk",
          },
        },
        {
          objectID: "74-456",
          productId: "456",
          categories: {
            lvl0: "Dairy",
            lvl1: "Dairy > Milk",
            lvl2: "Dairy > Milk > Skim Milk",
          },
        },
      ];

      populateOntology(db, hits);

      const categories = db
        .prepare("SELECT * FROM categories ORDER BY path")
        .all() as Array<{ path: string; name: string; level: number; product_count: number }>;

      expect(categories.length).toBeGreaterThanOrEqual(4);

      // Check Dairy appears with count 2 (both products)
      const dairy = categories.find((c) => c.path === "Dairy");
      expect(dairy).toBeDefined();
      expect(dairy!.product_count).toBe(2);

      // Check leaf categories have count 1
      const wholeMilk = categories.find((c) => c.path === "Dairy > Milk > Whole Milk");
      expect(wholeMilk).toBeDefined();
      expect(wholeMilk!.product_count).toBe(1);
    });

    it("populates tags from hits", () => {
      const hits: AlgoliaHit[] = [
        {
          objectID: "74-123",
          productId: "123",
          filterTags: ["Organic", "Gluten Free"],
          popularTags: ["Wegmans Brand"],
        },
        {
          objectID: "74-456",
          productId: "456",
          filterTags: ["Organic"],
        },
      ];

      populateOntology(db, hits);

      const tags = db
        .prepare("SELECT * FROM tags ORDER BY name")
        .all() as Array<{ name: string; type: string; product_count: number }>;

      expect(tags.length).toBe(3);

      // Organic appears in both products
      const organic = tags.find((t) => t.name === "Organic" && t.type === "filter");
      expect(organic).toBeDefined();
      expect(organic!.product_count).toBe(2);

      // Gluten Free only in one
      const glutenFree = tags.find((t) => t.name === "Gluten Free");
      expect(glutenFree).toBeDefined();
      expect(glutenFree!.product_count).toBe(1);
    });

    it("handles hits without categories or tags", () => {
      const hits: AlgoliaHit[] = [
        {
          objectID: "74-123",
          productId: "123",
          // No categories or tags
        },
      ];

      // Should not throw
      populateOntology(db, hits);

      const stats = getOntologyStats(db);
      expect(stats.categoryCount).toBe(0);
      expect(stats.tagCount).toBe(0);
    });
  });

  describe("getOntologyStats", () => {
    it("returns zero counts for empty ontology", () => {
      const stats = getOntologyStats(db);

      expect(stats.categoryCount).toBe(0);
      expect(stats.tagCount).toBe(0);
    });

    it("returns correct counts after population", () => {
      const hits: AlgoliaHit[] = [
        {
          objectID: "74-123",
          productId: "123",
          categories: {
            lvl0: "Dairy",
            lvl1: "Dairy > Milk",
          },
          filterTags: ["Organic"],
          popularTags: ["Wegmans Brand"],
        },
      ];

      populateOntology(db, hits);

      const stats = getOntologyStats(db);
      expect(stats.categoryCount).toBe(2); // Dairy, Dairy > Milk
      expect(stats.tagCount).toBe(2); // Organic (filter), Wegmans Brand (popular)
    });
  });
});
