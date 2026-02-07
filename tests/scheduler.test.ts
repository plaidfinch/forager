/**
 * Tests for background refresh scheduler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeInterval,
  startScheduler,
  stopScheduler,
} from "../src/scheduler.js";
import type { SchedulerOptions } from "../src/scheduler.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import DatabaseImpl from "better-sqlite3";
import { initializeStoreDataSchema } from "../src/db/schema.js";
import {
  openDatabases,
  closeDatabases,
  getStoresDb,
} from "../src/db/connection.js";
import { saveStoresToCache } from "../src/stores/fetch.js";

describe("Scheduler", () => {
  describe("computeInterval", () => {
    it("returns staleThresholdMs / N for N databases", () => {
      const staleMs = 24 * 60 * 60 * 1000;
      expect(computeInterval(staleMs, 114)).toBe(Math.floor(staleMs / 114));
    });

    it("returns staleThresholdMs for 0 databases", () => {
      const staleMs = 24 * 60 * 60 * 1000;
      expect(computeInterval(staleMs, 0)).toBe(staleMs);
    });

    it("returns staleThresholdMs for 1 database", () => {
      const staleMs = 24 * 60 * 60 * 1000;
      expect(computeInterval(staleMs, 1)).toBe(staleMs);
    });
  });

  describe("scheduler lifecycle", () => {
    let testDir: string;

    beforeEach(() => {
      vi.useFakeTimers();
      testDir = join(tmpdir(), `scheduler-test-${randomUUID()}`);
      mkdirSync(join(testDir, "stores"), { recursive: true });
      openDatabases(testDir);
    });

    afterEach(() => {
      stopScheduler();
      vi.useRealTimers();
      try {
        closeDatabases();
      } catch {
        /* ignore */
      }
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    function makeOptions(
      overrides?: Partial<SchedulerOptions>,
    ): SchedulerOptions {
      return {
        dataDir: testDir,
        staleThresholdMs: 24 * 60 * 60 * 1000,
        triggerBackgroundRefresh: vi.fn(
          (_key: string, fn: () => Promise<void>) => {
            fn();
          },
        ),
        refreshStores: vi.fn(async () => {}),
        refreshStoreCatalogs: vi.fn(async () => {}),
        log: vi.fn(),
        ...overrides,
      };
    }

    it("does nothing when all databases are fresh", () => {
      // Make stores fresh by saving with current timestamp
      const storesDb = getStoresDb();
      saveStoresToCache(storesDb, [
        {
          storeNumber: "1",
          name: "Test",
          city: null,
          state: null,
          zipCode: null,
          streetAddress: null,
          latitude: null,
          longitude: null,
          phoneNumber: null,
          hasPickup: null,
          hasDelivery: null,
          hasECommerce: null,
          hasPharmacy: null,
          sellsAlcohol: null,
          openState: null,
          openingDate: null,
          zones: null,
        },
      ]);

      const opts = makeOptions();
      startScheduler(opts);

      // Advance past initial delay
      vi.advanceTimersByTime(60_000);

      // Nothing should have been triggered since stores are fresh
      expect(opts.triggerBackgroundRefresh).not.toHaveBeenCalled();
    });

    it("triggers stores refresh when stores.db is stale", () => {
      // Stores.db starts empty/stale
      const opts = makeOptions();
      startScheduler(opts);

      // Advance past initial delay
      vi.advanceTimersByTime(60_000);

      expect(opts.triggerBackgroundRefresh).toHaveBeenCalledWith(
        "__stores__",
        expect.any(Function),
      );
    });

    it("triggers store catalog refresh when per-store DB is stale", () => {
      // Make stores fresh
      const storesDb = getStoresDb();
      saveStoresToCache(storesDb, [
        {
          storeNumber: "74",
          name: "Test",
          city: null,
          state: null,
          zipCode: null,
          streetAddress: null,
          latitude: null,
          longitude: null,
          phoneNumber: null,
          hasPickup: null,
          hasDelivery: null,
          hasECommerce: null,
          hasPharmacy: null,
          sellsAlcohol: null,
          openState: null,
          openingDate: null,
          zones: null,
        },
      ]);

      // Create a stale store database
      const storePath = join(testDir, "stores", "74.db");
      const storeDb = new DatabaseImpl(storePath);
      storeDb.pragma("foreign_keys = ON");
      initializeStoreDataSchema(storeDb);
      // Add a product with stale timestamp
      storeDb.exec(
        `INSERT INTO products (product_id, name, last_updated) VALUES ('p1', 'Test', '2020-01-01T00:00:00Z')`,
      );
      storeDb.close();

      const opts = makeOptions();
      startScheduler(opts);

      // Advance past initial delay
      vi.advanceTimersByTime(60_000);

      expect(opts.triggerBackgroundRefresh).toHaveBeenCalledWith(
        "__catalogs__",
        expect.any(Function),
      );
    });

    it("stopScheduler prevents future ticks", () => {
      const opts = makeOptions();
      startScheduler(opts);
      stopScheduler();

      // Advance past initial delay -- no tick should fire
      vi.advanceTimersByTime(60_000);

      expect(opts.triggerBackgroundRefresh).not.toHaveBeenCalled();
    });
  });
});
