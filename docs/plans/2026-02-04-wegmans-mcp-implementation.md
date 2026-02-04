# Wegmans MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that provides Claude with queryable access to Wegmans product data (prices, aisles, nutrition) via a local SQLite mirror populated from Algolia.

**Architecture:** TypeScript MCP server using `@modelcontextprotocol/sdk`. Direct HTTP queries to Algolia API with Playwright-based key extraction fallback. Normalized SQLite schema with `better-sqlite3`.

**Tech Stack:** TypeScript (strict), MCP SDK, Playwright, better-sqlite3, zod, vitest

---

## Dependency DAG & Uncertainty Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 0: EMPIRICAL INVESTIGATION (must complete before schema design)      │
│  ═══════════════════════════════════════════════════════════════════════════│
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐                         │
│  │ Minimal scaffolding │───▶│  Key extraction     │                         │
│  │ (just enough to run)│    │  probe              │                         │
│  └─────────────────────┘    └──────────┬──────────┘                         │
│                                        │                                     │
│                                        ▼                                     │
│                             ┌─────────────────────┐                         │
│                             │  Raw Algolia query  │                         │
│                             │  + response capture │                         │
│                             └──────────┬──────────┘                         │
│                                        │                                     │
│                                        ▼                                     │
│                             ┌─────────────────────┐                         │
│                             │ CHECKPOINT: Review  │                         │
│                             │ actual response     │                         │
│                             │ structure           │                         │
│                             └──────────┬──────────┘                         │
│                                        │                                     │
│  Resolves:                             │                                     │
│    - Algolia API key extraction method │                                     │
│    - Actual response schema            │                                     │
│    - Index name format                 │                                     │
│    - Store number discovery            │                                     │
└────────────────────────────────────────┼─────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: SCHEMA DESIGN (based on empirical findings)                       │
│  ═══════════════════════════════════════════════════════════════════════════│
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │ Zod schemas from    │────────▶│ Snapshot tests for  │                    │
│  │ observed response   │         │ schema validation   │                    │
│  └─────────────────────┘         └─────────────────────┘                    │
│            │                                                                 │
│            ▼                                                                 │
│  ┌─────────────────────┐                                                    │
│  │ Database schema     │                                                    │
│  │ (normalized from    │                                                    │
│  │  actual fields)     │                                                    │
│  └─────────────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: DATABASE LAYER (unit tested in isolation)                         │
│  ═══════════════════════════════════════════════════════════════════════════│
│                                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ schema.ts  │  │ stores.ts  │  │products.ts │  │ queries.ts │            │
│  │ + unit test│  │ + unit test│  │ + unit test│  │ + unit test│            │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘            │
│        │               │               │               │                    │
│        └───────────────┴───────────────┴───────────────┘                    │
│                                │                                             │
│                                ▼                                             │
│                     ┌─────────────────────┐                                 │
│                     │ Property tests for  │                                 │
│                     │ DB invariants       │                                 │
│                     └─────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: ALGOLIA CLIENT (integration tested against real API)              │
│  ═══════════════════════════════════════════════════════════════════════════│
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │ keyExtractor.ts     │         │ client.ts           │                    │
│  │ + integration test  │────────▶│ + snapshot tests    │                    │
│  │   (real browser)    │         │   (real responses)  │                    │
│  └─────────────────────┘         └─────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: MCP TOOLS (unit + integration tested)                             │
│  ═══════════════════════════════════════════════════════════════════════════│
│                                                                              │
│  Design: Raw SQL for max flexibility. Claude composes queries.              │
│                                                                              │
│  DB-only tools:                        Algolia-dependent tools:             │
│  ┌──────────┐ ┌──────────┐            ┌──────────┐ ┌───────────────┐       │
│  │ query    │ │ schema   │            │ search   │ │ refreshApiKey │       │
│  └──────────┘ └──────────┘            └──────────┘ └───────────────┘       │
│                                                                              │
│  query(sql) → {columns, rows}          search(term, store) → populates DB   │
│  schema() → table DDL                  refreshApiKey() → extracts new key   │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: MCP SERVER + END-TO-END TESTING                                   │
│  ═══════════════════════════════════════════════════════════════════════════│
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │ index.ts            │────────▶│ E2E tests via MCP   │                    │
│  │ (server entry)      │         │ protocol            │                    │
│  └─────────────────────┘         └─────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Testing Strategy by Phase

| Phase | Testing Method | Purpose |
|-------|---------------|---------|
| 0: Investigation | Interactive exploration | Discover ground truth |
| 0: Investigation | Response capture → snapshot | Lock in observed schema |
| 1: Schema Design | Snapshot tests | Validate Zod schemas parse real data |
| 2: Database | Unit tests (in-memory SQLite) | Verify CRUD operations |
| 2: Database | Property tests | Verify invariants (e.g., upsert idempotence) |
| 3: Algolia Client | Integration tests (real API) | Verify extraction & parsing |
| 3: Algolia Client | Snapshot tests | Detect API changes |
| 4: MCP Tools | Unit tests (mocked Algolia) | Verify query/schema/search logic |
| 4: MCP Tools | Integration tests (real Algolia) | Verify search populates DB correctly |
| 5: Server | E2E tests | Verify full MCP protocol flow |

---

# Phase 0: Empirical Investigation

