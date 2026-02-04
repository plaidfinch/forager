/**
 * MCP Server Entry Point for Wegmans Product Data.
 *
 * Provides 2 tools for interacting with Wegmans product data:
 * - setStore: Select a store and fetch its catalog
 * - query: Execute read-only SQL queries (schema is embedded in tool description)
 *
 * Store list is fetched on startup and cached in the database.
 * Use SQL to query the stores table for location-based searches.
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
import { schemaTool, type SchemaToolResultExtended } from "./tools/schema.js";
import { setStoreTool, getActiveStore } from "./tools/setStore.js";
import { getCatalogStatus, type FetchProgress } from "./catalog/index.js";
import { getStores } from "./stores/fetch.js";

/**
 * Format schema result as a string for embedding in tool description.
 */
function formatSchemaForDescription(schemaResult: SchemaToolResultExtended): string {
  if (!schemaResult.success || !schemaResult.tables) {
    return "Schema not available - use setStore first to initialize the database.";
  }

  const parts: string[] = [];

  // Add tables
  if (schemaResult.tables && schemaResult.tables.length > 0) {
    parts.push("=== Tables ===");
    for (const table of schemaResult.tables) {
      parts.push(table.ddl + ";");
    }
  }

  // Add views
  if (schemaResult.views && schemaResult.views.length > 0) {
    parts.push("\n=== Views ===");
    for (const view of schemaResult.views) {
      parts.push(view.ddl + ";");
    }
  }

  return parts.join("\n");
}

/**
 * Generate tool definitions with the current database schema embedded.
 *
 * @param db - Optional database connection. If provided, schema is embedded in query tool description.
 * @returns Array of tool definitions
 */
export function getToolDefinitions(db?: Database.Database) {
  // Get schema if database is available
  let schemaText = "Database not initialized. Use setStore first.";
  if (db) {
    const schemaResult = schemaTool(db);
    schemaText = formatSchemaForDescription(schemaResult);
  }

  return [
    {
      name: "query",
      description: `Execute a read-only SQL query against the Wegmans product database. Use this to search, filter, and analyze product data.

DATABASE SCHEMA:
${schemaText}`,
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
      name: "setStore",
      description:
        "Set the active Wegmans store and fetch its product catalog. Call this first to specify which store to query. Fetches full catalog (~29,000 products) on first use for a store. Query the stores table to find store numbers and locations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          storeNumber: {
            type: "string",
            description:
              "Wegmans store number (e.g., '74' for Geneva, NY). Query the stores table to find store numbers.",
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
  ];
}

/**
 * Static tool definitions for testing (without database).
 */
export const TOOL_DEFINITIONS = getToolDefinitions();

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

  // Register tool listing handler - dynamically generates schema in query tool description
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      const { db } = getDatabase();
      return { tools: getToolDefinitions(db) };
    } catch {
      // Database not initialized yet
      return { tools: getToolDefinitions() };
    }
  });

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

          const onProgress = (progress: FetchProgress) => {
            // Log progress to stderr
            process.stderr.write(`[wegmans-mcp] ${progress.message}\n`);
          };

          const result = await setStoreTool(db, {
            storeNumber,
            ...(forceRefresh !== undefined ? { forceRefresh } : {}),
            onProgress,
          });
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
 * Refresh stores cache on startup if stale.
 */
async function refreshStoresIfNeeded(db: Database.Database): Promise<void> {
  try {
    const { stores, fromCache, error } = await getStores(db);
    if (error) {
      log(`Stores: ${stores.length} (${error})`);
    } else if (fromCache) {
      log(`Stores: ${stores.length} (cached)`);
    } else {
      log(`Stores: ${stores.length} (fetched from Wegmans)`);
    }
  } catch (err) {
    log(`Failed to load stores: ${err instanceof Error ? err.message : String(err)}`);
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

  // Refresh stores cache if needed
  await refreshStoresIfNeeded(db);

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
