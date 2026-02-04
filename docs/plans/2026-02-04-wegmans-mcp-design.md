# Wegmans MCP Server Design

**Date:** 2026-02-04
**Status:** Implemented (see [Current Architecture](#current-architecture-implemented) below)

> **Note:** This document contains the original design proposal. The actual implementation
> differs significantly - see the "Current Architecture" section and
> [wegmans-mcp/docs/architecture.md](../../wegmans-mcp/docs/architecture.md) for details.

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

**Multi-Store Support:** No default store. Store is required on all search operations. Data is normalized so product metadata is shared, but prices/aisles are store-specific.

### Context & References

**Primary user's store:** Geneva, NY (used for testing and development)

**Reference implementation:** `wegmans-shopping-ref/` submodule contains a Python/Playwright implementation we studied. Useful for:
- Comparing captured Algolia responses against historical data
- Understanding the browser interception approach
- Sample data in `data/reference/raleigh_products.json` and `algolia_responses.json`

**Algolia query types:** Wegmans uses Algolia for product search. Two query approaches:
- **Keyword search:** `query: "yogurt"` - matches text in product name, description, category
- **Faceted/filtered search:** `filters: "categoryNodes.lvl1:Dairy"` - returns all products in a category

The `search()` tool's `categoryFilter` parameter uses faceted search, not keyword search. This distinction matters for "browse the Dairy section" vs "search for 'Dairy'".

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

1. Claude calls `search("Geneva, NY", "greek yogurt")`
2. MCP server checks if Algolia API key is valid
3. If stale → Playwright spins up, extracts fresh key, exits
4. HTTP request to Algolia with search query + store filter
5. Product metadata upserted into `products`, store-specific data into `store_products`
6. Returns count to Claude
7. Claude calls `query("SELECT p.name, sp.aisle, sp.price FROM products p JOIN store_products sp ON ... WHERE ...")`
8. SQL runs against local SQLite, results returned

**Key Insight:** Browser automation is only used for API key extraction, not for every query. Normal operation is direct HTTP to Algolia + local SQLite.

## MCP Tools

### `search(store, query?, categoryFilter?)`

Search Wegmans for a specific store and populate local DB.

```typescript
search(store: string, query?: string, categoryFilter?: string) -> {
  store: string,
  query: string | null,
  category_filter: string | null,
  products_found: number,
  products_added: number
}
```

**Usage patterns:**
- `search("Geneva, NY", "yogurt")` - keyword search
- `search("Geneva, NY", undefined, "Dairy > Yogurt")` - browse category
- `search("Geneva, NY", "greek", "Dairy > Yogurt")` - keyword within category

### `query(sql)`

Run arbitrary SQL against local DB. Can query across stores.

```typescript
query(sql: string) -> {
  columns: string[],
  rows: any[][],
  row_count: number
}
```

**Example queries:**
```sql
-- Products at a specific store
SELECT p.name, sp.price, sp.aisle
FROM products p
JOIN store_products sp ON p.product_id = sp.product_id
JOIN stores s ON sp.store_number = s.store_number
WHERE s.location = 'Geneva, NY';

-- Compare prices across stores
SELECT p.name, s.location, sp.price
FROM products p
JOIN store_products sp ON p.product_id = sp.product_id
JOIN stores s ON sp.store_number = s.store_number
WHERE p.name LIKE '%yogurt%'
ORDER BY p.name, sp.price;
```

### `list_categories(store, level?)`

List known categories for a store. Auto-discovers from Algolia facets if DB is empty.

```typescript
list_categories(store: string, level?: number) -> {
  categories: Array<{
    name: string,
    parent: string | null,
    level: number,
    product_count: number
  }>
}
```

### `list_stores()`

List all stores currently represented in the database.

```typescript
list_stores() -> {
  stores: Array<{
    store_number: string,
    location: string,
    product_count: number,
    last_updated: string
  }>
}
```

### `refresh(store?)`

Re-run previous searches to refresh data. If store provided, only refresh that store.

```typescript
refresh(store?: string) -> {
  searches_run: number,
  products_updated: number
}
```

### `clear(store?)`

Wipe database. If store provided, only clear that store's data.

```typescript
clear(store?: string) -> {
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

**Design Principle:** Normalized multi-store schema. Product metadata (name, nutrition, ingredients) is shared across stores. Store-specific data (price, aisle) is separate.

```sql
-- API credentials
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  api_key TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT 'QGPPR19V8V',
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Known stores
CREATE TABLE stores (
  store_number TEXT PRIMARY KEY,
  location TEXT NOT NULL,           -- "Geneva, NY"
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Search history (for refresh) - per store
CREATE TABLE searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_number TEXT NOT NULL REFERENCES stores(store_number),
  query TEXT,
  category_filter TEXT,
  result_count INTEGER,
  last_run TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_number, query, category_filter)
);

-- Products - metadata only (shared across stores)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  pack_size TEXT,
  image_url TEXT,
  ingredients TEXT,
  allergens TEXT,
  is_sold_by_weight BOOLEAN,
  raw_json JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Store-specific product data (price, aisle vary by store)
CREATE TABLE store_products (
  product_id TEXT REFERENCES products(product_id),
  store_number TEXT REFERENCES stores(store_number),
  price REAL,
  unit_price TEXT,                  -- "$9.99/lb."
  aisle TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, store_number)
);

-- Serving info (same across stores)
CREATE TABLE servings (
  product_id TEXT PRIMARY KEY REFERENCES products(product_id),
  serving_size REAL,
  serving_size_unit TEXT,
  servings_per_container TEXT
);