**Purpose:** Discover ground truth about Algolia API before committing to schema design.

**Documentation Requirements:** Keep detailed file-based notes in `wegmans-mcp/snapshots/` about everything discovered through exploration. Notes must:
- Record only direct observations, not speculation
- Provide clear justification for any inferences drawn from observations
- Include raw captured data as evidence
- Be organized so we can reference them later during implementation

Files to maintain:
- `snapshots/FINDINGS.md` - Human-readable summary of discoveries
- `snapshots/exploration-summary.json` - Structured capture of API key, store number, etc.
- `snapshots/response-*.json` - Raw Algolia responses (evidence)
- `snapshots/SCHEMA-ANALYSIS.md` - Field-by-field analysis of response structure

## Task 0.1: Minimal Project Scaffolding

**Files:**
- Create: `wegmans-mcp/package.json`
- Create: `wegmans-mcp/tsconfig.json`

**Step 1: Create project with minimal dependencies**

```bash
mkdir -p wegmans-mcp && cd wegmans-mcp
npm init -y
```

**Step 2: Update package.json**

```json
{
  "name": "wegmans-mcp",
  "version": "0.1.0",
  "description": "MCP server for querying Wegmans product data",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "explore": "npx tsx scripts/explore-api.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "moduleResolution": "NodeNext",
    "module": "NodeNext",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Install minimal dependencies for exploration**

```bash
npm install playwright typescript
npm install --save-dev @types/node tsx vitest
npx playwright install chromium
```

**Step 5: Create directory structure**

```bash
mkdir -p src scripts snapshots
```

**Step 6: Commit**

```bash
git add wegmans-mcp/
git commit -m "feat: minimal scaffolding for API exploration"
```

---

## Task 0.2: Implement API Exploration Script

**Files:**
- Create: `wegmans-mcp/scripts/explore-api.ts`

**Purpose:** Extract Algolia API key, make a test query, capture raw response for analysis.

**Step 1: Create exploration script**

```typescript
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
  postData?: string;
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

  console.log("🚀 Starting Wegmans API exploration...\n");

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
      console.log(`✅ Captured API key: ${apiKey.substring(0, 10)}...`);
    }

    // Extract App ID
    const appId = headers["x-algolia-application-id"];
    if (appId && !results.appId) {
      results.appId = appId;
      console.log(`✅ Captured App ID: ${appId}`);
    }

    // Extract index names from URL or POST body
    const indexMatch = url.match(/indexes\/([^/]+)/);
    if (indexMatch?.[1] && !results.indexNames.includes(indexMatch[1])) {
      results.indexNames.push(indexMatch[1]);
      console.log(`✅ Found index: ${indexMatch[1]}`);
    }

    // Extract store number from index name
    const storeMatch = url.match(/products[_-]?(\d+)/i);
    if (storeMatch?.[1] && !results.storeNumber) {
      results.storeNumber = storeMatch[1];
      console.log(`✅ Found store number: ${storeMatch[1]}`);
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
    console.log("\n📍 Navigating to Wegmans...");
    await page.goto(WEGMANS_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Try to trigger store selection (may vary by session)
    console.log("\n🏪 Looking for store selector...");
    const storeButton = await page.$('[class*="store"], [data-testid*="store"]');
    if (storeButton) {
      console.log("   Found store selector, clicking...");
      await storeButton.click();
      await page.waitForTimeout(2000);
    }

    // Navigate to search to trigger Algolia
    console.log("\n🔍 Triggering search...");
    await page.goto(`${WEGMANS_URL}/shop/search?query=milk`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

    // Try another search to capture more data
    console.log("\n🔍 Second search...");
    await page.goto(`${WEGMANS_URL}/shop/search?query=yogurt`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(5000);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.errors.push(`Navigation error: ${message}`);
    console.error(`❌ Error: ${message}`);
  }

  await browser.close();

  // Save results
  const summaryPath = join(SNAPSHOTS_DIR, "exploration-summary.json");
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Summary saved to: ${summaryPath}`);

  // Save each response separately for detailed analysis
  for (let i = 0; i < results.responses.length; i++) {
    const resp = results.responses[i];
    if (resp?.body) {
      const filename = `response-${i}-${resp.status}.json`;
      const filepath = join(SNAPSHOTS_DIR, filename);
      writeFileSync(filepath, JSON.stringify(resp.body, null, 2));
      console.log(`📄 Response saved to: ${filename}`);
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("EXPLORATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`API Key:      ${results.apiKey ? "✅ Captured" : "❌ Not found"}`);
  console.log(`App ID:       ${results.appId ?? "Not found"}`);
  console.log(`Store Number: ${results.storeNumber ?? "Not found"}`);
  console.log(`Index Names:  ${results.indexNames.join(", ") || "None found"}`);
  console.log(`Requests:     ${results.requests.length}`);
  console.log(`Responses:    ${results.responses.length}`);
  console.log(`Errors:       ${results.errors.length}`);
  console.log("=".repeat(60));

  if (results.errors.length > 0) {
    console.log("\n⚠️  Errors encountered:");
    for (const err of results.errors) {
      console.log(`   - ${err}`);
    }
  }

  console.log("\n📋 Next steps:");
  console.log("   1. Review snapshots/exploration-summary.json");
  console.log("   2. Review snapshots/response-*.json for actual schema");
  console.log("   3. Update design doc with findings");
  console.log("   4. Proceed to Phase 1: Schema Design");
}

explore().catch(console.error);
```

**Step 2: Commit**

```bash
git add wegmans-mcp/scripts/explore-api.ts
git commit -m "feat: add API exploration script"
```

---

## Task 0.3: Run Exploration and Capture Results

**Step 1: Run the exploration script**

```bash
cd wegmans-mcp && npm run explore
```

**Step 2: Review captured data**

Examine:
- `snapshots/exploration-summary.json` - API key, store number, index names
- `snapshots/response-*.json` - Raw Algolia response structure

**Step 3: Document findings rigorously**

Create `snapshots/FINDINGS.md` with:

```markdown
# Wegmans Algolia API Exploration Findings

Date: YYYY-MM-DD
Exploration script version: (git hash)

## Direct Observations

### API Key Extraction
- Observed: (exactly what happened)
- Evidence: (file reference, e.g., exploration-summary.json line X)
- Conclusion: (inference with justification)

### Index Name Format
- Observed: (exactly what index names were captured)
- Evidence: (file reference)
- Conclusion: (inference with justification)

### Store Number Discovery
- Observed: (how store number appeared in data)
- Evidence: (file reference)
- Conclusion: (inference with justification)

### Response Schema
- Observed: (list of top-level fields)
- Evidence: (response-0-200.json)
- Notable differences from reference repo: (list with evidence)

## Inferences (with justification)

Each inference must cite specific observations above.

## Open Questions

Things we still don't know and how we might find out.
```

Create `snapshots/SCHEMA-ANALYSIS.md` with field-by-field analysis:

```markdown
# Algolia Response Schema Analysis

## Top-level structure
- Field: `results` - Type: array - Evidence: response-0-200.json
  - Observed in all N captured responses

## Hit fields (per product)
For each field, document:
- Field name (exact)
- Type observed
- Example value(s)
- Present in all responses? (Y/N/partial)
- Equivalent in reference repo (if different)
```

**CHECKPOINT: Do not proceed until findings are documented with evidence.**

---

## Task 0.4: Create Schema Snapshot Tests

**Purpose:** Lock in the observed schema so we detect if Wegmans changes their API.

**Files:**
- Create: `wegmans-mcp/tests/snapshots/algolia-response.test.ts`

**Step 1: Create snapshot test from real response**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots");

describe("Algolia Response Schema", () => {
  it("matches captured response structure", () => {
    // Load the first captured response
    const responsePath = join(SNAPSHOTS_DIR, "response-0-200.json");
    const response = JSON.parse(readFileSync(responsePath, "utf-8"));

    // Snapshot the structure (keys only, not values)
    const structure = extractStructure(response);
    expect(structure).toMatchSnapshot();
  });

  it("contains expected top-level fields", () => {
    const responsePath = join(SNAPSHOTS_DIR, "response-0-200.json");
    const response = JSON.parse(readFileSync(responsePath, "utf-8"));

    // Verify structure based on exploration findings
    // These assertions will be updated based on actual findings
    expect(response).toHaveProperty("results");
    expect(Array.isArray(response.results)).toBe(true);
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
```

**Step 2: Run to generate initial snapshot**

```bash
npm test -- --update
```

**Step 3: Commit**

```bash
git add wegmans-mcp/tests/
git commit -m "test: add schema snapshot tests from exploration"
```

---

# Phase 1: Schema Design (Based on Empirical Findings)

> ⚠️ **TENTATIVE**: The schemas below are based on the reference repo.
> They MUST be updated based on Phase 0 exploration findings before implementation.

## Task 1.1: Define Zod Schemas for Algolia Response

**Files:**
- Create: `wegmans-mcp/src/types/algolia.ts`
- Create: `wegmans-mcp/tests/types/algolia.test.ts`

**Step 1: Write test that validates schema against real captured response**

Create `tests/types/algolia.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AlgoliaResponseSchema } from "../../src/types/algolia.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots");

describe("Algolia Zod Schema", () => {
  it("successfully parses all captured responses", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith(".json")
    );

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const path = join(SNAPSHOTS_DIR, file);
      const raw = JSON.parse(readFileSync(path, "utf-8"));

      const result = AlgoliaResponseSchema.safeParse(raw);

      if (!result.success) {
        console.error(`Failed to parse ${file}:`, result.error.format());
      }

      expect(result.success, `Schema should parse ${file}`).toBe(true);
    }
  });

  it("extracts product data from parsed response", () => {
    const files = readdirSync(SNAPSHOTS_DIR).filter(
      (f) => f.startsWith("response-") && f.endsWith(".json")
    );

    const path = join(SNAPSHOTS_DIR, files[0]!);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const result = AlgoliaResponseSchema.parse(raw);

    // Verify we can access expected fields
    const firstHit = result.results[0]?.hits[0];
    expect(firstHit).toBeDefined();

    // Log actual fields for schema refinement
    if (firstHit) {
      console.log("Available fields in hit:", Object.keys(firstHit));
    }
  });
});
```

**Step 2: Run test to verify it fails (schema doesn't exist yet)**

```bash
npm test
```

Expected: FAIL - module not found

**Step 3: Create Algolia schema based on exploration findings**

> ⚠️ The schema below is TENTATIVE. Update based on Phase 0 findings.

Create `src/types/algolia.ts`:

```typescript
import { z } from "zod";

// TENTATIVE: Based on reference repo, update after exploration
// Use .passthrough() to allow unknown fields during development

export const AlgoliaPriceSchema = z
  .object({
    amount: z.number().optional(),
    unitPrice: z.string().optional(),
    channelKey: z.string().optional(),
  })
  .passthrough();

export const AlgoliaPlanogramSchema = z
  .object({
    aisle: z.string().optional(),
  })
  .passthrough();

export const AlgoliaNutritionItemSchema = z
  .object({
    name: z.string(),
    quantity: z.number().optional(),
    unitOfMeasure: z.string().optional(),
    percentOfDaily: z.number().optional(),
  })
  .passthrough();

export const AlgoliaServingSchema = z
  .object({
    servingSize: z.string().optional(),
    servingSizeUom: z.string().optional(),
    servingsPerContainer: z.string().optional(),
  })
  .passthrough();

export const AlgoliaNutritionSchema = z
  .object({
    serving: AlgoliaServingSchema.optional(),
    nutritions: z
      .array(
        z.object({
          general: z.array(AlgoliaNutritionItemSchema).optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export const AlgoliaHitSchema = z
  .object({
    // Identity - TENTATIVE field names
    productId: z.string().optional(),
    productID: z.string().optional(),

    // Basic info - TENTATIVE
    productName: z.string().optional(),
    consumerBrandName: z.string().optional(),
    productDescription: z.string().optional(),
    webProductDescription: z.string().optional(),
    packSize: z.string().optional(),
    images: z.array(z.string()).optional(),
    ingredients: z.string().optional(),
    allergensAndWarnings: z.string().optional(),
    isSoldByWeight: z.boolean().optional(),
    storeNumber: z.string().optional(),

    // Pricing - TENTATIVE
    price_inStore: AlgoliaPriceSchema.optional(),
    price_delivery: AlgoliaPriceSchema.optional(),

    // Location - TENTATIVE
    planogram: AlgoliaPlanogramSchema.optional(),

    // Nutrition - TENTATIVE
    nutrition: AlgoliaNutritionSchema.optional(),

    // Categories - TENTATIVE
    filterTags: z.array(z.string()).optional(),
    popularTags: z.array(z.string()).optional(),
    categoryNodes: z
      .object({
        lvl0: z.string().optional(),
        lvl1: z.string().optional(),
        lvl2: z.string().optional(),
        lvl3: z.string().optional(),
      })
      .optional(),
  })
  .passthrough(); // Allow unknown fields

export type AlgoliaHit = z.infer<typeof AlgoliaHitSchema>;

export const AlgoliaResultSchema = z
  .object({
    hits: z.array(AlgoliaHitSchema),
    nbHits: z.number().optional(),
    query: z.string().optional(),
    index: z.string().optional(),
  })
  .passthrough();

export const AlgoliaResponseSchema = z.object({
  results: z.array(AlgoliaResultSchema),
});

export type AlgoliaResponse = z.infer<typeof AlgoliaResponseSchema>;
```

**Step 4: Run test to verify schema parses real data**

```bash
npm test
```

Expected: PASS if schema matches exploration findings, FAIL if not (iterate)

**Step 5: Commit**

```bash
git add wegmans-mcp/src/types/algolia.ts wegmans-mcp/tests/types/algolia.test.ts
git commit -m "feat: add Algolia response schema (validated against real data)"
```

---

## Task 1.2: Define Product Domain Types

**Files:**
- Create: `wegmans-mcp/src/types/product.ts`

> ⚠️ **TENTATIVE**: Update based on what fields are actually available in Algolia response.

**Step 1: Create product types**

```typescript
import { z } from "zod";

export const StoreSchema = z.object({
  storeNumber: z.string(),
  location: z.string(),
  lastUpdated: z.string().optional(),
});

export type Store = z.infer<typeof StoreSchema>;

// TENTATIVE: Fields depend on what Algolia actually returns
export const ProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  packSize: z.string().nullable(),
  imageUrl: z.string().nullable(),
  ingredients: z.string().nullable(),
  allergens: z.string().nullable(),
  isSoldByWeight: z.boolean(),
});

export type Product = z.infer<typeof ProductSchema>;

export const StoreProductSchema = z.object({
  productId: z.string(),
  storeNumber: z.string(),
  price: z.number().nullable(),
  unitPrice: z.string().nullable(),
  aisle: z.string().nullable(),
});

export type StoreProduct = z.infer<typeof StoreProductSchema>;

export const NutritionFactSchema = z.object({
  productId: z.string(),
  nutrient: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  percentDaily: z.number().nullable(),
});

export type NutritionFact = z.infer<typeof NutritionFactSchema>;

export const ServingSchema = z.object({
  productId: z.string(),
  servingSize: z.number().nullable(),
  servingSizeUnit: z.string().nullable(),
  servingsPerContainer: z.string().nullable(),
});

export type Serving = z.infer<typeof ServingSchema>;

export const CategorySchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  parentId: z.number().nullable(),
  level: z.number(),
});

export type Category = z.infer<typeof CategorySchema>;

export const SearchRecordSchema = z.object({
  id: z.number().optional(),
  storeNumber: z.string(),
  query: z.string().nullable(),
  categoryFilter: z.string().nullable(),
  resultCount: z.number(),
  lastRun: z.string().optional(),
});

export type SearchRecord = z.infer<typeof SearchRecordSchema>;
```

**Step 2: Verify types compile**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add wegmans-mcp/src/types/product.ts
git commit -m "feat: add product domain types (tentative)"
```

---

# Phase 2: Database Layer

> ⚠️ **TENTATIVE**: Schema may need adjustment based on actual Algolia fields discovered in Phase 0.

## Task 2.1: Create Database Schema

**Files:**
- Create: `wegmans-mcp/src/db/schema.ts`
- Create: `wegmans-mcp/tests/db/schema.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema, SCHEMA_VERSION } from "../../src/db/schema.js";

describe("Database Schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required tables", () => {
    initializeSchema(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();

    expect(tableNames).toContain("api_keys");
    expect(tableNames).toContain("stores");
    expect(tableNames).toContain("searches");
    expect(tableNames).toContain("products");
    expect(tableNames).toContain("store_products");
    expect(tableNames).toContain("servings");
    expect(tableNames).toContain("nutrition_facts");
    expect(tableNames).toContain("categories");
    expect(tableNames).toContain("product_categories");
    expect(tableNames).toContain("tags");
    expect(tableNames).toContain("product_tags");
    expect(tableNames).toContain("search_products");
  });

  it("is idempotent", () => {
    initializeSchema(db);
    initializeSchema(db); // Should not throw

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all();
    expect(tables.length).toBeGreaterThan(0);
  });

  it("exports schema version", () => {
    expect(typeof SCHEMA_VERSION).toBe("number");
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

**Step 3: Implement schema**

See original Phase 2 Task 2.2 for full implementation.

**Step 4: Run test to verify it passes**

```bash
npm test
```

**Step 5: Commit**

```bash
git add wegmans-mcp/src/db/schema.ts wegmans-mcp/tests/db/schema.test.ts
git commit -m "feat: implement database schema"
```

---

## Tasks 2.2-2.5: Remaining Database Layer

See original plan tasks 2.3-2.6 for:
- Database connection manager
- Store CRUD operations
- Product CRUD operations
- Raw SQL query executor

Each follows the same pattern:
1. Write failing test
2. Run test to verify failure
3. Implement minimal code
4. Run test to verify pass
5. Commit

**Property tests to add:**

```typescript
// tests/db/products.property.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertProduct, getProduct } from "../../src/db/products.js";

describe("Product operations (property tests)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("upsert is idempotent", () => {
    fc.assert(
      fc.property(
        fc.record({
          productId: fc.string({ minLength: 1 }),
          name: fc.string({ minLength: 1 }),
          brand: fc.option(fc.string(), { nil: null }),
          // ... other fields
        }),
        (product) => {
          upsertProduct(db, product);
          upsertProduct(db, product);

          const count = db
            .prepare("SELECT COUNT(*) as c FROM products WHERE product_id = ?")
            .get(product.productId) as { c: number };

          expect(count.c).toBe(1);
        }
      )
    );
  });

  it("upsert then get returns same data", () => {
    fc.assert(
      fc.property(
        fc.record({
          productId: fc.string({ minLength: 1, maxLength: 50 }),
          name: fc.string({ minLength: 1, maxLength: 200 }),
          brand: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
          // ... other fields
        }),
        (product) => {
          upsertProduct(db, product);
          const retrieved = getProduct(db, product.productId);

          expect(retrieved?.productId).toBe(product.productId);
          expect(retrieved?.name).toBe(product.name);
          expect(retrieved?.brand).toBe(product.brand);
        }
      )
    );
  });
});
```

---

# Phase 3: Algolia Client

## Task 3.1: Implement Key Extractor with Integration Test

**Files:**
- Create: `wegmans-mcp/src/algolia/keyExtractor.ts`
- Create: `wegmans-mcp/tests/algolia/keyExtractor.integration.test.ts`

**Note:** This is an integration test that runs against the real website.

**Step 1: Create integration test**

```typescript
import { describe, it, expect } from "vitest";
import { extractAlgoliaKey } from "../../src/algolia/keyExtractor.js";

