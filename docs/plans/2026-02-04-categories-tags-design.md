# Categories & Tags Feature Design

Date: 2026-02-04
Updated: 2026-02-04 (reflects current implementation)

## Goal

Add category and tag support to enable:
1. **Browsing** - Query products by category without text search
2. **Filtering** - Filter by tags like "Gluten Free", "Organic"
3. **Reference** - Claude knows what categories/tags exist for natural language queries

## Philosophy

- **Algolia populates, SQL queries** - Use broad Algolia searches to populate the local SQLite mirror, then use SQL for filtering/joins/aggregations
- **Stores fetched on startup** - Store list fetched from Wegmans API on server startup (24h cache)
- **Full catalog on setStore** - Scrape entire catalog when store is selected (if empty or stale)
- **Dynamic credentials** - API key and app ID are extracted from Wegmans website, not hardcoded
- **Schema in tool description** - Database schema is embedded in the query tool description so Claude doesn't need a separate tool call
- **Everything via SQL** - No special tools for listing stores; query the `stores` table directly

## MCP Tools API

The server exposes 2 tools:

### `setStore`
Set the active store and fetch its catalog. Call this first.

```typescript
interface SetStoreParams {
  storeNumber: string;    // e.g., "74" for Geneva, NY
  forceRefresh?: boolean; // Force re-fetch even if data exists
}
```

On first call for a store:
1. Extracts API credentials from Wegmans website (if not cached)
2. Fetches full catalog (~29,000 products)
3. Populates ontology tables (categories, tags)

### `query`
Execute read-only SQL against the product database.

```typescript
interface QueryParams {
  sql: string;  // SELECT statement only
}
```

The tool description includes the full database schema (all CREATE TABLE/VIEW statements), so Claude can write correct queries without needing to call a separate schema tool.

## Database Schema

### Core tables

```sql
-- Settings (stores active_store)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Wegmans store locations (fetched from API on startup)
CREATE TABLE stores (
  store_number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  street_address TEXT,
  latitude REAL,              -- for distance calculations
  longitude REAL,
  phone_number TEXT,
  has_pickup INTEGER,
  has_delivery INTEGER,
  has_ecommerce INTEGER,
  has_pharmacy INTEGER,
  sells_alcohol INTEGER,
  open_state TEXT,            -- e.g., "Open"
  opening_date TEXT,
  zones TEXT                  -- regional zone
);

-- Product metadata (store-independent)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  pack_size TEXT,
  image_url TEXT,
  ingredients TEXT,
  allergens TEXT,
  is_sold_by_weight INTEGER NOT NULL DEFAULT 0,
  is_alcohol INTEGER NOT NULL DEFAULT 0,
  upc TEXT,
  category_path TEXT,      -- e.g., "Dairy > Milk > Whole Milk"
  tags_filter TEXT,        -- JSON array: ["Gluten Free", "Organic"]
  tags_popular TEXT        -- JSON array: ["Wegmans Brand"]
);

-- Store-specific pricing and availability
CREATE TABLE store_products (
  product_id TEXT NOT NULL,
  store_number TEXT NOT NULL,
  price_in_store REAL,
  price_in_store_loyalty REAL,
  price_delivery REAL,
  price_delivery_loyalty REAL,
  unit_price TEXT,
  aisle TEXT,
  shelf TEXT,
  is_available INTEGER NOT NULL DEFAULT 0,
  is_sold_at_store INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT,
  PRIMARY KEY (product_id, store_number)
);

-- Serving information
CREATE TABLE servings (
  product_id TEXT PRIMARY KEY,
  serving_size TEXT,
  serving_size_unit TEXT,
  servings_per_container TEXT,
  household_measurement TEXT
);

-- Nutrition facts (multiple per product)
CREATE TABLE nutrition_facts (
  product_id TEXT NOT NULL,
  nutrient TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  percent_daily REAL,
  category TEXT NOT NULL CHECK (category IN ('general', 'vitamin')),
  PRIMARY KEY (product_id, nutrient)
);
```

### Ontology tables

```sql
-- Category hierarchy reference
CREATE TABLE categories (
  path TEXT PRIMARY KEY,       -- e.g., "Dairy > Milk > Whole Milk"
  name TEXT NOT NULL,          -- e.g., "Whole Milk"
  level INTEGER NOT NULL,      -- 0-4
  product_count INTEGER
);

-- Tags reference
CREATE TABLE tags (
  name TEXT NOT NULL,          -- e.g., "Gluten Free"
  type TEXT NOT NULL,          -- "filter" or "popular"
  product_count INTEGER,
  PRIMARY KEY (name, type)
);
```

### Views for relational queries

