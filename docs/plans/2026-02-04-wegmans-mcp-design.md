# Wegmans MCP Server Design

**Date:** 2026-02-04
**Status:** Approved, tentative details to be refined during implementation

## Overview

An MCP server that provides Claude with queryable access to Wegmans product inventory, prices, aisle locations, and nutritional information.

**Core Concept:** An on-demand populated mirror of Wegmans' product database. Searches fetch from Wegmans (via Algolia API) and store locally in SQLite. Subsequent queries run against the local database - fast, flexible, and offline-capable once populated.

### Goals

- Headless and non-interactive - no browser UI, just data
- Help plan shopping trips - "what aisle is the yogurt?", "what's the cheapest high-protein option?"
- Stateless queries in, structured data out
- Persist across sessions so past searches remain queryable

### Non-Goals

- Shopping list management (separate skill can handle this)
- Cart/checkout integration
- Real-time inventory/stock levels
- Price alerts or tracking over time

**Default Store:** Geneva, NY (configurable)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
│                          │                                   │
│                     MCP Protocol                             │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Wegmans MCP Server                          ││
│  │                                                          ││
│  │   ┌──────────┐   ┌──────────┐   ┌──────────────┐        ││
│  │   │  Tools   │   │ Algolia  │   │   SQLite     │        ││
│  │   │ Handler  │──▶│  Client  │──▶│   Storage    │        ││
│  │   └──────────┘   └──────────┘   └──────────────┘        ││
│  │                        │                 │               ││
│  │                        ▼                 ▼               ││
│  │               ┌──────────────┐   ~/.config/wegmans-      ││
│  │               │ Key Manager  │   mcp/products.db         ││
│  │               │ (Playwright) │                           ││
│  │               └──────────────┘                           ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. Claude calls `search("greek yogurt")`
2. MCP server checks if Algolia API key is valid
3. If stale → Playwright spins up, extracts fresh key, exits
4. HTTP request to Algolia with search query
5. Results upserted into SQLite
6. Returns count to Claude
7. Claude calls `query("SELECT name, aisle, price FROM products WHERE ...")`
8. SQL runs against local SQLite, results returned

**Key Insight:** Browser automation is only used for API key extraction, not for every query. Normal operation is direct HTTP to Algolia + local SQLite.

## MCP Tools

### `search(query?, categoryFilter?)`

Search Wegmans and populate local DB.

```typescript
search(query?: string, categoryFilter?: string) -> {
  query: string | null,
  category_filter: string | null,
  products_found: number,
  products_added: number
}
```

**Usage patterns:**
- `search("yogurt")` - keyword search
- `search(undefined, "Dairy > Yogurt")` - browse category
- `search("greek", "Dairy > Yogurt")` - keyword within category

### `query(sql)`

Run arbitrary SQL against local DB.

```typescript
query(sql: string) -> {
  columns: string[],
  rows: any[][],
  row_count: number
}
```

### `list_categories(level?)`

List known categories. Auto-discovers from Algolia facets if DB is empty.

```typescript
list_categories(level?: number) -> {
  categories: Array<{
    name: string,
    parent: string | null,
    level: number,
    product_count: number
  }>
}
```

### `refresh()`

Re-run all previous searches to refresh data.

```typescript
refresh() -> {
  searches_run: number,
  products_updated: number
}
```

### `clear()`

Wipe database for fresh start.

```typescript
clear() -> {
  products_deleted: number,
  searches_deleted: number
}
```

### `refresh_api_key()`

Force API key refresh if queries are failing.

```typescript
refresh_api_key() -> {
  success: boolean,
  message: string
}
```

## Database Schema

**Status:** Tentative - to be refined during implementation

**Location:** `~/.config/wegmans-mcp/products.db`