describe("Algolia Key Extractor (integration)", () => {
  it(
    "extracts API key from Wegmans website",
    async () => {
      const result = await extractAlgoliaKey("Geneva, NY");

      expect(result.success).toBe(true);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.length).toBeGreaterThan(10);

      // Log for verification
      console.log("Extracted key prefix:", result.apiKey?.substring(0, 10));
      console.log("Store number:", result.storeNumber);
    },
    { timeout: 60000 } // 60 second timeout for browser operations
  );
});
```

**Step 2: Implement key extractor**

See original Task 3.3 for implementation.

**Step 3: Run integration test**

```bash
npm test -- keyExtractor.integration
```

**Step 4: Commit**

```bash
git add wegmans-mcp/src/algolia/keyExtractor.ts wegmans-mcp/tests/algolia/
git commit -m "feat: implement Algolia key extractor with integration test"
```

---

## Task 3.2: Implement Algolia HTTP Client with Snapshot Tests

**Files:**
- Create: `wegmans-mcp/src/algolia/client.ts`
- Create: `wegmans-mcp/tests/algolia/client.test.ts`

**Step 1: Create tests including snapshot test for response parsing**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAlgoliaRequest,
  parseAlgoliaResponse,
  extractProductFromHit,
} from "../../src/algolia/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "..", "..", "snapshots");

describe("Algolia Client", () => {
  describe("buildAlgoliaRequest", () => {
    it("builds request for keyword search", () => {
      const request = buildAlgoliaRequest({
        query: "yogurt",
        storeNumber: "059",
      });

      expect(request.requests.length).toBeGreaterThan(0);
      expect(request.requests[0]?.query).toBe("yogurt");
    });

    it("builds request for category filter", () => {
      const request = buildAlgoliaRequest({
        storeNumber: "059",
        categoryFilter: "Dairy",
      });

      expect(request.requests[0]?.filters).toContain("Dairy");
    });
  });

  describe("parseAlgoliaResponse", () => {
    it("parses captured response snapshot", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-0-200.json"), "utf-8")
      );

      const result = parseAlgoliaResponse(raw);

      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThan(0);
    });
  });

  describe("extractProductFromHit", () => {
    it("extracts product matching snapshot", () => {
      const raw = JSON.parse(
        readFileSync(join(SNAPSHOTS_DIR, "response-0-200.json"), "utf-8")
      );
      const hit = raw.results[0]?.hits[0];

      if (hit) {
        const product = extractProductFromHit(hit);

        // Snapshot the extraction result
        expect(product).toMatchSnapshot();
      }
    });
  });
});
```