-- Nutrition facts (fully normalized, same across stores)
CREATE TABLE nutrition_facts (
  product_id TEXT REFERENCES products(product_id),
  nutrient TEXT,
  quantity REAL,
  unit TEXT,
  percent_daily REAL,
  PRIMARY KEY (product_id, nutrient)
);

-- Category hierarchy (global, not per-store)
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  level INTEGER NOT NULL,
  UNIQUE(name, parent_id)
);

-- Product-category junction
CREATE TABLE product_categories (
  product_id TEXT REFERENCES products(product_id),
  category_id INTEGER REFERENCES categories(id),
  PRIMARY KEY (product_id, category_id)
);

-- Tags (global)
CREATE TABLE tags (
  tag TEXT PRIMARY KEY
);

CREATE TABLE product_tags (
  product_id TEXT REFERENCES products(product_id),
  tag TEXT REFERENCES tags(tag),
  PRIMARY KEY (product_id, tag)
);

-- Search-product junction (provenance, per search)
CREATE TABLE search_products (
  search_id INTEGER REFERENCES searches(id),
  product_id TEXT REFERENCES products(product_id),
  PRIMARY KEY (search_id, product_id)
);

-- Indexes
CREATE INDEX idx_store_products_store ON store_products(store_number);
CREATE INDEX idx_store_products_price ON store_products(price);
CREATE INDEX idx_store_products_aisle ON store_products(aisle);
CREATE INDEX idx_searches_store ON searches(store_number);
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
│   │   ├── listStores.ts     # list_stores() tool
│   │   ├── refresh.ts        # refresh() tool
│   │   └── clear.ts          # clear() tool
│   ├── algolia/
│   │   ├── client.ts         # Direct Algolia HTTP client
│   │   └── keyExtractor.ts   # Playwright key extraction
│   ├── db/
│   │   ├── schema.ts         # SQLite schema + migrations
│   │   ├── stores.ts         # Store CRUD operations
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

Note: No default store in config. Store is always passed explicitly to tools. Known stores are tracked in the `stores` table in the database.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No API key yet | Auto-extract on first `search()` |
| Algolia returns 401/403 | Re-extract key, retry once, then fail with clear message |
| Algolia rate limited | Return error, suggest waiting |
| Store not found in Algolia | Return error with suggestion to check store name spelling |
| Invalid SQL in `query()` | Return SQLite error message (helpful for Claude to self-correct) |
| Browser automation fails | Return error with suggestion to check Playwright install |
| Network timeout | Return error, suggest retry |

**Principle:** Errors should be informative enough that Claude can either self-correct or explain the issue clearly.

## Open Items (Resolved)

These were validated during implementation:

1. ✅ Algolia API key extraction - Playwright intercepts requests to `*algolia*` endpoints
2. ✅ Geneva, NY store number - Store 74
3. ✅ Database schema - Significantly revised (see below)
4. ✅ Category discovery - Categories extracted from product `categories.lvl0-4` fields

---

# Current Architecture (Implemented)

> **See also:** [wegmans-mcp/docs/architecture.md](../../wegmans-mcp/docs/architecture.md) for full details.

The implementation differs from the original design in several key ways:

## Key Changes from Original Design

### 1. Per-Store Database Architecture

Instead of a single database with `store_products` junction table:

```
~/.local/share/wegmans-mcp/    # XDG-compliant (not ~/.config/)
  settings.db        # API keys, active store setting
  stores.db          # Store locations
  stores/
    74.db            # Store 74's products (merged schema)
    101.db           # Store 101's products
```

**Why:** Query isolation - impossible to accidentally query wrong store's products.

### 2. Simplified 2-Tool API

Instead of 7 tools (`search`, `query`, `list_categories`, `list_stores`, `refresh`, `clear`, `refresh_api_key`):

| Tool | Description |
|------|-------------|
| `query` | SQL queries with `database` parameter (`"stores"` or `"products"`) |
| `setStore` | Select store and fetch catalog (~29,000 products) |

**Why:** Claude can use SQL for everything. Simpler is better.

### 3. Merged Products Table

Instead of separate `products` and `store_products` tables:

```sql
-- Each store database has this merged schema
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  -- ... base fields ...
  price_in_store REAL,      -- Store-specific (was in store_products)
  aisle TEXT,               -- Store-specific (was in store_products)
  is_available INTEGER,     -- Store-specific (was in store_products)
  -- ... etc ...
);
```

**Why:** No `store_number` column needed - each store has its own database file.

### 4. Full Catalog Fetch

Instead of incremental search-based population:

- `setStore` fetches the **entire catalog** (~29,000 products) on first use
- Subsequent queries are purely local (fast, offline)
- Catalog refreshes if stale (>24 hours)

**Why:** Complete data enables complex queries without "search first" workflow.

### 5. Dynamic Schema Embedding

Tool descriptions include the actual database schema:

```
STORES SCHEMA (database="stores"):
CREATE TABLE stores (...)

PRODUCTS SCHEMA (database="products"):
CREATE TABLE products (...)
```

**Why:** Claude always knows the exact columns available for queries.

## Typical Usage Flow

1. Claude queries stores: `SELECT store_number, city FROM stores WHERE state = 'NY'`
2. User/Claude calls: `setStore({ storeNumber: "74" })`
3. Server fetches full catalog (first time only)
4. Claude queries products: `SELECT name, price_in_store, aisle FROM products WHERE ...`

## What Was Kept from Original Design

- ✅ Headless, non-interactive operation
- ✅ SQLite for local storage
- ✅ Playwright for API key extraction
- ✅ Algolia as data source
- ✅ TypeScript with strict mode
- ✅ Zod for validation
