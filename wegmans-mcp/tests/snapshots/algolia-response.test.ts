import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots", "responses");

/**
 * Helper to find response files
 */
function getResponseFiles(): string[] {
  return readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.startsWith("response-") && f.endsWith("-200.json"))
    .sort();
}

/**
 * Helper to load a response file
 */
function loadResponse(filename: string): unknown {
  const responsePath = join(SNAPSHOTS_DIR, filename);
  return JSON.parse(readFileSync(responsePath, "utf-8"));
}

/**
 * Find a product search response (has 'results' array with product hits)
 */
function findProductResponse(): { response: Record<string, unknown>; filename: string } | null {
  const files = getResponseFiles();
  for (const filename of files) {
    const response = loadResponse(filename) as Record<string, unknown>;
    if (Array.isArray(response.results)) {
      const results = response.results as Array<{ hits?: unknown[] }>;
      const hasProductHits = results.some(
        (r) => Array.isArray(r.hits) && r.hits.length > 0 &&
               (r.hits[0] as Record<string, unknown>)?.productId !== undefined
      );
      if (hasProductHits) {
        return { response, filename };
      }
    }
  }
  return null;
}

/**
 * Find a discovery pages response (has direct 'hits' array without 'results')
 */
function findDiscoveryResponse(): { response: Record<string, unknown>; filename: string } | null {
  const files = getResponseFiles();
  for (const filename of files) {
    const response = loadResponse(filename) as Record<string, unknown>;
    // Discovery pages have 'hits' directly without 'results' wrapper
    if (Array.isArray(response.hits) && !response.results) {
      return { response, filename };
    }
  }
  return null;
}

describe("Algolia Response Schema", () => {
  describe("Discovery Pages Index", () => {
    it("matches captured discovery response structure", () => {
      const found = findDiscoveryResponse();
      if (!found) {
        throw new Error("No discovery pages response found. Run npm run explore first.");
      }

      const structure = extractStructure(found.response);
      expect(structure).toMatchSnapshot();
    });

    it("contains expected discovery page fields", () => {
      const found = findDiscoveryResponse();
      if (!found) {
        throw new Error("No discovery pages response found. Run npm run explore first.");
      }

      const { response } = found;
      expect(response).toHaveProperty("hits");
      expect(response).toHaveProperty("nbHits");
      expect(response).toHaveProperty("query");

      // Check hit structure
      const hits = response.hits as Array<Record<string, unknown>>;
      if (hits.length > 0) {
        const hit = hits[0];
        expect(hit).toHaveProperty("objectID");
        expect(hit).toHaveProperty("title");
        expect(hit).toHaveProperty("url");
      }
    });
  });

  describe("Product Search Index", () => {
    it("matches captured product response structure", () => {
      const found = findProductResponse();
      if (!found) {
        throw new Error("No product search response found. Run npm run explore first.");
      }

      const structure = extractStructure(found.response);
      expect(structure).toMatchSnapshot();
    });

    it("contains expected top-level fields", () => {
      const found = findProductResponse();
      if (!found) {
        throw new Error("No product search response found. Run npm run explore first.");
      }

      const { response } = found;
      expect(response).toHaveProperty("results");
      expect(Array.isArray(response.results)).toBe(true);
    });

    it("contains product hits with expected fields", () => {
      const found = findProductResponse();
      if (!found) {
        throw new Error("No product search response found. Run npm run explore first.");
      }

      const { response } = found;
      const results = response.results as Array<{ hits?: Array<Record<string, unknown>> }>;

      // Find a result with product hits
      const productResult = results.find(
        (r) => Array.isArray(r.hits) && r.hits.length > 0 &&
               r.hits[0]?.productId !== undefined
      );

      if (!productResult || !productResult.hits) {
        throw new Error("No product results found in response");
      }

      const hit = productResult.hits[0];

      // Based on SCHEMA-ANALYSIS.md findings, these core fields should be present
      expect(hit).toHaveProperty("objectID");
      expect(hit).toHaveProperty("productId");
      expect(hit).toHaveProperty("productName");
      expect(hit).toHaveProperty("skuId");
      expect(hit).toHaveProperty("images");
    });

    it("contains pricing information", () => {
      const found = findProductResponse();
      if (!found) {
        throw new Error("No product search response found. Run npm run explore first.");
      }

      const { response } = found;
      const results = response.results as Array<{ hits?: Array<Record<string, unknown>> }>;

      const productResult = results.find(
        (r) => Array.isArray(r.hits) && r.hits.length > 0 &&
               r.hits[0]?.productId !== undefined
      );

      if (!productResult || !productResult.hits) {
        throw new Error("No product results found in response");
      }

      const hit = productResult.hits[0];

      // At least one pricing field should exist
      const hasPricing = hit.price_inStore || hit.price_inStoreLoyalty ||
                         hit.price_delivery || hit.price_deliveryLoyalty;
      expect(hasPricing).toBeTruthy();
    });

    it("contains category information", () => {
      const found = findProductResponse();
      if (!found) {
        throw new Error("No product search response found. Run npm run explore first.");
      }

      const { response } = found;
      const results = response.results as Array<{ hits?: Array<Record<string, unknown>> }>;

      const productResult = results.find(
        (r) => Array.isArray(r.hits) && r.hits.length > 0 &&
               r.hits[0]?.productId !== undefined
      );

      if (!productResult || !productResult.hits) {
        throw new Error("No product results found in response");
      }

      const hit = productResult.hits[0];

      // Category information should exist
      expect(hit).toHaveProperty("categories");
    });
  });
});

/**
 * Extract just the structure (keys and types) from a JSON object
 * for snapshot comparison without volatile values
 */
function extractStructure(obj: unknown, depth = 0, maxDepth = 5): unknown {
  if (depth > maxDepth) return "[max depth]";

  if (obj === null) return "null";
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    // Just capture structure of first element
    return [extractStructure(obj[0], depth + 1, maxDepth)];
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = extractStructure(value, depth + 1, maxDepth);
    }
    return result;
  }
  return typeof obj;
}
