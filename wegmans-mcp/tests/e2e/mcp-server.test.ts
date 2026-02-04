/**
 * E2E Tests for MCP Server via MCP Protocol.
 *
 * Tests the MCP server by spawning it as a child process and communicating
 * via the MCP SDK client over stdio. This validates the full protocol flow.
 *
 * Run with: npm test -- tests/e2e/mcp-server.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Skip in CI - these spawn processes and may have platform-specific behavior
const SKIP_INTEGRATION =
  process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

describe.skipIf(SKIP_INTEGRATION)("MCP Server E2E", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let testDir: string;
  let testDbPath: string;

  beforeEach(async () => {
    // Create temp directory for test database
    testDir = join(tmpdir(), `wegmans-mcp-e2e-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create transport to spawn server process
    transport = new StdioClientTransport({
      command: "node",
      args: [join(process.cwd(), "dist/src/index.js")],
      env: {
        ...process.env,
        WEGMANS_MCP_DB_PATH: testDbPath,
      },
    });

    // Create and connect client
    client = new Client(
      { name: "e2e-test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
  });

  afterEach(async () => {
    // Close client connection
    try {
      await client.close();
    } catch {
      // Ignore errors during cleanup
    }

    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("tools/list", () => {
    it("returns all 4 tools", async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(4);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("query");
      expect(toolNames).toContain("schema");
      expect(toolNames).toContain("search");
      expect(toolNames).toContain("refreshApiKey");
    });

    it("query tool has correct schema", async () => {
      const result = await client.listTools();

      const queryTool = result.tools.find((t) => t.name === "query");
      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toContain("SQL");
      expect(queryTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          sql: { type: "string", description: expect.any(String) },
        },
        required: ["sql"],
      });
    });

    it("schema tool has correct schema", async () => {
      const result = await client.listTools();

      const schemaTool = result.tools.find((t) => t.name === "schema");
      expect(schemaTool).toBeDefined();
      expect(schemaTool?.description).toContain("schema");
      expect(schemaTool?.inputSchema).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });

    it("search tool has correct schema", async () => {
      const result = await client.listTools();

      const searchTool = result.tools.find((t) => t.name === "search");
      expect(searchTool).toBeDefined();
      expect(searchTool?.description).toContain("Search");
      expect(searchTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          query: { type: "string", description: expect.any(String) },
          storeNumber: { type: "string", description: expect.any(String) },
          hitsPerPage: { type: "number", description: expect.any(String) },
        },
        required: ["query", "storeNumber"],
      });
    });

    it("refreshApiKey tool has correct schema", async () => {
      const result = await client.listTools();

      const refreshTool = result.tools.find((t) => t.name === "refreshApiKey");
      expect(refreshTool).toBeDefined();
      expect(refreshTool?.description).toContain("API key");
      expect(refreshTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          storeName: { type: "string", description: expect.any(String) },
        },
        required: ["storeName"],
      });
    });
  });

  describe("schema tool", () => {
    it("returns table DDL via MCP protocol", async () => {
      const result = await client.callTool({ name: "schema", arguments: {} });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.tables).toBeDefined();
      expect(Array.isArray(response.tables)).toBe(true);
      expect(response.tables.length).toBe(12);

      // Verify key tables are present
      const tableNames = response.tables.map((t: { name: string }) => t.name);
      expect(tableNames).toContain("products");
      expect(tableNames).toContain("store_products");
      expect(tableNames).toContain("stores");
      expect(tableNames).toContain("api_keys");
    });

    it("DDL includes CREATE TABLE statements", async () => {
      const result = await client.callTool({ name: "schema", arguments: {} });
      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);

      for (const table of response.tables) {
        expect(table.name).toBeDefined();
        expect(table.ddl).toBeDefined();
        expect(table.ddl).toContain("CREATE TABLE");
      }
    });
  });

  describe("query tool", () => {
    it("executes SELECT query via MCP protocol", async () => {
      // First insert test data using query (which should fail since it's read-only)
      // Instead, we'll use schema to verify the database is accessible
      // then query an empty table

      const result = await client.callTool({
        name: "query",
        arguments: { sql: "SELECT COUNT(*) as count FROM products" },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.columns).toEqual(["count"]);
      expect(response.rows).toHaveLength(1);
      expect(response.rows[0]).toEqual({ count: 0 });
    });

    it("returns error for invalid SQL", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: { sql: "SELEKT * FROM products" },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).toContain("syntax");
    });

    it("rejects non-SELECT statements", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "INSERT INTO products (product_id, name, is_sold_by_weight, is_alcohol) VALUES ('1', 'Test', 0, 0)",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it("queries database tables", async () => {
      // Query the stores table which should be empty
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "SELECT name, city, state FROM stores ORDER BY store_number",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.columns).toEqual(["name", "city", "state"]);
      expect(response.rows).toEqual([]);
      expect(response.rowCount).toBe(0);
    });
  });

  describe("search tool", () => {
    it("returns error when no API key exists", async () => {
      const result = await client.callTool({
        name: "search",
        arguments: { query: "milk", storeNumber: "74" },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toContain("API key");
    });

    it("validates required parameters", async () => {
      const result = await client.callTool({
        name: "search",
        arguments: { query: "milk" }, // Missing storeNumber
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toContain("Missing required parameters");
    });
  });

  describe("refreshApiKey tool", () => {
    it("validates required parameters", async () => {
      const result = await client.callTool({
        name: "refreshApiKey",
        arguments: {}, // Missing storeName
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toContain("Missing required parameter");
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool", async () => {
      const result = await client.callTool({
        name: "unknownTool",
        arguments: {},
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toContain("Unknown tool");
    });
  });
});
