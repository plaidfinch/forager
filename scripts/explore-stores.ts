/**
 * Store Discovery Script
 *
 * Explores Wegmans /stores page to capture:
 * - Store number → name/location mapping
 * - How store selection works
 * - Any store-related API endpoints
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "snapshots");

interface StoreInfo {
  storeNumber?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  raw?: unknown;
}

interface StoreExplorationResults {
  timestamp: string;
  stores: StoreInfo[];
  apiEndpoints: string[];
  rawResponses: unknown[];
  errors: string[];
}

async function exploreStores(): Promise<void> {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const results: StoreExplorationResults = {
    timestamp: new Date().toISOString(),
    stores: [],
    apiEndpoints: [],
    rawResponses: [],
    errors: [],
  };

  console.log("🏪 Starting Wegmans store discovery...\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  const page = await context.newPage();

  // Intercept any API calls related to stores
  await page.route("**/*", async (route) => {
    const url = route.request().url();

    // Look for store-related API calls
    if (url.includes("store") || url.includes("location")) {
      console.log(`📡 Intercepted: ${url}`);
      results.apiEndpoints.push(url);

      try {
        const response = await route.fetch();
        const contentType = response.headers()["content-type"] || "";

        if (contentType.includes("json")) {
          const body = await response.json();
          results.rawResponses.push({ url, body });
          console.log(`   JSON response captured`);
        }

        await route.fulfill({ response });
      } catch {
        await route.continue();
      }
    } else {
      await route.continue();
    }
  });

  try {
    // Navigate to stores page
    console.log("📍 Navigating to /stores...");
    await page.goto("https://www.wegmans.com/stores", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Try to find store information in the page
    console.log("\n🔍 Looking for store data in page...");

    // Look for store cards/list items
    const storeElements = await page.$$('[class*="store"], [data-testid*="store"], [class*="location"]');
    console.log(`   Found ${storeElements.length} potential store elements`);

    // Try to extract store data from page content
    const pageContent = await page.content();

    // Look for JSON data embedded in page (common pattern)
    const jsonMatches = pageContent.match(/__NEXT_DATA__[^>]*>([^<]+)</);
    if (jsonMatches?.[1]) {
      try {
        const nextData = JSON.parse(jsonMatches[1]);
        results.rawResponses.push({ source: "__NEXT_DATA__", body: nextData });
        console.log("   Found __NEXT_DATA__ JSON");
      } catch {
        console.log("   Failed to parse __NEXT_DATA__");
      }
    }

    // Search for "Geneva" specifically
    console.log("\n🔍 Searching for Geneva, NY...");
    const searchInput = await page.$('input[type="search"], input[placeholder*="search"], input[placeholder*="zip"]');
    if (searchInput) {
      await searchInput.fill("Geneva, NY");
      await page.waitForTimeout(2000);

      // Look for search results
      const afterSearchContent = await page.content();
      if (afterSearchContent.includes("Geneva") || afterSearchContent.includes("14456")) {
        console.log("   Found Geneva in results");
      }
    }

    // Try clicking on store selector if visible
    console.log("\n🔍 Looking for store selector...");
    const storeSelector = await page.$('button[class*="store"], [data-testid*="store-selector"], [aria-label*="store"]');
    if (storeSelector) {
      console.log("   Found store selector, clicking...");
      await storeSelector.click();
      await page.waitForTimeout(2000);
    }

    // Screenshot for manual review
    await page.screenshot({ path: join(SNAPSHOTS_DIR, "stores-page.png"), fullPage: true });
    console.log("\n📸 Screenshot saved to stores-page.png");

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.errors.push(`Navigation error: ${message}`);
    console.error(`❌ Error: ${message}`);
  }

  await browser.close();

  // Save results
  const outputPath = join(SNAPSHOTS_DIR, "stores-exploration.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to: ${outputPath}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("STORE EXPLORATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`API Endpoints Found: ${results.apiEndpoints.length}`);
  console.log(`Raw Responses: ${results.rawResponses.length}`);
  console.log(`Stores Found: ${results.stores.length}`);
  console.log(`Errors: ${results.errors.length}`);
  console.log("=".repeat(60));

  console.log("\n📋 Next steps:");
  console.log("   1. Review snapshots/stores-exploration.json");
  console.log("   2. Review snapshots/stores-page.png");
  console.log("   3. Look for Geneva, NY store number");
}

exploreStores().catch(console.error);
