/**
 * Unit tests for Algolia key extractor.
 *
 * Tests URL parsing utilities and the AST-based credential extraction
 * from JavaScript source code.
 *
 * Integration tests that actually hit the website are in
 * keyExtractor.integration.test.ts and should be run manually.
 */

import { describe, it, expect } from "vitest";
import {
  parseAlgoliaKeyFromUrl,
  parseAlgoliaAppIdFromUrl,
  parseChunkUrls,
  extractCredentialsFromJs,
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

describe("parseChunkUrls", () => {
  it("extracts Next.js chunk script URLs from HTML", () => {
    const html = `
      <html>
      <head>
        <script src="/_next/static/chunks/webpack-abc123.js" async=""></script>
        <script src="/_next/static/chunks/55601-07eb2056462a96d4.js" async=""></script>
      </head>
      <body></body>
      </html>
    `;

    const urls = parseChunkUrls(html, "https://www.wegmans.com");

    expect(urls).toEqual([
      "https://www.wegmans.com/_next/static/chunks/webpack-abc123.js",
      "https://www.wegmans.com/_next/static/chunks/55601-07eb2056462a96d4.js",
    ]);
  });

  it("returns empty array when no chunks found", () => {
    const html = "<html><head></head><body>Hello</body></html>";

    const urls = parseChunkUrls(html, "https://www.wegmans.com");

    expect(urls).toEqual([]);
  });

  it("ignores non-chunk script tags", () => {
    const html = `
      <script src="/some-other-script.js"></script>
      <script src="/_next/static/chunks/main-app-abc.js" async=""></script>
      <script>console.log("inline")</script>
    `;

    const urls = parseChunkUrls(html, "https://www.wegmans.com");

    expect(urls).toEqual([
      "https://www.wegmans.com/_next/static/chunks/main-app-abc.js",
    ]);
  });
});

describe("extractCredentialsFromJs", () => {
  it("extracts credentials from minified JS with {apiKey: VAR, appId: VAR}", () => {
    // Simulate the real minified pattern observed in the Wegmans bundle.
    const source = `
      (function() {
        var C = "QGPPR19V8V", b = "9a10b1401634e9a6e55161c3a60c200d";
        if (!C || !b) throw Error("Algolia credentials missing");
        doSomething("init", {apiKey: b, appId: C, userToken: "anon"});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toEqual({
      apiKey: "9a10b1401634e9a6e55161c3a60c200d",
      appId: "QGPPR19V8V",
    });
  });

  it("extracts credentials when variables are declared with let", () => {
    const source = `
      (function() {
        let key = "abcdef01234567890abcdef012345678";
        let id = "MYAPPID123";
        setup({apiKey: key, appId: id});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toEqual({
      apiKey: "abcdef01234567890abcdef012345678",
      appId: "MYAPPID123",
    });
  });

  it("extracts credentials when variables are declared with const", () => {
    const source = `
      (function() {
        const k = "abcdef01234567890abcdef012345678";
        const a = "TESTAPP123";
        init({apiKey: k, appId: a, extra: true});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toEqual({
      apiKey: "abcdef01234567890abcdef012345678",
      appId: "TESTAPP123",
    });
  });

  it("resolves variables from enclosing scope", () => {
    // Variables declared in outer function, used in inner.
    const source = `
      (function() {
        var appKey = "abcdef01234567890abcdef012345678";
        var appId = "OUTERSCOPE";
        (function inner() {
          setup({apiKey: appKey, appId: appId});
        })();
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toEqual({
      apiKey: "abcdef01234567890abcdef012345678",
      appId: "OUTERSCOPE",
    });
  });

  it("returns null when apiKey property is missing", () => {
    const source = `
      (function() {
        var x = "abc";
        setup({appId: x});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toBeNull();
  });

  it("returns null when appId property is missing", () => {
    const source = `
      (function() {
        var x = "abcdef01234567890abcdef012345678";
        setup({apiKey: x});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toBeNull();
  });

  it("returns null when API key doesn't match expected format", () => {
    const source = `
      (function() {
        var k = "too-short";
        var a = "VALIDAPPID";
        setup({apiKey: k, appId: a});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toBeNull();
  });

  it("returns null when app ID doesn't match expected format", () => {
    const source = `
      (function() {
        var k = "abcdef01234567890abcdef012345678";
        var a = "lowercase_invalid";
        setup({apiKey: k, appId: a});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toBeNull();
  });

  it("returns null for invalid JavaScript", () => {
    const result = extractCredentialsFromJs("this is not valid javascript {{{}}}");

    expect(result).toBeNull();
  });

  it("returns null for JS without any Algolia pattern", () => {
    const source = `
      var x = 1;
      console.log("hello world");
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toBeNull();
  });

  it("ignores objects where apiKey/appId values are not identifiers", () => {
    // Values are string literals directly, not variable references.
    // This shouldn't match because real minified code uses variables.
    const source = `
      setup({apiKey: "abcdef01234567890abcdef012345678", appId: "DIRECTLIT1"});
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toBeNull();
  });

  it("handles multiple scopes with same variable names", () => {
    // Two separate functions each declare 'k' and 'a', but only one
    // has the apiKey/appId pattern. Scope analysis should pick the right one.
    const source = `
      (function() {
        var k = "not-a-valid-key";
        var a = "not-valid";
        doStuff(k, a);
      })();
      (function() {
        var k = "abcdef01234567890abcdef012345678";
        var a = "CORRECTID1";
        setup({apiKey: k, appId: a});
      })();
    `;

    const result = extractCredentialsFromJs(source);

    expect(result).toEqual({
      apiKey: "abcdef01234567890abcdef012345678",
      appId: "CORRECTID1",
    });
  });
});
