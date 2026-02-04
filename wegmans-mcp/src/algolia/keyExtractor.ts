/**
 * Algolia API key extraction from Wegmans website.
 *
 * The API key is a public search-only key that Wegmans exposes in
 * their client-side Algolia requests. This module provides functions
 * to extract the key by intercepting network requests.
 */

import { chromium, type Browser } from "playwright";

export interface KeyExtractionResult {
  success: boolean;
  apiKey: string | null;
  appId: string | null;
  storeNumber: string | null;
  error?: string;
}

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
 * Extract store number from Algolia request URL or filter string.
 */
function parseStoreNumberFromRequest(
  url: string,
  postData?: string
): string | null {
  // Try extracting from post data filter string
  if (postData) {
    const match = postData.match(/storeNumber[:\s]*(\d+)/);
    if (match?.[1]) {
      return match[1];
    }
  }

  // Try extracting from URL analytics tags
  const storeMatch = url.match(/store-(\d+)/);
  if (storeMatch?.[1]) {
    return storeMatch[1];
  }

  return null;
}

/**
 * Extract Algolia credentials by loading the Wegmans website and
 * intercepting Algolia API requests.
 *
 * @param options - Configuration options
 * @returns Extraction result with API key, app ID, and store number
 */
export async function extractAlgoliaKey(
  options: {
    headless?: boolean;
    timeout?: number;
  } = {}
): Promise<KeyExtractionResult> {
  const { headless = true, timeout = 60000 } = options;

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    let apiKey: string | null = null;
    let appId: string | null = null;
    let storeNumber: string | null = null;

    // Intercept Algolia requests
    await page.route("**/*algolia*/**", async (route) => {
      const request = route.request();
      const url = request.url();

      // Extract credentials from URL
      const extractedKey = parseAlgoliaKeyFromUrl(url);
      if (extractedKey && !apiKey) {
        apiKey = extractedKey;
      }

      const extractedAppId = parseAlgoliaAppIdFromUrl(url);
      if (extractedAppId && !appId) {
        appId = extractedAppId;
      }

      // Extract store number from request
      const postData = request.postData() ?? undefined;
      const extractedStore = parseStoreNumberFromRequest(url, postData);
      if (extractedStore && !storeNumber) {
        storeNumber = extractedStore;
      }

      await route.continue();
    });

    // Navigate to Wegmans and trigger a search to capture Algolia requests
    await page.goto("https://www.wegmans.com", {
      waitUntil: "domcontentloaded",
      timeout,
    });

    // Wait a bit for initial page load
    await page.waitForTimeout(2000);

    // Navigate to search page to trigger Algolia queries
    await page.goto("https://www.wegmans.com/shop/search?query=milk", {
      waitUntil: "domcontentloaded",
      timeout,
    });

    // Wait for Algolia requests to complete
    await page.waitForTimeout(5000);

    await browser.close();
    browser = null;

    if (!apiKey) {
      return {
        success: false,
        apiKey: null,
        appId,
        storeNumber,
        error: "Failed to capture Algolia API key from requests",
      };
    }

    return {
      success: true,
      apiKey,
      appId,
      storeNumber,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      apiKey: null,
      appId: null,
      storeNumber: null,
      error: message,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
