#!/usr/bin/env node
/**
 * MCP Server Entry Point for Wegmans Product Data.
 *
 * Provides 1 tool for interacting with Wegmans product data:
 * - query: Execute read-only SQL queries (schema is embedded in tool description)
 *
 * Store catalogs are auto-loaded on first query and background-refreshed
 * when stale. No setStore step required.
 *
 * Multi-database architecture:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations (auto-fetched)
 * - stores/{storeNumber}.db: Per-store product data (auto-loaded on query)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  openDatabases,
  closeDatabases,
  getSettingsDb,
  getStoresDb,
  getStoreDataDb,
} from "./db/connection.js";
import { queryTool } from "./tools/query.js";
import { STORES_SCHEMA_DDL, STORE_DATA_SCHEMA_DDL } from "./db/schema.js";
import { ensureCatalog } from "./catalog/ensure.js";
import { getCatalogStatus, refreshCatalogToFile, refreshCatalogsToFile } from "./catalog/index.js";
import { ensureApiCredentials } from "./algolia/credentials.js";
import {
  getStoresFromCache,
  isStoresCacheStale,
  refreshStoresToFile,
} from "./stores/fetch.js";
import { startScheduler, stopScheduler, countStoreDbs } from "./scheduler.js";

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
 * Static tool definitions with schema embedded from DDL constants.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "query",
    description: `Execute a read-only SQL query. Use the 'storeNumber' parameter to choose which database to query:
- Omit storeNumber: Query runs against the store locations table (find store numbers, cities, etc.)
- Provide storeNumber: Query runs against that store's product catalog (auto-loads on first use)

STORES SCHEMA (when storeNumber is omitted):
${STORES_SCHEMA_DDL}

PRODUCTS SCHEMA (when storeNumber is provided):
${STORE_DATA_SCHEMA_DDL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "The SQL SELECT statement to execute",
        },
        storeNumber: {
          type: "string",
          description:
            "Wegmans store number. When provided, the query runs against that store's product catalog. When omitted, the query runs against the stores table. Query the stores table first to find store numbers by city, state, or zip code.",
        },
      },
      required: ["sql"],
    },
    annotations: {
      readOnlyHint: true,
    },
  },
];

// Module-level data directory for use by tool handlers
let dataDir: string = "";

// --- Background refresh infrastructure ---

const refreshesInProgress = new Set<string>();
const STORES_KEY = "__stores__";

export function triggerBackgroundRefresh(key: string, fn: () => Promise<void>): void {
  if (refreshesInProgress.has(key)) return;
  refreshesInProgress.add(key);
  fn()
    .catch(err => log(`Background refresh ${key} failed: ${err instanceof Error ? err.message : err}`))
    .finally(() => refreshesInProgress.delete(key));
}

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

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "query": {
          const { sql, storeNumber } = args as {
            sql?: string;
            storeNumber?: string;
          };

          if (typeof sql !== "string") {
            return {
              content: [
                { type: "text", text: JSON.stringify({ success: false, error: "Missing required parameter: sql" }) },
              ],
            };
          }

          if (!storeNumber) {
            // No store specified — query the stores table

            // Ensure stores are loaded
            const storesDb = getStoresDb();
            const cachedStores = getStoresFromCache(storesDb);

            if (cachedStores.length === 0) {
              // First load — block
              const storesPath = join(dataDir, "stores.db");
              await refreshStoresToFile(storesPath);
              // getStoresDb() will detect inode change on next call
            }

            // Re-get (may have been swapped)
            const freshStoresDb = getStoresDb();

            // Check staleness — background refresh if needed
            if (isStoresCacheStale(freshStoresDb)) {
              triggerBackgroundRefresh(STORES_KEY, async () => {
                await refreshStoresToFile(join(dataDir, "stores.db"));
                log("Stores refreshed in background");
              });
            }

            const result = queryTool(freshStoresDb, sql);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          } else {
            // Store specified — query that store's product catalog
            const storePath = join(dataDir, "stores", `${storeNumber}.db`);

            if (!existsSync(storePath)) {
              // First load — block
              const loadResult = await ensureCatalog(dataDir, getSettingsDb(), storeNumber, {
                onProgress: p => process.stderr.write(`[forager] ${p.message}\n`),
              });
              if (!loadResult.success) {
                return {
                  content: [{ type: "text", text: JSON.stringify({ success: false, error: loadResult.error }) }],
                };
              }
            } else {
              // Check staleness — background refresh if needed
              try {
                const { readonlyDb } = getStoreDataDb(storeNumber);
                const status = getCatalogStatus(readonlyDb);
                if (status.isStale) {
                  const STALE_MS = 24 * 60 * 60 * 1000;
                  const dbCount = countStoreDbs(dataDir) + 1;
                  const targetMs = Math.floor(STALE_MS / (2 * dbCount));
                  triggerBackgroundRefresh(storeNumber, async () => {
                    const settingsDb = getSettingsDb();
                    const creds = await ensureApiCredentials(settingsDb);
                    if (!creds) return;
                    await refreshCatalogToFile(storePath, creds.apiKey, creds.appId, storeNumber,
                      p => process.stderr.write(`[forager] ${p.message}\n`), targetMs);
                    log(`Store ${storeNumber} catalog refreshed`);
                  });
                }
              } catch { /* pool will handle missing file */ }
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
    if (!isStoresCacheStale(storesDb)) {
      const cached = getStoresFromCache(storesDb);
      log(`Stores: ${cached.length} (cached)`);
      return;
    }
    const storesPath = join(dataDir, "stores.db");
    const stores = await refreshStoresToFile(storesPath);
    log(`Stores: ${stores.length} (fetched from Wegmans)`);
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

  // Start background refresh scheduler
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  startScheduler({
    dataDir,
    staleThresholdMs: STALE_THRESHOLD_MS,
    triggerBackgroundRefresh,
    refreshStores: async () => {
      await refreshStoresToFile(join(dataDir, "stores.db"));
    },
    refreshStoreCatalogs: async (storeNumbers: string[], targetDurationMs?: number) => {
      const settingsDb = getSettingsDb();
      const creds = await ensureApiCredentials(settingsDb);
      if (!creds) return;
      const storesDir = join(dataDir, "stores");
      await refreshCatalogsToFile(storesDir, creds.apiKey, creds.appId, storeNumbers,
        p => process.stderr.write(`[forager] ${p.message}\n`), targetDurationMs);
    },
    log,
  });

  // Create and start server
  const server = createServer();
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    stopScheduler();
    closeDatabases();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    stopScheduler();
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
    stopScheduler();
    closeDatabases();
    process.exit(1);
  });
}
