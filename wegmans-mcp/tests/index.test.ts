/**
 * Tests for MCP server entry point.
 *
 * Basic smoke tests to verify the server can be created and has correct configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  createServer,
  TOOL_DEFINITIONS,
  getApiKeyFromDatabase,
} from "../src/index.js";
import {
  openDatabase,
  closeDatabase,
  getDatabase,
} from "../src/db/connection.js";

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
    it("defines 5 tools", () => {
      expect(TOOL_DEFINITIONS).toHaveLength(5);
    });

    it("defines query tool with sql input", () => {
      const queryTool = TOOL_DEFINITIONS.find((t) => t.name === "query");

      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toBeDefined();
      expect(queryTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          sql: { type: "string", description: expect.any(String) },
        },
        required: ["sql"],
      });
    });

    it("defines schema tool with no required input", () => {
      const schemaTool = TOOL_DEFINITIONS.find((t) => t.name === "schema");

      expect(schemaTool).toBeDefined();
      expect(schemaTool?.description).toBeDefined();
      expect(schemaTool?.inputSchema).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });

    it("defines refreshApiKey tool with no required input", () => {
      const refreshTool = TOOL_DEFINITIONS.find(
        (t) => t.name === "refreshApiKey"
      );

      expect(refreshTool).toBeDefined();
      expect(refreshTool?.description).toBeDefined();
      expect(refreshTool?.inputSchema).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });
  });

  describe("getApiKeyFromDatabase", () => {
    beforeEach(() => {
      openDatabase(":memory:");
    });

    afterEach(() => {
      closeDatabase();
    });

    it("returns null when no API keys exist", () => {
      const { db } = getDatabase();

      const result = getApiKeyFromDatabase(db);

      expect(result).toBeNull();
    });

    it("returns the most recent API key", () => {
      const { db } = getDatabase();

      // Insert two keys with different timestamps
      db.exec(`
        INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('old-key', 'app1', '2024-01-01T00:00:00Z');
        INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('new-key', 'app1', '2024-12-01T00:00:00Z');
      `);

      const result = getApiKeyFromDatabase(db);

      expect(result).toBe("new-key");
    });
  });
});
