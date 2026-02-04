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
import {
  getCatalogStatus,
  refreshCatalogIfNeeded,
  type FetchProgress,
} from "./catalog/index.js";

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
 * Default store number (Geneva, NY).
 * Can be overridden with WEGMANS_STORE_NUMBER env var.
 */
const DEFAULT_STORE_NUMBER = "74";

/**
 * Log to stderr (since stdout is used for MCP JSON-RPC).
 */
function log(message: string): void {
  process.stderr.write(`[wegmans-mcp] ${message}\n`);
}

/**
 * Check catalog freshness and refresh if needed.
 * - Blocks on first population (empty catalog)
 * - Refreshes in background when stale (non-blocking)
 *
 * @param db - Database connection
 * @param storeNumber - Store number to fetch
 */
async function ensureFreshCatalog(
  db: Database.Database,
  storeNumber: string
): Promise<void> {
  const status = getCatalogStatus(db);

  if (!status.isEmpty && !status.isStale) {
    log(
      `Catalog OK: ${status.productCount} products, last updated ${status.lastUpdated?.toISOString()}`
    );
    return;
  }

  // Need API key to refresh
  const apiKey = getApiKeyFromDatabase(db);
  if (!apiKey) {
    if (status.isEmpty) {
      log("Warning: Catalog empty but no API key available. Use refreshApiKey tool first.");
    } else {
      log(
        `Warning: Catalog stale (${status.productCount} products from ${status.lastUpdated?.toISOString()}) but no API key. Use refreshApiKey tool to update.`
      );
    }
    return;
  }

  const onProgress = (progress: FetchProgress) => {
    log(`  ${progress.message}`);
  };

  const doRefresh = async () => {
    const result = await refreshCatalogIfNeeded(db, apiKey, storeNumber, onProgress);

    if (result) {
      if (result.success) {
        log(
          `Catalog refreshed: ${result.productsAdded} products, ${result.categoriesAdded} categories, ${result.tagsAdded} tags`
        );
      } else {
        log(`Warning: Catalog refresh failed: ${result.error}`);
      }
    }
  };

  if (status.isEmpty) {
    // Block on first population - server isn't useful without data
    log("Catalog empty, fetching full catalog (blocking)...");
    await doRefresh();
  } else {
    // Background refresh when stale - don't block server startup
    log(
      `Catalog stale (last updated ${status.lastUpdated?.toISOString()}), refreshing in background...`
    );
    doRefresh().catch((err) => {
      log(`Warning: Background catalog refresh failed: ${err instanceof Error ? err.message : err}`);
    });
  }
}

/**
 * Main entry point - starts the MCP server.
 */
async function main(): Promise<void> {
  const dbPath = getDefaultDbPath();
  const storeNumber = process.env["WEGMANS_STORE_NUMBER"] ?? DEFAULT_STORE_NUMBER;

  // Ensure data directory exists
  ensureDataDir(dbPath);

  // Open database connection
  openDatabase(dbPath);
  const { db } = getDatabase();

  // Check catalog freshness and refresh if needed
  try {
    await ensureFreshCatalog(db, storeNumber);
  } catch (err) {
    log(`Warning: Catalog check failed: ${err instanceof Error ? err.message : err}`);
  }

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
