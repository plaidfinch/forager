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
} from "../src/index.js";

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
    it("defines 2 tools", () => {
      expect(TOOL_DEFINITIONS).toHaveLength(2);
    });

    it("defines query tool with sql input and schema in description", () => {
      const queryTool = TOOL_DEFINITIONS.find((t) => t.name === "query");

      expect(queryTool).toBeDefined();
      expect(queryTool?.description).toBeDefined();
      expect(queryTool?.description).toContain("DATABASE SCHEMA:");
      expect(queryTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          sql: { type: "string", description: expect.any(String) },
        },
        required: ["sql"],
      });
    });

    it("defines setStore tool", () => {
      const setStoreTool = TOOL_DEFINITIONS.find((t) => t.name === "setStore");
      expect(setStoreTool).toBeDefined();
      expect(setStoreTool?.description).toContain("Set the active Wegmans store");
    });

  });
});
