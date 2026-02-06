/**
 * Integration tests for Algolia key extractor.
 *
 * These tests actually hit the Wegmans website and should be run manually,
 * not in CI. They verify the key extraction works against the live site.
 *
 * Run with: npm test -- tests/algolia/keyExtractor.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { extractAlgoliaKey } from "../../src/algolia/keyExtractor.js";

// Skip in CI - these require network access
const SKIP_INTEGRATION = process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

describe.skipIf(SKIP_INTEGRATION)("Algolia Key Extractor (integration)", () => {
  it("extracts API key from Wegmans website", { timeout: 30000 }, async () => {
    const result = await extractAlgoliaKey({ timeout: 20000 });

    console.log("Extraction result:", {
      success: result.success,
      apiKeyPrefix: result.apiKey?.substring(0, 10),
      appId: result.appId,
      error: result.error,
    });

    expect(result.success).toBe(true);
    expect(result.apiKey).toBeDefined();
    expect(result.apiKey?.length).toBeGreaterThan(10);
    expect(result.appId).toBe("QGPPR19V8V");
  });
});
