/**
 * Tests for catalog first-load (ensureCatalog).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import DatabaseImpl from "better-sqlite3";
import { initializeSettingsSchema } from "../../src/db/schema.js";
import { ensureCatalog } from "../../src/catalog/ensure.js";
import type { KeyExtractionResult } from "../../src/algolia/keyExtractor.js";
import type { RefreshResult } from "../../src/catalog/index.js";

describe("ensureCatalog", () => {
  let testDir: string;
  let settingsDb: DatabaseImpl.Database;

  beforeEach(() => {
    testDir = join(tmpdir(), `ensure-catalog-test-${randomUUID()}`);
    mkdirSync(join(testDir, "stores"), { recursive: true });
    settingsDb = new DatabaseImpl(join(testDir, "settings.db"));
    settingsDb.pragma("foreign_keys = ON");
    initializeSettingsSchema(settingsDb);
  });

  afterEach(() => {
    settingsDb.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const successExtract = async (): Promise<KeyExtractionResult> => ({
    success: true,
    apiKey: "test-key",
    appId: "TESTAPP",
    storeNumber: null,
  });

  const failExtract = async (): Promise<KeyExtractionResult> => ({
    success: false,
    apiKey: null,
    appId: null,
    storeNumber: null,
    error: "extraction failed",
  });

  const successRefresh = async (): Promise<RefreshResult> => ({
    success: true,
    productsAdded: 100,
    categoriesAdded: 10,
    tagsAdded: 5,
  });

  const authErrorRefresh = async (): Promise<RefreshResult> => ({
    success: false,
    productsAdded: 0,
    categoriesAdded: 0,
    tagsAdded: 0,
    error: "Unauthorized",
    status: 401,
  });

  const nonAuthErrorRefresh = async (): Promise<RefreshResult> => ({
    success: false,
    productsAdded: 0,
    categoriesAdded: 0,
    tagsAdded: 0,
    error: "Server error",
    status: 500,
  });

  it("first load success", async () => {
    const result = await ensureCatalog(testDir, settingsDb, "74", {
      extractFn: successExtract,
      refreshCatalogFn: successRefresh,
    });

    expect(result).toEqual({ success: true, productCount: 100 });
  });

  it("credential extraction failure", async () => {
    const result = await ensureCatalog(testDir, settingsDb, "74", {
      extractFn: failExtract,
      refreshCatalogFn: successRefresh,
    });

    expect(result).toEqual({ success: false, error: "Failed to extract API credentials" });
  });

  it("auth retry: first call 401, re-extract, second call success", async () => {
    let callCount = 0;
    const refreshFn = async (): Promise<RefreshResult> => {
      callCount++;
      if (callCount === 1) {
        return authErrorRefresh();
      }
      return successRefresh();
    };

    const result = await ensureCatalog(testDir, settingsDb, "74", {
      extractFn: successExtract,
      refreshCatalogFn: refreshFn,
    });

    expect(result).toEqual({ success: true, productCount: 100 });
    expect(callCount).toBe(2);
  });

  it("auth retry: both calls fail -> error", async () => {
    const result = await ensureCatalog(testDir, settingsDb, "74", {
      extractFn: successExtract,
      refreshCatalogFn: authErrorRefresh,
    });

    expect(result.success).toBe(false);
  });

  it("non-auth error: no retry", async () => {
    let callCount = 0;
    const refreshFn = async (): Promise<RefreshResult> => {
      callCount++;
      return nonAuthErrorRefresh();
    };

    const result = await ensureCatalog(testDir, settingsDb, "74", {
      extractFn: successExtract,
      refreshCatalogFn: refreshFn,
    });

    expect(result).toEqual({ success: false, error: "Server error" });
    expect(callCount).toBe(1); // Only called once -- no retry for non-auth errors
  });
});
