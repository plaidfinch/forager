/**
 * Algolia API key extraction from Wegmans website.
 *
 * The API key is a public search-only key that Wegmans exposes in their
 * client-side JavaScript bundles. This module extracts the key by fetching
 * the homepage HTML, identifying Next.js chunk URLs, and parsing the
 * JavaScript AST to resolve the Algolia credentials.
 *
 * No browser automation required — pure HTTP fetching and JS parsing.
 */

import * as acorn from "acorn";
import { ancestor } from "acorn-walk";
import { analyze } from "eslint-scope";
import type * as ESTree from "estree";

export interface KeyExtractionResult {
  success: boolean;
  apiKey: string | null;
  appId: string | null;
  storeNumber: string | null;
  error?: string;
}

const WEGMANS_URL = "https://www.wegmans.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const API_KEY_PATTERN = /^[0-9a-f]{32}$/;
const APP_ID_PATTERN = /^[A-Z0-9]{5,20}$/;

/**
 * Extract Algolia API key from a URL's query parameters.
 */
export function parseAlgoliaKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("x-algolia-api-key");
  } catch {
    return null;
  }
}

/**
 * Extract Algolia App ID from a URL (either query param or hostname).
 */
export function parseAlgoliaAppIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // First try query parameter
    const paramAppId = parsed.searchParams.get("x-algolia-application-id");
    if (paramAppId) {
      return paramAppId;
    }

    // Try extracting from hostname (e.g., qgppr19v8v-dsn.algolia.net)
    const hostname = parsed.hostname;
    if (hostname.includes("algolia.net")) {
      const match = hostname.match(/^([a-z0-9]+)-/i);
      if (match?.[1]) {
        return match[1].toUpperCase();
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract Next.js chunk script URLs from HTML.
 */
export function parseChunkUrls(html: string, baseUrl: string): string[] {
  const pattern = /<script[^>]+src="(\/_next\/static\/chunks\/[^"]+)"/g;
  const urls: string[] = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    urls.push(new URL(match[1]!, baseUrl).href);
  }
  return urls;
}

interface AlgoliaCredentials {
  apiKey: string;
  appId: string;
}

/**
 * Extract Algolia credentials from a JavaScript source string by parsing
 * its AST and resolving variable references via scope analysis.
 *
 * Looks for an object literal `{apiKey: VAR, appId: VAR, ...}` where
 * `apiKey` and `appId` are stable Algolia SDK property names that survive
 * minification. Resolves the minified variable names to their string
 * literal definitions using eslint-scope.
 */
export function extractCredentialsFromJs(
  source: string
): AlgoliaCredentials | null {
  let ast: acorn.Node;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      ranges: true,
    });
  } catch {
    return null;
  }

  const program = ast as unknown as ESTree.Program;

  // Build scope tree for variable resolution.
  const scopeManager = analyze(program, {
    ecmaVersion: 2022,
    sourceType: "script",
  });

  // Walk the AST looking for {apiKey: <Identifier>, appId: <Identifier>}.
  let result: AlgoliaCredentials | null = null;

  ancestor(ast, {
    ObjectExpression(
      node: acorn.Node,
      _state: unknown,
      ancestors: acorn.Node[]
    ) {
      if (result) return;

      const objExpr = node as unknown as ESTree.ObjectExpression;
      let apiKeyIdent: string | null = null;
      let appIdIdent: string | null = null;

      for (const prop of objExpr.properties) {
        if (prop.type !== "Property") continue;
        if (prop.key.type !== "Identifier") continue;

        if (prop.key.name === "apiKey" && prop.value.type === "Identifier") {
          apiKeyIdent = prop.value.name;
        }
        if (prop.key.name === "appId" && prop.value.type === "Identifier") {
          appIdIdent = prop.value.name;
        }
      }

      if (!apiKeyIdent || !appIdIdent) return;

      // Find the enclosing scope by walking up the ancestor chain for a
      // scope-creating node (function or program).
      let scope = null;
      for (let i = ancestors.length - 1; i >= 0; i--) {
        scope = scopeManager.acquire(ancestors[i] as unknown as ESTree.Node);
        if (scope) break;
      }
      if (!scope) return;

      // Resolve each variable name to its string literal value.
      const apiKey = resolveStringLiteral(scope, apiKeyIdent);
      const appId = resolveStringLiteral(scope, appIdIdent);

      if (
        apiKey &&
        appId &&
        API_KEY_PATTERN.test(apiKey) &&
        APP_ID_PATTERN.test(appId)
      ) {
        result = { apiKey, appId };
      }
    },
  });

  scopeManager.detach();

  return result;
}

/**
 * Resolve a variable name to its string literal value within a scope,
 * walking up to parent scopes if needed.
 */
function resolveStringLiteral(
  scope: { set: Map<string, { defs: Array<{ type: string; node: ESTree.Node }> }>; upper: typeof scope | null },
  name: string
): string | null {
  let current: typeof scope | null = scope;
  while (current) {
    const variable = current.set.get(name);
    if (variable) {
      for (const def of variable.defs) {
        if (def.type === "Variable") {
          const declarator = def.node as ESTree.VariableDeclarator;
          if (
            declarator.init &&
            declarator.init.type === "Literal" &&
            typeof declarator.init.value === "string"
          ) {
            return declarator.init.value;
          }
        }
      }
    }
    current = current.upper;
  }
  return null;
}

/**
 * Extract Algolia credentials by fetching the Wegmans website, identifying
 * Next.js JavaScript chunks, and parsing them to find the API key and app ID.
 *
 * Fetches all chunks in parallel and aborts remaining requests as soon as
 * credentials are found.
 */
export async function extractAlgoliaKey(
  options: {
    timeout?: number;
  } = {}
): Promise<KeyExtractionResult> {
  const { timeout = 60000 } = options;

  try {
    // Step 1: Fetch homepage HTML.
    const htmlResponse = await fetch(WEGMANS_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeout),
    });
    if (!htmlResponse.ok) {
      return {
        success: false,
        apiKey: null,
        appId: null,
        storeNumber: null,
        error: `Homepage fetch failed with status ${htmlResponse.status}`,
      };
    }

    const html = await htmlResponse.text();
    const chunkUrls = parseChunkUrls(html, WEGMANS_URL);

    if (chunkUrls.length === 0) {
      return {
        success: false,
        apiKey: null,
        appId: null,
        storeNumber: null,
        error: "No Next.js chunk URLs found in homepage HTML",
      };
    }

    // Step 2: Fetch all chunks in parallel, abort on first success.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const credentials = await Promise.any(
        chunkUrls.map(async (url) => {
          const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const text = await response.text();

          // Quick filter: skip chunks that don't contain the anchor pattern.
          if (!text.includes("{apiKey:")) {
            throw new Error("No apiKey pattern in chunk");
          }

          const creds = extractCredentialsFromJs(text);
          if (!creds) {
            throw new Error("AST extraction failed for chunk");
          }

          // Found it — abort all other in-flight fetches.
          controller.abort();
          return creds;
        })
      );

      return {
        success: true,
        apiKey: credentials.apiKey,
        appId: credentials.appId,
        storeNumber: null,
      };
    } catch (err) {
      if (err instanceof AggregateError) {
        return {
          success: false,
          apiKey: null,
          appId: null,
          storeNumber: null,
          error: `Algolia credentials not found in any of ${chunkUrls.length} JavaScript chunks. The website structure may have changed.`,
        };
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      apiKey: null,
      appId: null,
      storeNumber: null,
      error: message,
    };
  }
}