**Step 2: Implement client**

See original Task 3.2 for implementation.

**Step 3: Run tests and update snapshots**

```bash
npm test -- --update
```

**Step 4: Commit**

```bash
git add wegmans-mcp/src/algolia/client.ts wegmans-mcp/tests/algolia/
git commit -m "feat: implement Algolia HTTP client with snapshot tests"
```

---

# Phase 4: MCP Tools

**Design Decision:** Rather than exposing typed tools for each query pattern, we expose a single `query` tool that accepts raw SQL. Claude composes SQL against a known schema, providing maximum flexibility for answering user questions. Domain types remain useful internally (Algolia → normalized storage), but the MCP boundary is "SQL in, rows out."

## Tool Surface

| Tool | Purpose |
|------|---------|
| `query(sql)` | Execute read-only SQL, return raw `{columns, rows}` |
| `search(term, store)` | Trigger Algolia fetch, populate DB, return row count |
| `schema()` | Return table DDL so Claude knows what to query |
| `refreshApiKey()` | Re-extract API key via Playwright if expired |

## Task 4.1: Implement `query` Tool

**Files:**
- Create: `wegmans-mcp/src/tools/query.ts`
- Create: `wegmans-mcp/tests/tools/query.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { queryTool } from "../../src/tools/query.js";

describe("query tool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("executes SELECT and returns columns and rows", () => {
    db.exec(`INSERT INTO stores (store_number, name) VALUES ('74', 'Geneva')`);

    const result = queryTool(db, "SELECT store_number, name FROM stores");

    expect(result.success).toBe(true);
    expect(result.columns).toEqual(["store_number", "name"]);
    expect(result.rows).toEqual([["74", "Geneva"]]);
  });

  it("returns empty rows for no matches", () => {
    const result = queryTool(db, "SELECT * FROM stores WHERE store_number = '999'");

    expect(result.success).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("rejects non-SELECT statements", () => {
    const result = queryTool(db, "DELETE FROM stores");

    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("handles SQL syntax errors gracefully", () => {
    const result = queryTool(db, "SELECTT * FROM stores");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

**Step 2: Implement tool**

```typescript
import type Database from "better-sqlite3";

