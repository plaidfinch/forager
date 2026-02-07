import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { refreshStoresToFile } from "../../src/stores/fetch.js";
import type { StoreInfo } from "../../src/stores/fetch.js";

describe("refreshStoresToFile", () => {
  let testDir: string;
  let targetPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `stores-fetch-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    targetPath = join(testDir, "stores.db");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const fakeStores: StoreInfo[] = [
    {
      storeNumber: "74",
      name: "Geneva",
      city: "Geneva",
      state: "NY",
      zipCode: "14456",
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
  ];

  it("creates store file atomically (target exists, tmp deleted)", async () => {
    const stores = await refreshStoresToFile(targetPath, async () => fakeStores);

    expect(stores).toHaveLength(1);
    expect(stores[0].storeNumber).toBe("74");
    expect(existsSync(targetPath)).toBe(true);
    expect(existsSync(targetPath + ".tmp")).toBe(false);
  });

  it("cleans up on fetch failure", async () => {
    await expect(
      refreshStoresToFile(targetPath, async () => {
        throw new Error("network error");
      })
    ).rejects.toThrow("network error");

    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(targetPath + ".tmp")).toBe(false);
  });

  it("uses injected fetchFn", async () => {
    let called = false;
    await refreshStoresToFile(targetPath, async () => {
      called = true;
      return fakeStores;
    });

    expect(called).toBe(true);
  });
});
