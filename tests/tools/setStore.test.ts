/**
 * Tests for the setStore tool.
 *
 * Tests the multi-database architecture where:
 * - settings.db: API keys and active_store setting
 * - stores.db: Store locations
 * - stores/{storeNumber}.db: Per-store products
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  initializeSettingsSchema,
  initializeStoresSchema,
  initializeStoreDataSchema,
} from "../../src/db/schema.js";
import {
  setStoreTool,
  getActiveStore,
  type SetStoreOptions,
} from "../../src/tools/setStore.js";
import type { RefreshResult } from "../../src/catalog/index.js";

describe("setStoreTool", () => {
  let testDir: string;
  let settingsDb: Database.Database;
  let storesDb: Database.Database;

  beforeEach(() => {
    // Create temp directory structure
    testDir = join(tmpdir(), `wegmans-setstore-test-${randomUUID()}`);
    mkdirSync(join(testDir, "stores"), { recursive: true });

    // Create and initialize settings.db
    const settingsPath = join(testDir, "settings.db");
    settingsDb = new Database(settingsPath);
    settingsDb.pragma("foreign_keys = ON");
    initializeSettingsSchema(settingsDb);

    // Create and initialize stores.db
    const storesPath = join(testDir, "stores.db");
    storesDb = new Database(storesPath);
    storesDb.pragma("foreign_keys = ON");
    initializeStoresSchema(storesDb);
  });

  afterEach(() => {
    settingsDb.close();
    storesDb.close();

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("store validation", () => {
    it("returns error when store does not exist in stores.db", async () => {
      // No stores in database - store 74 does not exist
      const mockRefresh = vi.fn();
      const mockOpenStore = vi.fn();

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/store.*not found/i);
      expect(mockOpenStore).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("succeeds when store exists in stores.db", async () => {
      // Add store 74 to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Create store database manually for this test
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      // Add a product so we don't trigger refresh
      storeDb.exec(`INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', datetime('now'))`);
      storeDb.close();

      const mockRefresh = vi.fn();
      let openedStoreDb: Database.Database | null = null;

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        openedStoreDb = new Database(path);
        return openedStoreDb;
      });

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(true);
      expect(result.storeNumber).toBe("74");
      expect(mockOpenStore).toHaveBeenCalledWith(testDir, "74");

      if (openedStoreDb) {
        openedStoreDb.close();
      }
    });
  });

  describe("store database management", () => {
    it("opens correct store database using openStoreDatabase", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('101', 'Pittsford')`);

      let capturedDataDir: string | null = null;
      let capturedStoreNumber: string | null = null;

      // Create store database
      const storePath = join(testDir, "stores", "101.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.exec(`INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', datetime('now'))`);
      storeDb.close();

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        capturedDataDir = dataDir;
        capturedStoreNumber = storeNumber;
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "101",
        refreshCatalogFn: vi.fn(),
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(true);
      expect(capturedDataDir).toBe(testDir);
      expect(capturedStoreNumber).toBe("101");
    });
  });

  describe("active store persistence", () => {
    it("saves active_store in settings.db", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Create store database
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.exec(`INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', datetime('now'))`);
      storeDb.close();

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: vi.fn(),
        openStoreDatabaseFn: mockOpenStore,
      });

      // Verify active_store was saved in settings.db
      const stored = settingsDb
        .prepare("SELECT value FROM settings WHERE key = 'active_store'")
        .get() as { value: string } | undefined;

      expect(stored).toBeDefined();
      expect(stored!.value).toBe("74");
    });

    it("updates active_store when switching stores", async () => {
      // Add both stores to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('101', 'Pittsford')`);

      // Create both store databases
      for (const storeNum of ["74", "101"]) {
        const storePath = join(testDir, "stores", `${storeNum}.db`);
        const storeDb = new Database(storePath);
        initializeStoreDataSchema(storeDb);
        storeDb.exec(`INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', datetime('now'))`);
        storeDb.close();
      }

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      // Set to store 74 first
      await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: vi.fn(),
        openStoreDatabaseFn: mockOpenStore,
      });

      // Switch to store 101
      await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "101",
        refreshCatalogFn: vi.fn(),
        openStoreDatabaseFn: mockOpenStore,
      });

      // Verify active_store is now 101
      const stored = settingsDb
        .prepare("SELECT value FROM settings WHERE key = 'active_store'")
        .get() as { value: string } | undefined;

      expect(stored!.value).toBe("101");
    });
  });

  describe("getActiveStore", () => {
    it("returns null when no active store set", () => {
      const result = getActiveStore(settingsDb);
      expect(result).toBeNull();
    });

    it("returns store number when active store is set", () => {
      settingsDb.exec(`INSERT INTO settings (key, value) VALUES ('active_store', '74')`);

      const result = getActiveStore(settingsDb);
      expect(result).toBe("74");
    });
  });

  describe("product count", () => {
    it("returns product count from store database (no store filter)", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Create store database with multiple products
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.exec(`
        INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Product 1', datetime('now'));
        INSERT INTO products (product_id, name, last_updated) VALUES ('p2', 'Product 2', datetime('now'));
        INSERT INTO products (product_id, name, last_updated) VALUES ('p3', 'Product 3', datetime('now'));
      `);
      storeDb.close();

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: vi.fn(),
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(true);
      expect(result.productCount).toBe(3);
    });
  });

  describe("catalog refresh", () => {
    it("triggers refresh when store database has no products", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('test-key', 'TEST_APP', datetime('now'))`);

      // Create empty store database
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      let capturedDb: Database.Database | null = null;
      let capturedApiKey: string | null = null;
      let capturedStoreNumber: string | null = null;

      const mockRefresh = vi.fn(
        async (
          db: Database.Database,
          apiKey: string,
          appId: string,
          storeNumber: string
        ): Promise<RefreshResult> => {
          capturedDb = db;
          capturedApiKey = apiKey;
          capturedStoreNumber = storeNumber;
          return { success: true, productsAdded: 100, categoriesAdded: 10, tagsAdded: 5 };
        }
      );

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(true);
      expect(result.refreshed).toBe(true);
      expect(mockRefresh).toHaveBeenCalled();
      expect(capturedApiKey).toBe("test-key");
      expect(capturedStoreNumber).toBe("74");
      expect(capturedDb).toBeDefined();
    });

    it("does not trigger refresh when store has products and is fresh", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Create store database with products
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.exec(`INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', datetime('now'))`);
      storeDb.close();

      const mockRefresh = vi.fn();

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(true);
      expect(result.refreshed).toBe(false);
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("triggers refresh when forceRefresh is true", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('test-key', 'TEST_APP', datetime('now'))`);

      // Create store database with fresh products
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.exec(`INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', datetime('now'))`);
      storeDb.close();

      const mockRefresh = vi.fn(async (): Promise<RefreshResult> => {
        return { success: true, productsAdded: 100, categoriesAdded: 10, tagsAdded: 5 };
      });

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        forceRefresh: true,
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(result.success).toBe(true);
      expect(result.refreshed).toBe(true);
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("returns error when API credentials not available and extraction fails", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // No API credentials in settings.db

      // Create empty store database (triggers refresh)
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      const mockRefresh = vi.fn();

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      // Mock extractFn that fails
      const mockExtract = vi.fn(async () => ({
        success: false as const,
        apiKey: null,
        appId: null,
        storeNumber: null,
        error: "Failed to extract",
      }));

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
        extractFn: mockExtract,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/credentials/i);
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("gets API credentials from settings.db for refresh", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add specific API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('my-secret-key', 'MY_APP_ID', datetime('now'))`);

      // Create empty store database (triggers refresh)
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      let capturedApiKey: string | null = null;
      let capturedAppId: string | null = null;

      const mockRefresh = vi.fn(
        async (
          db: Database.Database,
          apiKey: string,
          appId: string,
          storeNumber: string
        ): Promise<RefreshResult> => {
          capturedApiKey = apiKey;
          capturedAppId = appId;
          return { success: true, productsAdded: 100, categoriesAdded: 10, tagsAdded: 5 };
        }
      );

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
      });

      expect(capturedApiKey).toBe("my-secret-key");
      expect(capturedAppId).toBe("MY_APP_ID");
    });

    it("retries with fresh credentials when refresh fails with 401 auth error", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add expired/invalid API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('expired-key', 'OLD_APP', datetime('now'))`);

      // Create empty store database (triggers refresh)
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      const capturedApiKeys: string[] = [];
      let refreshCallCount = 0;

      const mockRefresh = vi.fn(
        async (
          db: Database.Database,
          apiKey: string,
          appId: string,
          storeNumber: string
        ): Promise<RefreshResult> => {
          capturedApiKeys.push(apiKey);
          refreshCallCount++;

          // First call fails with 401 auth error
          if (refreshCallCount === 1) {
            return {
              success: false,
              productsAdded: 0,
              categoriesAdded: 0,
              tagsAdded: 0,
              error: "Algolia error: 401 Unauthorized",
              status: 401,
            };
          }
          // Second call succeeds with new credentials
          return { success: true, productsAdded: 100, categoriesAdded: 10, tagsAdded: 5 };
        }
      );

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      // Mock extractFn that returns new credentials
      const mockExtract = vi.fn(async () => ({
        success: true as const,
        apiKey: "fresh-new-key",
        appId: "NEW_APP",
        storeNumber: null,
        error: null,
      }));

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
        extractFn: mockExtract,
      });

      // Should succeed after retry with fresh credentials
      expect(result.success).toBe(true);
      expect(result.refreshed).toBe(true);

      // Should have called refresh twice
      expect(refreshCallCount).toBe(2);

      // First call used old key, second call used fresh key
      expect(capturedApiKeys).toEqual(["expired-key", "fresh-new-key"]);

      // Extract should have been called once (for the retry)
      expect(mockExtract).toHaveBeenCalledTimes(1);
    });

    it("retries with fresh credentials when refresh fails with 403 forbidden error", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add invalid API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('bad-key', 'BAD_APP', datetime('now'))`);

      // Create empty store database (triggers refresh)
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      let refreshCallCount = 0;

      const mockRefresh = vi.fn(
        async (
          db: Database.Database,
          apiKey: string,
          appId: string,
          storeNumber: string
        ): Promise<RefreshResult> => {
          refreshCallCount++;
          if (refreshCallCount === 1) {
            return {
              success: false,
              productsAdded: 0,
              categoriesAdded: 0,
              tagsAdded: 0,
              error: "Algolia error: 403 Forbidden",
              status: 403,
            };
          }
          return { success: true, productsAdded: 100, categoriesAdded: 10, tagsAdded: 5 };
        }
      );

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const mockExtract = vi.fn(async () => ({
        success: true as const,
        apiKey: "new-key",
        appId: "NEW_APP",
        storeNumber: null,
        error: null,
      }));

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
        extractFn: mockExtract,
      });

      expect(result.success).toBe(true);
      expect(refreshCallCount).toBe(2);
    });

    it("returns error when retry also fails with auth error", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add expired API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('expired-key', 'OLD_APP', datetime('now'))`);

      // Create empty store database (triggers refresh)
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      const mockRefresh = vi.fn(
        async (): Promise<RefreshResult> => {
          // Both attempts fail with auth error
          return {
            success: false,
            productsAdded: 0,
            categoriesAdded: 0,
            tagsAdded: 0,
            error: "Algolia error: 401 Unauthorized",
            status: 401,
          };
        }
      );

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const mockExtract = vi.fn(async () => ({
        success: true as const,
        apiKey: "also-expired-key",
        appId: "ALSO_BAD_APP",
        storeNumber: null,
        error: null,
      }));

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
        extractFn: mockExtract,
      });

      // Should fail after retry also fails
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/401/);

      // Should have tried twice (original + retry)
      expect(mockRefresh).toHaveBeenCalledTimes(2);
    });

    it("does not retry on non-auth errors", async () => {
      // Add store to stores.db
      storesDb.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

      // Add API credentials to settings.db
      settingsDb.exec(`INSERT INTO api_keys (key, app_id, extracted_at) VALUES ('good-key', 'GOOD_APP', datetime('now'))`);

      // Create empty store database (triggers refresh)
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new Database(storePath);
      initializeStoreDataSchema(storeDb);
      storeDb.close();

      const mockRefresh = vi.fn(
        async (): Promise<RefreshResult> => {
          // Non-auth error (e.g., network error or 500)
          return {
            success: false,
            productsAdded: 0,
            categoriesAdded: 0,
            tagsAdded: 0,
            error: "Network error: fetch failed",
          };
        }
      );

      const mockOpenStore = vi.fn((dataDir: string, storeNumber: string) => {
        const path = join(dataDir, "stores", `${storeNumber}.db`);
        return new Database(path);
      });

      const mockExtract = vi.fn();

      const result = await setStoreTool(testDir, settingsDb, storesDb, {
        storeNumber: "74",
        refreshCatalogFn: mockRefresh,
        openStoreDatabaseFn: mockOpenStore,
        extractFn: mockExtract,
      });

      // Should fail without retry
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Network error/);

      // Should have only tried once (no retry for non-auth errors)
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      // Extract should not have been called
      expect(mockExtract).not.toHaveBeenCalled();
    });
  });
});