```sql
-- API credentials
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  api_key TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT 'QGPPR19V8V',
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Search history (for refresh)
CREATE TABLE searches (
  query TEXT PRIMARY KEY,
  category_filter TEXT,
  result_count INTEGER,
  last_run TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products (core fields only)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  price REAL,
  unit_price TEXT,
  is_sold_by_weight BOOLEAN,
  aisle TEXT,
  pack_size TEXT,
  image_url TEXT,
  ingredients TEXT,
  allergens TEXT,
  raw_json JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Serving info
CREATE TABLE servings (
  product_id TEXT PRIMARY KEY REFERENCES products(product_id),
  serving_size REAL,
  serving_size_unit TEXT,
  servings_per_container TEXT
);

-- Nutrition facts (fully normalized)
CREATE TABLE nutrition_facts (
  product_id TEXT REFERENCES products(product_id),
  nutrient TEXT,
  quantity REAL,
  unit TEXT,
  percent_daily REAL,
  PRIMARY KEY (product_id, nutrient)
);

-- Category hierarchy
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  level INTEGER NOT NULL,
  product_count INTEGER,
  UNIQUE(name, parent_id)
);

-- Product-category junction
CREATE TABLE product_categories (
  product_id TEXT REFERENCES products(product_id),
  category_id INTEGER REFERENCES categories(id),
  PRIMARY KEY (product_id, category_id)
);

-- Tags
CREATE TABLE tags (
  tag TEXT PRIMARY KEY
);

CREATE TABLE product_tags (
  product_id TEXT REFERENCES products(product_id),
  tag TEXT REFERENCES tags(tag),
  PRIMARY KEY (product_id, tag)
);

-- Search-product junction (provenance)
CREATE TABLE search_products (
  query TEXT REFERENCES searches(query),
  product_id TEXT REFERENCES products(product_id),
  PRIMARY KEY (query, product_id)
);

-- Indexes
CREATE INDEX idx_products_aisle ON products(aisle);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_nutrition_nutrient ON nutrition_facts(nutrient);
CREATE INDEX idx_nutrition_quantity ON nutrition_facts(nutrient, quantity);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_product_tags_tag ON product_tags(tag);
```

## Algolia Client & Key Management

**Status:** Tentative - to be validated during implementation

### Hypothesis

Wegmans uses a public search-only Algolia API key embedded in their frontend (standard Algolia pattern). We'll extract it from browser requests or page JavaScript.

### Known Information

- **App ID:** `QGPPR19V8V` (stable, hardcoded)
- **Endpoint:** `https://{app_id}-dsn.algolia.net/1/indexes/*/queries`

### Key Extraction Approach

1. Use Playwright to intercept requests to `*algolia*` endpoints
2. Capture the `x-algolia-api-key` header from outgoing requests
3. Cache the key and use it for direct HTTP queries
4. If direct queries fail or key extraction doesn't work → fall back to browser interception

### Key Lifecycle

- On first `search()` call → extract key if none exists
- On Algolia 401/403 → re-extract key, retry once, then fail with clear message
- On `refresh_api_key()` → force re-extraction

### Fallback

If the "direct Algolia" approach proves unworkable, the MCP server will use persistent browser interception. Slower, but proven.

## Project Structure

**Language:** TypeScript (strict mode)

### tsconfig.json

Maximum strictness:

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
    "rootDir": "src"
  }
}
```

### Directory Structure

```
wegmans-mcp/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   ├── search.ts         # search() tool
│   │   ├── query.ts          # query() tool
│   │   ├── listCategories.ts # list_categories() tool
│   │   ├── refresh.ts        # refresh() tool
│   │   └── clear.ts          # clear() tool
│   ├── algolia/
│   │   ├── client.ts         # Direct Algolia HTTP client
│   │   └── keyExtractor.ts   # Playwright key extraction
│   ├── db/
│   │   ├── schema.ts         # SQLite schema + migrations
│   │   ├── products.ts       # Product CRUD operations
│   │   └── queries.ts        # Raw SQL query execution
│   └── types/
│       ├── algolia.ts        # Algolia response types
│       └── product.ts        # Product domain types
├── tests/
│   └── ...
└── scripts/
    └── extract-key.ts        # Standalone key extraction for debugging
```

### Dependencies

- `@modelcontextprotocol/sdk` - Official MCP SDK
- `playwright` - Browser automation
- `better-sqlite3` - Synchronous SQLite
- `@types/better-sqlite3` - Type definitions
- `zod` - Runtime validation with type inference

### Linting

ESLint with `@typescript-eslint/strict` + `@typescript-eslint/stylistic` rule sets.

## Configuration

**Location:** `~/.config/wegmans-mcp/config.json`

```typescript
interface Config {
  store: {
    location: string;      // "Geneva, NY"
    number?: string;       // Discovered from Algolia, e.g., "059"
  };
  algolia: {
    appId: string;         // "QGPPR19V8V" (hardcoded default)
    apiKey?: string;       // Extracted, cached here
    keyExtractedAt?: string; // ISO timestamp
  };
  database: {
    path: string;          // Default: ~/.config/wegmans-mcp/products.db
  };
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No API key yet | Auto-extract on first `search()` |
| Algolia returns 401/403 | Re-extract key, retry once, then fail with clear message |
| Algolia rate limited | Return error, suggest waiting |
| Store not found | Prompt user to check store location in config |
| Invalid SQL in `query()` | Return SQLite error message (helpful for Claude to self-correct) |
| Browser automation fails | Return error with suggestion to check Playwright install |
| Network timeout | Return error, suggest retry |

**Principle:** Errors should be informative enough that Claude can either self-correct or explain the issue clearly.

## Open Items

To be validated during implementation:

1. Algolia API key extraction method - where exactly is the key?
2. Exact store number for Geneva, NY
3. Database schema refinements as we see real data structure
4. Algolia facet query format for category discovery
