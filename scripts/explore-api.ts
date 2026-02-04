/**
 * API Exploration Script
 *
 * This script:
 * 1. Launches a browser to wegmans.com
 * 2. Intercepts Algolia API requests to capture:
 *    - API key (from x-algolia-api-key header)
 *    - Index name format
 *    - Store number
 * 3. Makes a test search query
 * 4. Saves raw response to snapshots/ for analysis
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "snapshots");
const WEGMANS_URL = "https://www.wegmans.com";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string | undefined;
}

interface CapturedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface ExplorationResults {
  timestamp: string;
  apiKey: string | null;
  appId: string | null;
  storeNumber: string | null;
  indexNames: string[];
  requests: CapturedRequest[];
  responses: CapturedResponse[];
  errors: string[];
}

async function explore(): Promise<void> {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const results: ExplorationResults = {
    timestamp: new Date().toISOString(),
    apiKey: null,
    appId: null,
    storeNumber: null,
    indexNames: [],
    requests: [],
    responses: [],
    errors: [],
  };

  console.log("Starting Wegmans API exploration...\n");

  const browser = await chromium.launch({ headless: false }); // visible for debugging
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  const page = await context.newPage();

  // Intercept ALL requests to algolia
  await page.route("**/*algolia*/**", async (route) => {
    const request = route.request();
    const headers = request.headers();
    const url = request.url();

    // Capture request details
    const capturedReq: CapturedRequest = {
      url,
      method: request.method(),
      headers,
      postData: request.postData() ?? undefined,
    };
    results.requests.push(capturedReq);

    // Extract API key
    const apiKey = headers["x-algolia-api-key"];
    if (apiKey && !results.apiKey) {
      results.apiKey = apiKey;
      console.log(`[OK] Captured API key: ${apiKey.substring(0, 10)}...`);
    }

    // Extract App ID
    const appId = headers["x-algolia-application-id"];
    if (appId && !results.appId) {
      results.appId = appId;
      console.log(`[OK] Captured App ID: ${appId}`);
    }

    // Extract index names from URL or POST body
    const indexMatch = url.match(/indexes\/([^/]+)/);
    if (indexMatch?.[1] && !results.indexNames.includes(indexMatch[1])) {
      results.indexNames.push(indexMatch[1]);
      console.log(`[OK] Found index: ${indexMatch[1]}`);
    }

    // Extract store number from index name
    const storeMatch = url.match(/products[_-]?(\d+)/i);
    if (storeMatch?.[1] && !results.storeNumber) {
      results.storeNumber = storeMatch[1];
      console.log(`[OK] Found store number: ${storeMatch[1]}`);
    }

    // Continue request and capture response
    try {
      const response = await route.fetch();
      const body = await response.json().catch(() => null);

      const capturedResp: CapturedResponse = {
        url,
        status: response.status(),
        headers: response.headers(),
        body,
      };
      results.responses.push(capturedResp);

      await route.fulfill({ response });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.errors.push(`Request error: ${message}`);
      await route.continue();
    }
  });

  try {
    // Navigate to Wegmans
    console.log("\n[NAV] Navigating to Wegmans...");
    await page.goto(WEGMANS_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Try to trigger store selection (may vary by session)
    console.log("\n[STORE] Looking for store selector...");
    const storeButton = await page.$('[class*="store"], [data-testid*="store"]');
    if (storeButton) {
      console.log("   Found store selector, clicking...");
      await storeButton.click();
      await page.waitForTimeout(2000);
    }

    // Navigate to search to trigger Algolia
    console.log("\n[SEARCH] Triggering search...");
    await page.goto(`${WEGMANS_URL}/shop/search?query=milk`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

    // Try another search to capture more data
    console.log("\n[SEARCH] Second search...");
    await page.goto(`${WEGMANS_URL}/shop/search?query=yogurt`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.errors.push(`Navigation error: ${message}`);
    console.error(`[ERROR] ${message}`);
  }

  await browser.close();

  // Save results
  const summaryPath = join(SNAPSHOTS_DIR, "exploration-summary.json");
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\n[FILE] Summary saved to: ${summaryPath}`);

  // Save each response separately for detailed analysis
  for (let i = 0; i < results.responses.length; i++) {
    const resp = results.responses[i];
    if (resp?.body) {
      const filename = `response-${i}-${resp.status}.json`;
      const filepath = join(SNAPSHOTS_DIR, filename);
      writeFileSync(filepath, JSON.stringify(resp.body, null, 2));
      console.log(`[FILE] Response saved to: ${filename}`);
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("EXPLORATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`API Key:      ${results.apiKey ? "[OK] Captured" : "[MISSING] Not found"}`);
  console.log(`App ID:       ${results.appId ?? "Not found"}`);
  console.log(`Store Number: ${results.storeNumber ?? "Not found"}`);
  console.log(`Index Names:  ${results.indexNames.join(", ") || "None found"}`);
  console.log(`Requests:     ${results.requests.length}`);
  console.log(`Responses:    ${results.responses.length}`);
  console.log(`Errors:       ${results.errors.length}`);
  console.log("=".repeat(60));

  if (results.errors.length > 0) {
    console.log("\n[WARN] Errors encountered:");
    for (const err of results.errors) {
      console.log(`   - ${err}`);
    }
  }

  console.log("\n[NEXT] Next steps:");
  console.log("   1. Review snapshots/exploration-summary.json");
  console.log("   2. Review snapshots/response-*.json for actual schema");
  console.log("   3. Update design doc with findings");
  console.log("   4. Proceed to Phase 1: Schema Design");
}

explore().catch(console.error);