export interface QueryResult {
  success: boolean;
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  error?: string;
}

/**
 * Execute a read-only SQL query and return results.
 * Uses the readonly database connection for safety.
 */
export function queryTool(
  readonlyDb: Database.Database,
  sql: string
): QueryResult {
  try {
    const stmt = readonlyDb.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];

    if (rows.length === 0) {
      // Get column names from statement even with no rows
      const columns = stmt.columns().map((c) => c.name);
      return {
        success: true,
        columns,
        rows: [],
        rowCount: 0,
      };
    }

    const columns = Object.keys(rows[0]!);
    const rowArrays = rows.map((row) => columns.map((col) => row[col]));

    return {
      success: true,
      columns,
      rows: rowArrays,
      rowCount: rows.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
```

**Step 3: Run tests, commit**

---

## Task 4.2: Implement `schema` Tool

**Files:**
- Create: `wegmans-mcp/src/tools/schema.ts`
- Create: `wegmans-mcp/tests/tools/schema.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { schemaTool } from "../../src/tools/schema.js";

describe("schema tool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns DDL for all tables", () => {
    const result = schemaTool(db);

    expect(result.success).toBe(true);
    expect(result.tables?.length).toBeGreaterThan(0);

    // Verify key tables are present
    const tableNames = result.tables?.map((t) => t.name);
    expect(tableNames).toContain("products");
    expect(tableNames).toContain("store_products");
    expect(tableNames).toContain("nutrition_facts");
  });

  it("includes CREATE TABLE statements", () => {
    const result = schemaTool(db);

    const productsTable = result.tables?.find((t) => t.name === "products");
    expect(productsTable?.ddl).toContain("CREATE TABLE");
    expect(productsTable?.ddl).toContain("product_id");
  });
});
```

**Step 2: Implement tool**

```typescript
import type Database from "better-sqlite3";

