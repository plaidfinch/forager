/**
 * Tests for the refreshApiKey tool.
 *
 * Uses injectable extractFn for testing without actual Playwright browser.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initializeSchema } from "../../src/db/schema.js";
import { refreshApiKeyTool } from "../../src/tools/refreshApiKey.js";
import type { KeyExtractionResult } from "../../src/algolia/keyExtractor.js";

describe("refreshApiKeyTool", () => {
  let testDir: string;
  let testDbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create temp directory and file-based database
    testDir = join(tmpdir(), `wegmans-refresh-api-key-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create and initialize database
    db = new Database(testDbPath);
    db.pragma("foreign_keys = ON");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("stores extracted API key in database", async () => {
    // Mock extractFn that returns success
    const mockExtractFn = async (): Promise<KeyExtractionResult> => ({
      success: true,
      apiKey: "test-api-key-12345",
      appId: "TEST_APP_ID",
      storeNumber: "74",
    });

    const result = await refreshApiKeyTool(db, {
      storeName: "Geneva, NY",
      extractFn: mockExtractFn,
    });

    expect(result.success).toBe(true);
    expect(result.apiKey).toBe("test-api-key-12345");
    expect(result.storeNumber).toBe("74");
    expect(result.error).toBeUndefined();

    // Verify key was stored in database
    const stored = db
      .prepare("SELECT key, app_id FROM api_keys ORDER BY id DESC LIMIT 1")
      .get() as { key: string; app_id: string };

    expect(stored.key).toBe("test-api-key-12345");
    expect(stored.app_id).toBe("TEST_APP_ID");
  });

  it("returns error when extraction fails", async () => {
    // Mock extractFn that returns failure
    const mockExtractFn = async (): Promise<KeyExtractionResult> => ({
      success: false,
      apiKey: null,
      appId: null,
      storeNumber: null,
      error: "Failed to capture Algolia API key from requests",
    });

    const result = await refreshApiKeyTool(db, {
      storeName: "Invalid Store",
      extractFn: mockExtractFn,
    });

    expect(result.success).toBe(false);
    expect(result.apiKey).toBeUndefined();
    expect(result.storeNumber).toBeUndefined();
    expect(result.error).toBe("Failed to capture Algolia API key from requests");

    // Verify no key was stored in database
    const count = db
      .prepare("SELECT COUNT(*) as count FROM api_keys")
      .get() as { count: number };

    expect(count.count).toBe(0);
  });
});
