/**
 * MCP Server Entry Point for Wegmans Product Data.
 *
 * Provides 4 tools for interacting with Wegmans product data:
 * - query: Execute read-only SQL queries against the database
 * - schema: Get table DDL for understanding the database structure
 * - search: Search and populate products from Algolia
 * - refreshApiKey: Extract a fresh Algolia API key
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  openDatabase,
  closeDatabase,
  getDatabase,
} from "./db/connection.js";
import { queryTool } from "./tools/query.js";
import { schemaTool } from "./tools/schema.js";
import { searchTool } from "./tools/search.js";
import { refreshApiKeyTool } from "./tools/refreshApiKey.js";
import { setStoreTool, getActiveStore } from "./tools/setStore.js";
import { listStoresTool } from "./tools/listStores.js";
import { getCatalogStatus, type FetchProgress } from "./catalog/index.js";

/**
 * Tool definitions for the MCP server.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "query",
    description:
      "Execute a read-only SQL query against the Wegmans product database. Use this to search, filter, and analyze product data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "The SQL SELECT statement to execute",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "schema",
    description:
      "Get the database schema (CREATE TABLE/VIEW statements) to understand available tables and columns. Includes categories/tags ontology tables and views for querying product taxonomy. Use product_tags view to join products with their filter/popular tags.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "search",
    description:
      "Search for products on Wegmans and populate the local database with results. Requires an API key (use refreshApiKey first if needed). Use filters for category/tag filtering.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'milk', 'organic apples')",
        },
        storeNumber: {
          type: "string",
          description: "Wegmans store number (e.g., '74' for Geneva)",
        },
        hitsPerPage: {
          type: "number",
          description: "Number of results per page (default: 20)",
        },
        filters: {
          type: "string",
          description:
            "Raw Algolia filter string. Examples: 'filterTags:Organic', 'categories.lvl0:Dairy AND filterTags:\"Gluten Free\"', 'consumerBrandName:Wegmans'",
        },
      },
      required: ["query", "storeNumber"],
    },
  },
  {
    name: "refreshApiKey",
    description:
      "Extract a fresh Algolia API key from the Wegmans website. Use this when search fails due to an expired key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        storeName: {
          type: "string",
          description:
            "Store name for URL (e.g., 'geneva' becomes wegmans.com/stores/geneva)",
        },
      },
      required: ["storeName"],
    },
  },
  {
    name: "setStore",
    description:
      "Set the active Wegmans store and fetch its product catalog. Call this first to specify which store to query. Fetches full catalog (~29,000 products) on first use for a store.",
    inputSchema: {
      type: "object" as const,
      properties: {
        storeNumber: {
          type: "string",
          description:
            "Wegmans store number (e.g., '74' for Geneva, NY). Use listStores to find store numbers.",
        },
        forceRefresh: {
          type: "boolean",
          description:
            "Force a full catalog refresh even if data exists (default: false)",
        },
      },
      required: ["storeNumber"],
    },
  },
  {
    name: "listStores",
    description:
      "List available Wegmans stores with their store numbers. Use this to find the store number for setStore.",
    inputSchema: {
      type: "object" as const,
      properties: {
        showAll: {
          type: "boolean",
          description:
            "If true, show all known stores. If false, only show stores in local database (default: true)",
        },
      },
      required: [] as string[],
    },
  },
];

/**
 * Get the most recent API key from the database.
 *
 * @param db - Database connection
 * @returns The API key string, or null if no keys exist
 */
export function getApiKeyFromDatabase(db: Database.Database): string | null {
  const stmt = db.prepare(`
    SELECT key FROM api_keys
    ORDER BY id DESC
    LIMIT 1
  `);

  const row = stmt.get() as { key: string } | undefined;
  return row?.key ?? null;
}

