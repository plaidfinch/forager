/**
 * Unit tests for Algolia key extractor.
 *
 * Note: Integration tests that actually hit the website are in
 * keyExtractor.integration.test.ts and should be run manually.
 */

import { describe, it, expect } from "vitest";
import {
  parseAlgoliaKeyFromUrl,
  parseAlgoliaAppIdFromUrl,
  type KeyExtractionResult,
} from "../../src/algolia/keyExtractor.js";

describe("Algolia Key Extractor - URL Parsing", () => {
  describe("parseAlgoliaKeyFromUrl", () => {
    it("extracts API key from x-algolia-api-key header parameter", () => {
      const url = "https://qgppr19v8v-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=9a10b1401634e9a6e55161c3a60c200d&x-algolia-application-id=QGPPR19V8V";

      const result = parseAlgoliaKeyFromUrl(url);

      expect(result).toBe("9a10b1401634e9a6e55161c3a60c200d");
    });

    it("returns null for URLs without API key", () => {
      const url = "https://www.wegmans.com/shop/search?query=milk";

      const result = parseAlgoliaKeyFromUrl(url);

      expect(result).toBeNull();
    });

    it("handles URL with other parameters", () => {
      const url = "https://qgppr19v8v-dsn.algolia.net/1/indexes/*/queries?foo=bar&x-algolia-api-key=abc123&baz=qux";

      const result = parseAlgoliaKeyFromUrl(url);

      expect(result).toBe("abc123");
    });
  });

  describe("parseAlgoliaAppIdFromUrl", () => {
    it("extracts App ID from x-algolia-application-id parameter", () => {
      const url = "https://qgppr19v8v-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=9a10b1401634e9a6e55161c3a60c200d&x-algolia-application-id=QGPPR19V8V";

      const result = parseAlgoliaAppIdFromUrl(url);

      expect(result).toBe("QGPPR19V8V");
    });

    it("extracts App ID from hostname", () => {
      const url = "https://qgppr19v8v-dsn.algolia.net/1/indexes/*/queries";

      const result = parseAlgoliaAppIdFromUrl(url);

      expect(result).toBe("QGPPR19V8V");
    });

    it("returns null for non-Algolia URLs", () => {
      const url = "https://www.wegmans.com/shop/search";

      const result = parseAlgoliaAppIdFromUrl(url);

      expect(result).toBeNull();
    });
  });
});
