/**
 * Meta-test: Validates ALL response snapshots can be parsed.
 *
 * As we accumulate more API response snapshots during development,
 * this test ensures our schemas remain compatible with all observed
 * response variations.
 *
 * To add new snapshots:
 * 1. Save response JSON to snapshots/responses/
 * 2. Name format: {description}-{timestamp}.json or response-{n}-{status}.json
 * 3. Run tests to verify it parses correctly
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlgoliaMultiQueryResponseSchema,
  AlgoliaSingleQueryResponseSchema,
} from "../../src/types/algolia.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESPONSES_DIR = join(__dirname, "..", "..", "snapshots", "responses");

interface ParseResult {
  file: string;
  type: "multi-query" | "single-query" | "unknown";
  success: boolean;
  hitCount?: number;
  error?: string;
}

function parseResponseFile(filePath: string): ParseResult {
  const file = filePath.split("/").pop() ?? filePath;

  try {
    const content = readFileSync(filePath, "utf-8");
    const raw = JSON.parse(content) as unknown;

    if (typeof raw !== "object" || raw === null) {
      return { file, type: "unknown", success: false, error: "Not an object" };
    }

    // Multi-query response (has results array)
    if ("results" in raw) {
      const result = AlgoliaMultiQueryResponseSchema.safeParse(raw);
      if (result.success) {
        const hitCount = result.data.results.reduce(
          (sum, r) => sum + r.hits.length,
          0
        );
        return { file, type: "multi-query", success: true, hitCount };
      } else {
        return {
          file,
          type: "multi-query",
          success: false,
          error: result.error.issues.slice(0, 3).map(i => i.message).join("; "),
        };
      }
    }

    // Single-query response (has hits directly)
    if ("hits" in raw) {
      const result = AlgoliaSingleQueryResponseSchema.safeParse(raw);
      if (result.success) {
        return {
          file,
          type: "single-query",
          success: true,
          hitCount: result.data.hits.length,
        };
      } else {
        return {
          file,
          type: "single-query",
          success: false,
          error: result.error.issues.slice(0, 3).map(i => i.message).join("; "),
        };
      }
    }

    return { file, type: "unknown", success: false, error: "Unknown response format" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { file, type: "unknown", success: false, error: message };
  }
}

function getAllResponseFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && entry.endsWith(".json")) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist yet
  }

  return files;
}

describe("All Response Snapshots", () => {
  const responseFiles = getAllResponseFiles(RESPONSES_DIR);

  it("has at least one response snapshot", () => {
    expect(responseFiles.length).toBeGreaterThan(0);
    console.log(`Found ${responseFiles.length} response snapshot(s)`);
  });

  it("parses all response snapshots without errors", () => {
    const results: ParseResult[] = responseFiles.map(parseResponseFile);

    // Log summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log("\n=== Response Snapshot Summary ===");
    console.log(`Total: ${results.length}`);
    console.log(`Passed: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log("\nSuccessful:");
      for (const r of successful) {
        console.log(`  ✓ ${r.file} (${r.type}, ${r.hitCount} hits)`);
      }
    }

    if (failed.length > 0) {
      console.log("\nFailed:");
      for (const r of failed) {
        console.log(`  ✗ ${r.file}: ${r.error}`);
      }
    }

    // Assert all passed
    expect(failed.length).toBe(0);
  });

  // Generate individual test for each file for better error reporting
  for (const filePath of responseFiles) {
    const fileName = filePath.split("/").pop() ?? filePath;

    it(`parses ${fileName}`, () => {
      const result = parseResponseFile(filePath);

      if (!result.success) {
        console.error(`Failed to parse ${fileName}: ${result.error}`);
      }

      expect(result.success).toBe(true);
    });
  }
});