/**
 * Create and configure the MCP server with tool handlers.
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "wegmans-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const { db, readonlyDb } = getDatabase();

      switch (name) {
        case "query": {
          const sql = (args as { sql?: string }).sql;
          if (typeof sql !== "string") {
            return {
              content: [
                { type: "text", text: JSON.stringify({ success: false, error: "Missing required parameter: sql" }) },
              ],
            };
          }
          const result = queryTool(readonlyDb, sql);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }

        case "schema": {
          const result = schemaTool(db);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }

        case "search": {
          const { query, storeNumber, hitsPerPage, filters } = args as {
            query?: string;
            storeNumber?: string;
            hitsPerPage?: number;
            filters?: string;
          };

          if (typeof query !== "string" || typeof storeNumber !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "Missing required parameters: query and storeNumber",
                  }),
                },
              ],
            };
          }

          // Get API key from database
          const apiKey = getApiKeyFromDatabase(db);
          if (!apiKey) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error:
                      "No API key found. Use refreshApiKey tool first to extract one.",
                  }),
                },
              ],
            };
          }

          const searchOptions = {
            query,
            storeNumber,
            apiKey,
            ...(hitsPerPage !== undefined && { hitsPerPage }),
            ...(filters !== undefined && { filters }),
          };
          const result = await searchTool(db, searchOptions);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }

        case "refreshApiKey": {
          const storeName = (args as { storeName?: string }).storeName;
          if (typeof storeName !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "Missing required parameter: storeName",
                  }),
                },
              ],
            };
          }

          const result = await refreshApiKeyTool(db, { storeName });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }

        case "setStore": {
          const { storeNumber, forceRefresh } = args as {
            storeNumber?: string;
            forceRefresh?: boolean;
          };

          if (typeof storeNumber !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "Missing required parameter: storeNumber",
                  }),
                },
              ],
            };
          }

          // Get API key from database
          const apiKey = getApiKeyFromDatabase(db);
          if (!apiKey) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error:
                      "No API key found. Use refreshApiKey tool first to extract one.",
                  }),
                },
              ],
            };
          }

          const onProgress = (progress: FetchProgress) => {
            // Log progress to stderr
            process.stderr.write(`[wegmans-mcp] ${progress.message}\n`);
          };

          const result = await setStoreTool(db, {
            storeNumber,
            apiKey,
            forceRefresh,
            onProgress,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }

        case "listStores": {
          const { showAll } = args as { showAll?: boolean };
          const result = listStoresTool(db, showAll ?? true);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Unknown tool: ${name}`,
                }),
              },
            ],
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: message }),
          },
        ],
      };
    }
  });

  return server;
}

/**
 * Get the default database path.
 * Uses WEGMANS_MCP_DB_PATH env var if set, otherwise ~/.wegmans-mcp/data.db
 */
export function getDefaultDbPath(): string {
  if (process.env["WEGMANS_MCP_DB_PATH"]) {
    return process.env["WEGMANS_MCP_DB_PATH"];
  }

  const dataDir = join(homedir(), ".wegmans-mcp");
  return join(dataDir, "data.db");
}

/**
 * Ensure the data directory exists.
 */
function ensureDataDir(dbPath: string): void {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Log to stderr (since stdout is used for MCP JSON-RPC).
 */
function log(message: string): void {
  process.stderr.write(`[wegmans-mcp] ${message}\n`);
}

/**
 * Report catalog status on startup.
 */
function reportCatalogStatus(db: Database.Database): void {
  const activeStore = getActiveStore(db);
  const status = getCatalogStatus(db);
  const hasApiKey = getApiKeyFromDatabase(db) !== null;

  if (!hasApiKey) {
    log("No API key configured. Use refreshApiKey tool first.");
    return;
  }

  if (!activeStore) {
    log("No store selected. Use setStore tool to select a Wegmans store.");
    return;
  }

  if (status.isEmpty) {
    log(`Store ${activeStore} selected but no products loaded. Use setStore to refresh.`);
  } else if (status.isStale) {
    log(
      `Store ${activeStore}: ${status.productCount} products (stale - last updated ${status.lastUpdated?.toISOString()})`
    );
  } else {
    log(
      `Store ${activeStore}: ${status.productCount} products (fresh - last updated ${status.lastUpdated?.toISOString()})`
    );
  }
}

/**
 * Main entry point - starts the MCP server.
 */
async function main(): Promise<void> {
  const dbPath = getDefaultDbPath();

  // Ensure data directory exists
  ensureDataDir(dbPath);

  // Open database connection
  openDatabase(dbPath);
  const { db } = getDatabase();

  // Report catalog status
  reportCatalogStatus(db);

  // Create and start server
  const server = createServer();
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    closeDatabase();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    closeDatabase();
    process.exit(0);
  });

  // Connect server to transport
  await server.connect(transport);
}

// Run main if this is the entry point
// ESM equivalent of require.main === module
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((err) => {
    console.error("Server error:", err);
    closeDatabase();
    process.exit(1);
  });
}
