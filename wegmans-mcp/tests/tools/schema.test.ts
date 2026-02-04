/**
 * Tests for the schema tool.
 *
 * Verifies that the schema tool returns DDL for all database tables.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initializeSchema } from "../../src/db/schema.js";
import { schemaTool } from "../../src/tools/schema.js";

describe("schemaTool", () => {
  let testDir: string;
  let testDbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create temp directory and file-based database
    testDir = join(tmpdir(), `wegmans-schema-tool-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create and initialize schema
    db = new Database(testDbPath);
    db.pragma("foreign_keys = ON");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns DDL for all tables", () => {
    const result = schemaTool(db);

    expect(result.success).toBe(true);
    expect(result.tables).toBeDefined();
    expect(result.tables).toHaveLength(6); // Schema has exactly 6 tables
    expect(result.error).toBeUndefined();
  });

  it("includes CREATE TABLE statements", () => {
    const result = schemaTool(db);

    expect(result.success).toBe(true);
    expect(result.tables).toBeDefined();

    for (const table of result.tables!) {
      expect(table.name).toBeDefined();
      expect(table.ddl).toBeDefined();
      expect(table.ddl).toContain("CREATE TABLE");
    }
  });

  it("key tables are present (products, store_products, nutrition_facts)", () => {
    const result = schemaTool(db);

    expect(result.success).toBe(true);
    expect(result.tables).toBeDefined();

    const tableNames = result.tables!.map((t) => t.name);

    expect(tableNames).toContain("products");
    expect(tableNames).toContain("store_products");
    expect(tableNames).toContain("nutrition_facts");
  });

  it("returns all 6 expected tables", () => {
    const result = schemaTool(db);

    expect(result.success).toBe(true);
    expect(result.tables).toBeDefined();

    const tableNames = result.tables!.map((t) => t.name);

    // All tables defined in src/db/schema.ts
    expect(tableNames).toContain("api_keys");
    expect(tableNames).toContain("stores");
    expect(tableNames).toContain("products");
    expect(tableNames).toContain("store_products");
    expect(tableNames).toContain("servings");
    expect(tableNames).toContain("nutrition_facts");

    expect(result.tables).toHaveLength(6);
  });

  it("DDL includes column definitions", () => {
    const result = schemaTool(db);

    expect(result.success).toBe(true);
    const productsTable = result.tables?.find((t) => t.name === "products");

    expect(productsTable).toBeDefined();
    expect(productsTable!.ddl).toContain("product_id");
    expect(productsTable!.ddl).toContain("name");
    expect(productsTable!.ddl).toContain("brand");
  });
});
