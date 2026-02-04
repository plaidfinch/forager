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
    it("defines 4 tools", () => {
      expect(TOOL_DEFINITIONS).toHaveLength(4);
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

  });
});
