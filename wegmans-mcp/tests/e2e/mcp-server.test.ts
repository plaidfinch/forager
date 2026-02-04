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
    it("returns all 3 tools", async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(3);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("query");
      expect(toolNames).toContain("setStore");
      expect(toolNames).toContain("listStores");
    });

    it("query tool has correct schema with embedded database schema", async () => {
      const result = await client.listTools();

      const queryTool = result.tools.find((t) => t.name === "query");
      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toContain("SQL");
      expect(queryTool?.description).toContain("DATABASE SCHEMA:");
      expect(queryTool?.description).toContain("CREATE TABLE");
      expect(queryTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          sql: { type: "string", description: expect.any(String) },
        },
        required: ["sql"],
      });
    });

    it("setStore tool has correct schema", async () => {
      const result = await client.listTools();

      const setStoreTool = result.tools.find((t) => t.name === "setStore");
      expect(setStoreTool).toBeDefined();
      expect(setStoreTool?.description).toContain("Set the active Wegmans store");
      expect(setStoreTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          storeNumber: { type: "string", description: expect.any(String) },
          forceRefresh: { type: "boolean", description: expect.any(String) },
        },
        required: ["storeNumber"],
      });
    });

    it("listStores tool has correct schema", async () => {
      const result = await client.listTools();

      const listStoresTool = result.tools.find((t) => t.name === "listStores");
      expect(listStoresTool).toBeDefined();
      expect(listStoresTool?.description).toContain("List available Wegmans stores");
      expect(listStoresTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          showAll: { type: "boolean", description: expect.any(String) },
        },
        required: [],
      });
    });
  });

  describe("query tool", () => {
    it("executes SELECT query via MCP protocol", async () => {
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

  describe("listStores tool", () => {
    it("returns known Wegmans stores with showAll=true", async () => {
      const result = await client.callTool({
        name: "listStores",
        arguments: { showAll: true },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.stores).toBeDefined();
      expect(Array.isArray(response.stores)).toBe(true);
      expect(response.stores.length).toBeGreaterThan(50); // ~75 known stores
    });

    it("returns empty list with showAll=false when no stores cached", async () => {
      // When cache is empty, showAll=false returns empty (no fallback to API)
      const result = await client.callTool({
        name: "listStores",
        arguments: { showAll: false },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.stores).toEqual([]);
      expect(response.fromCache).toBe(true);
    });
  });

  describe("setStore tool", () => {
    it("validates required parameters", async () => {
      const result = await client.callTool({
        name: "setStore",
        arguments: {}, // Missing storeNumber
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
