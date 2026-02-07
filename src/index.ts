#!/usr/bin/env node
/**
 * MCP Server Entry Point for Wegmans Product Data.
 *
 * Provides 2 tools for interacting with Wegmans product data:
 * - setStore: Select a store and fetch its catalog
 * - query: Execute read-only SQL queries (schema is embedded in tool description)
 *
 * Multi-database architecture:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations (always available for queries)
 * - stores/{storeNumber}.db: Per-store product data
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  openDatabases,
  closeDatabases,
  getSettingsDb,
  getStoresDb,
  getStoreDataDb,
} from "./db/connection.js";
import { queryTool } from "./tools/query.js";
import { schemaTool, type SchemaToolResultExtended } from "./tools/schema.js";
import { setStoreTool } from "./tools/setStore.js";
import type { FetchProgress } from "./catalog/index.js";
import { getStores } from "./stores/fetch.js";

/**
 * Get the data directory for storing databases.
 * Uses XDG_DATA_HOME if set, otherwise defaults to ~/.local/share/forager/
 */
export function getDataDir(): string {
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) {
    return join(xdgDataHome, "forager");
  }
  return join(homedir(), ".local", "share", "forager");
}

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
    for (const table of schemaResult.tables) {
      parts.push(table.ddl + ";");
    }
  }

  // Add views
  if (schemaResult.views && schemaResult.views.length > 0) {
    parts.push("\n-- Views:");
    for (const view of schemaResult.views) {
      parts.push(view.ddl + ";");
    }
  }

  return parts.join("\n");
}

/**
 * Generate tool definitions with the current database schema embedded.
 *
 * @param storesDb - Stores database connection (for stores schema)
 * @param storeDataDb - Store data database connection (for products schema), or null if no store selected
 * @returns Array of tool definitions
 */
export function getToolDefinitions(storesDb?: Database.Database, storeDataDb?: Database.Database | null) {
  // Get stores schema (always available)
  let storesSchemaText = "Stores database not initialized.";
  if (storesDb) {
    const storesSchemaResult = schemaTool(storesDb);
    storesSchemaText = formatSchemaForDescription(storesSchemaResult);
  }

  // Get products schema (only if store is selected)
  let productsSchemaText = "No store catalog loaded yet. Use setStore to fetch a store's catalog, then pass the storeNumber to query it.";
  if (storeDataDb) {
    const productsSchemaResult = schemaTool(storeDataDb);
    productsSchemaText = formatSchemaForDescription(productsSchemaResult);
  }

  return [
    {
      name: "query",
      description: `Execute a read-only SQL query. Use the 'database' parameter to choose:
- "stores": Query store locations (find store numbers, cities, etc.)
- "products": Query product catalog for a specific store (requires storeNumber parameter)

STORES SCHEMA (database="stores"):
${storesSchemaText}

PRODUCTS SCHEMA (database="products"):
${productsSchemaText}`,
      inputSchema: {
        type: "object" as const,
        properties: {
          sql: {
            type: "string",
            description: "The SQL SELECT statement to execute",
          },
          database: {
            type: "string",
            enum: ["stores", "products"],
            description: 'Which database to query: "stores" for store locations, "products" for product catalog (default: "products")',
          },
          storeNumber: {
            type: "string",
            description:
              "Store number for product queries (required when database='products'). Query the stores database first to find store numbers.",
          },
        },
        required: ["sql"],
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "setStore",
      description:
        "Set the active Wegmans store and fetch its product catalog. Call this first to specify which store to query. Fetches full catalog (~29,000 products) on first use for a store. IMPORTANT: Before calling this tool, ask the user which Wegmans store they want to use (by city, state, or zip code), then query the stores table (database='stores') to find the matching store number.",
      inputSchema: {
        type: "object" as const,
        properties: {
          storeNumber: {
            type: "string",
            description:
              "Wegmans store number. Query the stores table to find store numbers by city, state, or zip code.",
          },
          forceRefresh: {
            type: "boolean",
            description:
              "Force a full catalog refresh even if data exists (default: false)",
          },
        },
        required: ["storeNumber"],
      },
      annotations: {
        idempotentHint: true,
      },
    },
  ];
}

/**
 * Static tool definitions for testing (without database).
 */
export const TOOL_DEFINITIONS = getToolDefinitions();

// Module-level data directory for use by tool handlers
let dataDir: string = "";

/**
 * Create and configure the MCP server with tool handlers.
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "forager",
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
      const storesDb = getStoresDb();

      let storeDataDb: Database.Database | null = null;
      const storesDir = join(dataDir, "stores");
      if (existsSync(storesDir)) {
        const files = readdirSync(storesDir).filter(
          (f) => f.endsWith(".db") && !f.endsWith(".tmp")
        );
        const firstFile = files[0];
        if (firstFile) {
          const sampleStore = firstFile.replace(".db", "");
          try {
            const { readonlyDb } = getStoreDataDb(sampleStore);
            storeDataDb = readonlyDb;
          } catch {
            // Ignore — schema not available
          }
        }
      }

      return { tools: getToolDefinitions(storesDb, storeDataDb) };
    } catch {
      // Databases not initialized yet
      return { tools: getToolDefinitions() };
    }
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "query": {
          const { sql, database = "products", storeNumber } = args as {
            sql?: string;
            database?: "stores" | "products";
            storeNumber?: string;
          };

          if (typeof sql !== "string") {
            return {
              content: [
                { type: "text", text: JSON.stringify({ success: false, error: "Missing required parameter: sql" }) },
              ],
            };
          }

          if (database === "stores") {
            const storesDb = getStoresDb();
            const result = queryTool(storesDb, sql);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          } else {
            // database === "products"
            if (!storeNumber) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      success: false,
                      error:
                        "Missing required parameter: storeNumber. Query the stores database first to find the store number, then pass it here.",
                    }),
                  },
                ],
              };
            }

            try {
              const { readonlyDb } = getStoreDataDb(storeNumber);
              const result = queryTool(readonlyDb, sql);
              return {
                content: [{ type: "text", text: JSON.stringify(result) }],
              };
            } catch (err) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      success: false,
                      error: err instanceof Error ? err.message : String(err),
                    }),
                  },
                ],
              };
            }
          }
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
            process.stderr.write(`[forager] ${progress.message}\n`);
          };

          const settingsDb = getSettingsDb();
          const storesDb = getStoresDb();

          const result = await setStoreTool(dataDir, settingsDb, storesDb, {
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
 * Log to stderr (since stdout is used for MCP JSON-RPC).
 */
function log(message: string): void {
  process.stderr.write(`[forager] ${message}\n`);
}

/**
 * Refresh stores cache on startup if stale.
 */
async function refreshStoresIfNeeded(): Promise<void> {
  try {
    const storesDb = getStoresDb();
    const { stores, fromCache, error } = await getStores(storesDb);
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
  // Get data directory
  dataDir = getDataDir();

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Open database connections
  openDatabases(dataDir);

  // Refresh stores cache if needed
  await refreshStoresIfNeeded();

  // Create and start server
  const server = createServer();
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    closeDatabases();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    closeDatabases();
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
    closeDatabases();
    process.exit(1);
  });
}
