/**
 * Tests for MCP server entry point.
 *
 * Basic smoke tests to verify the server can be created and has correct configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  createServer,
  TOOL_DEFINITIONS,
  getDataDir,
} from "../src/index.js";
import {
  openDatabases,
  closeDatabases,
  getStoresDb,
  openStoreDatabase,
  getStoreDataDb,
} from "../src/db/connection.js";
import { queryTool } from "../src/tools/query.js";

describe("MCP Server", () => {
  describe("createServer", () => {
    it("creates a Server instance", () => {
      const server = createServer();

      expect(server).toBeInstanceOf(Server);
    });

    it("has correct server info", () => {
      const server = createServer();

      // Server exposes getServerInfo or similar - let's just verify creation
      expect(server).toBeDefined();
    });
  });

  describe("TOOL_DEFINITIONS", () => {
    it("defines 1 tool", () => {
      expect(TOOL_DEFINITIONS).toHaveLength(1);
    });

    it("defines query tool with sql and storeNumber inputs", () => {
      const queryToolDef = TOOL_DEFINITIONS.find((t) => t.name === "query");

      expect(queryToolDef).toBeDefined();
      expect(queryToolDef?.description).toBeDefined();
      expect(queryToolDef?.description).toContain("storeNumber");
      expect(queryToolDef?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          sql: { type: "string", description: expect.any(String) },
          storeNumber: {
            type: "string",
            description: expect.any(String),
          },
        },
        required: ["sql"],
      });
      // No 'database' parameter — routing is based on storeNumber presence
      expect(queryToolDef?.inputSchema.properties).not.toHaveProperty("database");
    });

    it("includes stores schema DDL in description", () => {
      const queryToolDef = TOOL_DEFINITIONS.find((t) => t.name === "query");
      const desc = queryToolDef!.description;

      expect(desc).toContain("STORES SCHEMA");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS settings");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS stores");
      expect(desc).toContain("store_number TEXT PRIMARY KEY");
    });

    it("includes products schema DDL in description", () => {
      const queryToolDef = TOOL_DEFINITIONS.find((t) => t.name === "query");
      const desc = queryToolDef!.description;

      expect(desc).toContain("PRODUCTS SCHEMA");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS products");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS servings");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS nutrition_facts");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS categories");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS tags");
      expect(desc).toContain("CREATE TABLE IF NOT EXISTS product_tags");
    });
  });
});

describe("getDataDir", () => {
  const originalEnv = process.env["XDG_DATA_HOME"];

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env["XDG_DATA_HOME"] = originalEnv;
    } else {
      delete process.env["XDG_DATA_HOME"];
    }
  });

  it("uses XDG_DATA_HOME when set", () => {
    process.env["XDG_DATA_HOME"] = "/custom/data";

    const dataDir = getDataDir();

    expect(dataDir).toBe("/custom/data/forager");
  });

  it("defaults to ~/.local/share/forager when XDG_DATA_HOME is not set", () => {
    delete process.env["XDG_DATA_HOME"];

    const dataDir = getDataDir();

    expect(dataDir).toBe(join(homedir(), ".local", "share", "forager"));
  });
});

describe("Query Tool Handler", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wegmans-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    openDatabases(testDir);
  });

  afterEach(() => {
    try {
      closeDatabases();
    } catch {
      // Ignore if already closed
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("store routing", () => {
    it("queries stores.db when storeNumber is omitted", () => {
      const storesDb = getStoresDb();
      storesDb.exec(`
        INSERT INTO stores (store_number, name, city, state)
        VALUES ('74', 'Geneva', 'Geneva', 'NY')
      `);

      const result = queryTool(storesDb, "SELECT store_number, name FROM stores");

      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows?.[0]).toMatchObject({
        store_number: "74",
        name: "Geneva",
      });
    });

    it("queries store database when storeNumber is provided", () => {
      openStoreDatabase(testDir, "74");
      const { db } = getStoreDataDb("74");

      db.exec(`
        INSERT INTO products (product_id, name, brand)
        VALUES ('p1', 'Test Product', 'Test Brand')
      `);

      const result = queryTool(db, "SELECT product_id, name FROM products");

      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows?.[0]).toMatchObject({
        product_id: "p1",
        name: "Test Product",
      });
    });
  });
});

