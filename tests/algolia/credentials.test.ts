/**
 * Tests for Algolia credential management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import DatabaseImpl from "better-sqlite3";
import { initializeSettingsSchema } from "../../src/db/schema.js";
import {
  getApiCredentials,
  storeApiKey,
  clearApiCredentials,
  isAuthError,
  ensureApiCredentials,
} from "../../src/algolia/credentials.js";
import type { KeyExtractionResult } from "../../src/algolia/keyExtractor.js";

describe("Algolia Credentials", () => {
  let testDir: string;
  let settingsDb: DatabaseImpl.Database;

  beforeEach(() => {
    testDir = join(tmpdir(), `creds-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
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

  describe("get/store/clear round-trip", () => {
    it("returns null when no credentials exist", () => {
      expect(getApiCredentials(settingsDb)).toBeNull();
    });

    it("stores and retrieves credentials", () => {
      storeApiKey(settingsDb, "abc123", "APP1");
      const creds = getApiCredentials(settingsDb);
      expect(creds).toEqual({ apiKey: "abc123", appId: "APP1" });
    });

    it("clears all credentials", () => {
      storeApiKey(settingsDb, "abc123", "APP1");
      clearApiCredentials(settingsDb);
      expect(getApiCredentials(settingsDb)).toBeNull();
    });
  });

  describe("isAuthError", () => {
    it("returns true for 401", () => {
      expect(isAuthError(401)).toBe(true);
    });

    it("returns true for 403", () => {
      expect(isAuthError(403)).toBe(true);
    });

    it("returns false for other codes", () => {
      expect(isAuthError(200)).toBe(false);
      expect(isAuthError(500)).toBe(false);
      expect(isAuthError(undefined)).toBe(false);
    });
  });

  describe("ensureApiCredentials", () => {
    it("returns existing credentials when present", async () => {
      storeApiKey(settingsDb, "existing-key", "EXISTING");
      const creds = await ensureApiCredentials(settingsDb);
      expect(creds).toEqual({ apiKey: "existing-key", appId: "EXISTING" });
    });

    it("extracts and stores when none exist", async () => {
      const mockExtract = async (): Promise<KeyExtractionResult> => ({
        success: true,
        apiKey: "new-key",
        appId: "NEWAPP",
        storeNumber: null,
      });

      const creds = await ensureApiCredentials(settingsDb, mockExtract);
      expect(creds).toEqual({ apiKey: "new-key", appId: "NEWAPP" });

      // Should be persisted
      const stored = getApiCredentials(settingsDb);
      expect(stored).toEqual({ apiKey: "new-key", appId: "NEWAPP" });
    });

    it("returns null when extraction fails", async () => {
      const mockExtract = async (): Promise<KeyExtractionResult> => ({
        success: false,
        apiKey: null,
        appId: null,
        storeNumber: null,
        error: "extraction failed",
      });

      const creds = await ensureApiCredentials(settingsDb, mockExtract);
      expect(creds).toBeNull();
    });
  });
});