export interface TableSchema {
  name: string;
  ddl: string;
}

export interface SchemaResult {
  success: boolean;
  tables?: TableSchema[];
  error?: string;
}

/**
 * Return DDL for all tables in the database.
 * Useful for Claude to understand available columns for query composition.
 */
export function schemaTool(db: Database.Database): SchemaResult {
  try {
    const tables = db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string; sql: string }>;

    return {
      success: true,
      tables: tables.map((t) => ({ name: t.name, ddl: t.sql })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
```

**Step 3: Run tests, commit**

---

## Task 4.3: Implement `search` Tool

**Files:**
- Create: `wegmans-mcp/src/tools/search.ts`
- Create: `wegmans-mcp/tests/tools/search.test.ts`
- Create: `wegmans-mcp/tests/tools/search.integration.test.ts`

**Purpose:** Trigger Algolia search, transform results, populate DB, return count.

**Step 1: Write unit test (mocked Algolia)**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { searchTool } from "../../src/tools/search.js";

describe("search tool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("populates database with search results", async () => {
    // Mock Algolia client
    const mockSearch = vi.fn().mockResolvedValue({
      success: true,
      hits: [
        {
          productId: "12345",
          productName: "Test Milk",
          storeNumber: "74",
          price_inStore: { amount: 3.99 },
        },
      ],
      totalHits: 1,
    });

    const result = await searchTool(db, {
      query: "milk",
      storeNumber: "74",
      apiKey: "test-key",
      searchFn: mockSearch,
    });

    expect(result.success).toBe(true);
    expect(result.productsAdded).toBe(1);

    // Verify product was inserted
    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ?")
      .get("12345");
    expect(product).toBeDefined();
  });

  it("returns error when Algolia fails", async () => {
    const mockSearch = vi.fn().mockResolvedValue({
      success: false,
      error: "API key expired",
      hits: [],
      totalHits: 0,
    });

    const result = await searchTool(db, {
      query: "milk",
      storeNumber: "74",
      apiKey: "bad-key",
      searchFn: mockSearch,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("API key");
  });
});
```

**Step 2: Implement tool**

```typescript
import type Database from "better-sqlite3";
import {
  searchProducts,
  transformHitToProduct,
  transformHitToStoreProduct,
  transformHitToServing,
  transformHitToNutritionFacts,
  type SearchResult,
  type SearchRequestOptions,
} from "../algolia/client.js";
import { upsertProduct, upsertStoreProduct, upsertServing, upsertNutritionFacts } from "../db/products.js";

export interface SearchToolOptions {
  query: string;
  storeNumber: string;
  apiKey: string;
  hitsPerPage?: number;
  /** Injectable for testing */
  searchFn?: (apiKey: string, options: SearchRequestOptions) => Promise<SearchResult>;
}

export interface SearchToolResult {
  success: boolean;
  productsAdded?: number;
  totalHits?: number;
  error?: string;
}

/**
 * Search Algolia for products and populate the local database.
 */
export async function searchTool(
  db: Database.Database,
  options: SearchToolOptions
): Promise<SearchToolResult> {
  const { query, storeNumber, apiKey, hitsPerPage = 20, searchFn = searchProducts } = options;

  const result = await searchFn(apiKey, { query, storeNumber, hitsPerPage });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
    };
  }

  let productsAdded = 0;

  for (const hit of result.hits) {
    const product = transformHitToProduct(hit);
    const storeProduct = transformHitToStoreProduct(hit);
    const serving = transformHitToServing(hit);
    const nutritionFacts = transformHitToNutritionFacts(hit);

    upsertProduct(db, product);
    upsertStoreProduct(db, storeProduct);

    if (serving) {
      upsertServing(db, serving);
    }

    if (nutritionFacts.length > 0) {
      upsertNutritionFacts(db, nutritionFacts);
    }

    productsAdded++;
  }

  return {
    success: true,
    productsAdded,
    totalHits: result.totalHits,
  };
}
```

**Step 3: Write integration test (real Algolia)**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { searchTool } from "../../src/tools/search.js";

const SKIP_INTEGRATION = process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";
const TEST_API_KEY = "9a10b1401634e9a6e55161c3a60c200d";
const TEST_STORE = "74";

describe.skipIf(SKIP_INTEGRATION)("search tool (integration)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("fetches and stores real products", { timeout: 30000 }, async () => {
    const result = await searchTool(db, {
      query: "yogurt",
      storeNumber: TEST_STORE,
      apiKey: TEST_API_KEY,
      hitsPerPage: 5,
    });

    expect(result.success).toBe(true);
    expect(result.productsAdded).toBeGreaterThan(0);

    // Verify products are queryable
    const products = db.prepare("SELECT COUNT(*) as c FROM products").get() as { c: number };
    expect(products.c).toBeGreaterThan(0);
  });
});
```

**Step 4: Run tests, commit**

---

## Task 4.4: Implement `refreshApiKey` Tool

**Files:**
- Create: `wegmans-mcp/src/tools/refreshApiKey.ts`
- Create: `wegmans-mcp/tests/tools/refreshApiKey.test.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { refreshApiKeyTool } from "../../src/tools/refreshApiKey.js";

