import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlgoliaMultiQueryResponseSchema,
  AlgoliaSingleQueryResponseSchema,
} from "../../src/types/algolia.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots", "responses");

describe("Algolia Zod Schema", () => {
  it("successfully parses all captured multi-query responses", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    expect(files.length).toBeGreaterThan(0);

    let parsedCount = 0;
    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      // Multi-query responses have results array
      if (
        typeof raw === "object" &&
        raw !== null &&
        "results" in raw
      ) {
        const result = AlgoliaMultiQueryResponseSchema.safeParse(raw);

        if (!result.success) {
          console.error(`Failed to parse ${file}:`, result.error.format());
        }

        expect(result.success, `Schema should parse ${file}`).toBe(true);
        parsedCount++;
      }
    }

    expect(parsedCount).toBeGreaterThan(0);
  });

  it("successfully parses single-query responses (discovery_pages)", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    let parsedCount = 0;
    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      // Single-query responses have hits directly (no results array)
      if (
        typeof raw === "object" &&
        raw !== null &&
        "hits" in raw &&
        !("results" in raw)
      ) {
        const result = AlgoliaSingleQueryResponseSchema.safeParse(raw);

        if (!result.success) {
          console.error(`Failed to parse ${file}:`, result.error.format());
        }

        expect(result.success, `Schema should parse ${file}`).toBe(true);
        parsedCount++;
      }
    }

    // It's ok if no single-query responses exist
    console.log(`Parsed ${parsedCount} single-query responses`);
  });

  it("extracts product data from parsed response", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      if (
        typeof raw !== "object" ||
        raw === null ||
        !("results" in raw)
      ) {
        continue;
      }

      const result = AlgoliaMultiQueryResponseSchema.parse(raw);
      const firstResult = result.results[0];

      if (firstResult && firstResult.hits.length > 0) {
        const hit = firstResult.hits[0]!;

        // Verify key fields are extracted
        expect(hit).toHaveProperty("objectID");
        expect(hit).toHaveProperty("productId");
        expect(hit).toHaveProperty("productName");
        expect(hit).toHaveProperty("storeNumber");

        console.log("Sample hit fields:", {
          objectID: hit.objectID,
          productId: hit.productId,
          productName: hit.productName,
          brand: hit.consumerBrandName,
          price: hit.price_inStore?.amount,
        });
        return;
      }
    }

    throw new Error("No product results found in any response");
  });

  it("parses nutrition data when present", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      if (
        typeof raw !== "object" ||
        raw === null ||
        !("results" in raw)
      ) {
        continue;
      }

      const result = AlgoliaMultiQueryResponseSchema.parse(raw);

      for (const queryResult of result.results) {
        for (const hit of queryResult.hits) {
          if (hit.nutrition) {
            expect(hit.nutrition).toHaveProperty("serving");
            console.log("Found nutrition data:", {
              productName: hit.productName,
              servingSize: hit.nutrition.serving?.servingSize,
              servingsPerContainer: hit.nutrition.serving?.servingsPerContainer,
            });
            return;
          }
        }
      }
    }

    throw new Error("No nutrition data found in any response - test data may be incomplete");
  });

  it("parses pricing data correctly", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      if (
        typeof raw !== "object" ||
        raw === null ||
        !("results" in raw)
      ) {
        continue;
      }

      const result = AlgoliaMultiQueryResponseSchema.parse(raw);

      for (const queryResult of result.results) {
        for (const hit of queryResult.hits) {
          if (hit.price_inStore) {
            expect(typeof hit.price_inStore.amount).toBe("number");
            expect(typeof hit.price_inStore.unitPrice).toBe("string");

            console.log("Found pricing data:", {
              productName: hit.productName,
              inStore: hit.price_inStore.amount,
              inStoreLoyalty: hit.price_inStoreLoyalty?.amount,
              delivery: hit.price_delivery?.amount,
              deliveryLoyalty: hit.price_deliveryLoyalty?.amount,
            });
            return;
          }
        }
      }
    }

    throw new Error("No pricing data found in any response - test data may be incomplete");
  });

  it("parses planogram (aisle) data correctly", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith("-200.json")
    );

    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;

      if (
        typeof raw !== "object" ||
        raw === null ||
        !("results" in raw)
      ) {
        continue;
      }

      const result = AlgoliaMultiQueryResponseSchema.parse(raw);

      for (const queryResult of result.results) {
        for (const hit of queryResult.hits) {
          if (hit.planogram?.aisle) {
            expect(typeof hit.planogram.aisle).toBe("string");

            console.log("Found planogram data:", {
              productName: hit.productName,
              aisle: hit.planogram.aisle,
              shelf: hit.planogram.shelf,
            });
            return;
          }
        }
      }
    }

    throw new Error("No planogram data found in any response - test data may be incomplete");
  });
});