```sql
-- Simple category lookup
CREATE VIEW product_categories AS
SELECT product_id, category_path
FROM products
WHERE category_path IS NOT NULL;

-- Unpacks JSON tag arrays for joins
CREATE VIEW product_tags AS
SELECT product_id, value as tag_name, 'filter' as tag_type
FROM products, json_each(tags_filter)
WHERE tags_filter IS NOT NULL
UNION ALL
SELECT product_id, value as tag_name, 'popular' as tag_type
FROM products, json_each(tags_popular)
WHERE tags_popular IS NOT NULL;
```

## API Credential Extraction

Credentials are extracted dynamically from the Wegmans website using Playwright:

1. Navigate to wegmans.com
2. Intercept network requests to Algolia
3. Extract API key and app ID from request headers
4. Cache in `api_keys` table for reuse

```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  app_id TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  expires_at TEXT
);
```

This happens automatically on first `setStore` call if no credentials are cached.

## Full Catalog Scrape

**Trigger:** `setStore` tool call, if:
- No products for that store, OR
- Last scrape was > 1 day ago

**Algorithm:**
1. Start with all products for the store
2. If > 1000 results, dynamically split by best available facet (prefers category hierarchy)
3. For each split, also query the "remainder" (products not matching any facet value)
4. Recursively split until all buckets <= 1000
5. Execute all leaf queries with concurrency, deduplicate by productId
6. Back off exponentially if rate-limited (429 response)

**Performance (benchmarked):**
- ~156 queries for full catalog
- ~29,000 products (98.1% coverage)
- ~15-20 seconds with concurrency
- Remaining 2% are nameless POS placeholder items

**Concurrency settings:**
```typescript
const CONCURRENCY = 30;       // Parallel requests during fetch
const BASE_DELAY_MS = 20;     // Base delay between batches
const MAX_BACKOFF_MS = 30000; // Max delay on rate limit
```

## Query Examples

### Store queries

**Find stores closest to NYC (40.7128, -74.0060):**
```sql
SELECT store_number, name, city, state,
  SQRT(POW(latitude - 40.7128, 2) + POW(longitude - (-74.0060), 2)) as distance
FROM stores
WHERE latitude IS NOT NULL
ORDER BY distance
LIMIT 5;
```

**Stores with pharmacy and delivery in NY:**
```sql
SELECT store_number, name, city, phone_number
FROM stores
WHERE state = 'NY' AND has_pharmacy = 1 AND has_delivery = 1;
```

**All stores by state:**
```sql
SELECT state, COUNT(*) as count FROM stores GROUP BY state ORDER BY count DESC;
```

### Product queries

**Products in Dairy (any subcategory):**
```sql
SELECT p.name, p.brand, sp.price_in_store
FROM products p
JOIN store_products sp ON p.product_id = sp.product_id
WHERE p.category_path LIKE 'Dairy%'
ORDER BY p.name;
```

**Gluten-free products:**
```sql
SELECT p.name, p.brand
FROM products p
JOIN product_tags pt ON p.product_id = pt.product_id
WHERE pt.tag_name = 'Gluten Free';
```

**Organic dairy products:**
```sql
SELECT p.name, sp.price_in_store
FROM products p
JOIN store_products sp ON p.product_id = sp.product_id
JOIN product_tags pt ON p.product_id = pt.product_id
WHERE p.category_path LIKE 'Dairy%'
  AND pt.tag_name = 'Organic';
```

**What categories exist:**
```sql
SELECT path, product_count
FROM categories
ORDER BY path;
```

**What tags exist:**
```sql
SELECT name, type, product_count
FROM tags
ORDER BY product_count DESC;
```

**Products with nutrition info:**
```sql
SELECT p.name, nf.nutrient, nf.quantity, nf.unit
FROM products p
JOIN nutrition_facts nf ON p.product_id = nf.product_id
WHERE p.name LIKE '%milk%'
  AND nf.nutrient = 'Protein';
```

## Implementation Status

- [x] Database schema (products, store_products, categories, tags, views)
- [x] Product type and Zod schema with category/tag fields
- [x] Transform functions extract category/tags from Algolia hits
- [x] Ontology population on catalog fetch
- [x] Dynamic API credential extraction
- [x] setStore/listStores tools
- [x] Schema embedded in query tool description
- [x] TypeScript strict mode compliance (discriminated unions)
- [x] Dynamic store list fetching with 24h cache
- [x] Tests passing (197 tests)

## Context & References

- Algolia API: Products indexed at `QGPPR19V8V-dsn.algolia.net`
- Facets: `categories.lvl0-4`, `filterTags`, `popularTags`
- Store API: `https://www.wegmans.com/api/stores` (~114 stores)