describe("refreshApiKey tool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores extracted API key in database", async () => {
    const mockExtract = vi.fn().mockResolvedValue({
      success: true,
      apiKey: "new-api-key-12345",
      appId: "QGPPR19V8V",
      storeNumber: "74",
    });

    const result = await refreshApiKeyTool(db, {
      storeName: "Geneva, NY",
      extractFn: mockExtract,
    });

    expect(result.success).toBe(true);
    expect(result.apiKey).toBe("new-api-key-12345");

    // Verify stored in DB
    const stored = db
      .prepare("SELECT api_key FROM api_keys ORDER BY created_at DESC LIMIT 1")
      .get() as { api_key: string } | undefined;
    expect(stored?.api_key).toBe("new-api-key-12345");
  });

  it("returns error when extraction fails", async () => {
    const mockExtract = vi.fn().mockResolvedValue({
      success: false,
      apiKey: null,
      appId: null,
      storeNumber: null,
      error: "Browser timeout",
    });

    const result = await refreshApiKeyTool(db, {
      storeName: "Geneva, NY",
      extractFn: mockExtract,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });
});
```

**Step 2: Implement tool**

```typescript
import type Database from "better-sqlite3";
import { extractAlgoliaKey, type KeyExtractionResult } from "../algolia/keyExtractor.js";

