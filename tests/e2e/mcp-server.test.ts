/**
 * E2E Tests for MCP Server via MCP Protocol.
 *
 * Tests the MCP server by spawning it as a child process and communicating
 * via the MCP SDK client over stdio. This validates the full protocol flow.
 *
 * Multi-database architecture:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations (always available)
 * - stores/{storeNumber}.db: Per-store product data
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

/**
 * Skip E2E tests in CI environments.
 *
 * Reasons for skipping:
 * 1. Process spawning - These tests spawn the MCP server as a child process,
 *    which can behave differently across CI platforms (GitHub Actions, etc.)
 * 2. Network dependencies - Tests may hit the real Wegmans API for stores data
 * 3. Playwright/browser - Key extraction requires Chromium, which needs
 *    additional CI setup (playwright install-deps)
 * 4. Timing sensitivity - Stdio communication can have race conditions in CI
 *
 * To run locally: npm test -- tests/e2e/mcp-server.test.ts
 * To force skip: SKIP_INTEGRATION=true npm test
 */
const SKIP_INTEGRATION =
  process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

describe.skipIf(SKIP_INTEGRATION)("MCP Server E2E", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for test database
    testDir = join(tmpdir(), `forager-e2e-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });

    // Create transport to spawn server process
    // Use XDG_DATA_HOME to point to our test directory
    transport = new StdioClientTransport({
      command: "node",
      args: [join(process.cwd(), "dist/src/index.js")],
      env: {
        ...process.env,
        XDG_DATA_HOME: testDir,
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
    it("returns all 2 tools", async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(2);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("query");
      expect(toolNames).toContain("setStore");
    });

    it("query tool has correct schema with database parameter", async () => {
      const result = await client.listTools();

      const queryTool = result.tools.find((t) => t.name === "query");
      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toContain("SQL");
      expect(queryTool?.description).toContain("STORES SCHEMA");
      expect(queryTool?.description).toContain("PRODUCTS SCHEMA");
      expect(queryTool?.description).toContain("CREATE TABLE");
      expect(queryTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          sql: { type: "string", description: expect.any(String) },
          database: {
            type: "string",
            enum: ["stores", "products"],
            description: expect.any(String),
          },
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
  });

  describe("query tool", () => {
    it("queries stores database with database='stores'", async () => {
      // Stores are fetched and cached on server startup
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "SELECT name, city, state FROM stores ORDER BY CAST(store_number AS INTEGER) LIMIT 3",
          database: "stores",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.columns).toEqual(["name", "city", "state"]);
      expect(response.rowCount).toBeGreaterThan(0);
    });

    it("returns error when querying products without store selected", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "SELECT COUNT(*) as count FROM products",
          database: "products",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toContain("No store selected");
      expect(response.error).toContain("setStore");
    });

    it("defaults to products database when database parameter not specified", async () => {
      // Without database parameter, should try products (and fail since no store selected)
      const result = await client.callTool({
        name: "query",
        arguments: { sql: "SELECT COUNT(*) as count FROM products" },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toContain("No store selected");
    });

    it("returns error for invalid SQL on stores database", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "SELEKT * FROM stores",
          database: "stores",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).toContain("syntax");
    });

    it("rejects non-SELECT statements on stores database", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "INSERT INTO stores (store_number, name) VALUES ('999', 'Test')",
          database: "stores",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it("can count stores in the stores database", async () => {
      const result = await client.callTool({
        name: "query",
        arguments: {
          sql: "SELECT COUNT(*) as count FROM stores",
          database: "stores",
        },
      });

      const response = JSON.parse((result.content[0] as { text: string }).text);

      expect(response.success).toBe(true);
      expect(response.columns).toEqual(["count"]);
      expect(response.rows).toHaveLength(1);
      // Should have stores fetched on startup
      expect(response.rows[0].count).toBeGreaterThan(0);
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