export interface RefreshApiKeyOptions {
  storeName: string;
  headless?: boolean;
  timeout?: number;
  /** Injectable for testing */
  extractFn?: (storeName: string, options: { headless?: boolean; timeout?: number }) => Promise<KeyExtractionResult>;
}

export interface RefreshApiKeyResult {
  success: boolean;
  apiKey?: string;
  storeNumber?: string;
  error?: string;
}

/**
 * Extract a fresh API key from Wegmans website and store it.
 */
export async function refreshApiKeyTool(
  db: Database.Database,
  options: RefreshApiKeyOptions
): Promise<RefreshApiKeyResult> {
  const { storeName, headless = true, timeout = 60000, extractFn = extractAlgoliaKey } = options;

  const result = await extractFn(storeName, { headless, timeout });

  if (!result.success || !result.apiKey) {
    return {
      success: false,
      error: result.error ?? "Failed to extract API key",
    };
  }

  // Store in database
  db.prepare(
    `INSERT INTO api_keys (api_key, app_id, store_number, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(result.apiKey, result.appId, result.storeNumber);

  return {
    success: true,
    apiKey: result.apiKey,
    storeNumber: result.storeNumber ?? undefined,
  };
}
```

**Step 3: Run tests, commit**

---

# Phase 5: MCP Server + E2E Testing

## Task 5.1: Implement MCP Server Entry Point

See original Task 4.1 for implementation.

## Task 5.2: E2E Tests via MCP Protocol

**Files:**
- Create: `wegmans-mcp/tests/e2e/mcp-server.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("MCP Server E2E", () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    // Build first
    // Start server process
    serverProcess = spawn("node", [join(__dirname, "../../dist/index.js")], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(() => {
    serverProcess.kill();
  });

  it("responds to list_tools request", async () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    };

    // Send request via stdin
    serverProcess.stdin?.write(JSON.stringify(request) + "\n");

    // Read response
    const response = await new Promise<string>((resolve) => {
      serverProcess.stdout?.once("data", (data) => {
        resolve(data.toString());
      });
    });

    const parsed = JSON.parse(response);
    expect(parsed.result.tools).toBeDefined();
    expect(parsed.result.tools.length).toBeGreaterThan(0);
  });
});
```

---

# Summary

## Execution Order

1. **Phase 0** (MUST COMPLETE FIRST)
   - Task 0.1: Minimal scaffolding
   - Task 0.2: API exploration script
   - Task 0.3: Run exploration, capture results
   - Task 0.4: Schema snapshot tests
   - **CHECKPOINT: Review findings, update design**

2. **Phase 1** (After Phase 0 validates assumptions)
   - Task 1.1: Algolia Zod schemas (validated against real data)
   - Task 1.2: Product domain types

3. **Phase 2** (Isolated, can proceed in parallel with Phase 3 prep)
   - Tasks 2.1-2.5: Database layer with unit + property tests

4. **Phase 3** (Requires Phase 0 + Phase 1)
   - Task 3.1: Key extractor with integration test
   - Task 3.2: Algolia client with snapshot tests

5. **Phase 4** (Requires Phase 2 + Phase 3)
   - DB-only tools: query (raw SQL), schema (table DDL)
   - Algolia tools: search (fetch + populate), refreshApiKey

6. **Phase 5** (Requires all above)
   - MCP server entry point
   - E2E tests

## Testing Pyramid

```
        /\
       /  \  E2E (MCP protocol)
      /----\
     /      \  Integration (real Algolia, real DB)
    /--------\
   /          \  Snapshot (schema validation)
  /------------\
 /              \  Property (invariants)
/----------------\
       Unit (isolated functions)
```

## Checkpoints

| After | Verify |
|-------|--------|
| Phase 0 | API key extraction works, response schema documented |
| Phase 1 | Zod schemas parse real responses |
| Phase 2 | All DB tests pass, property tests pass |
| Phase 3 | Integration tests pass, snapshots match |
| Phase 4 | All tool unit tests pass |
| Phase 5 | E2E tests pass |
