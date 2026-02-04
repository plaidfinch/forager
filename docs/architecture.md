# Forager Architecture

## Overview

The server uses a **per-store database architecture** where each Wegmans store has its own SQLite database file. This design provides query isolation, simpler schemas, and independent data refresh.

## Database Structure

```
$XDG_DATA_HOME/forager/    # defaults to ~/.local/share/forager/
  settings.db        # Global settings and API credentials
  stores.db          # Store locations (shared across all stores)
  stores/
    74.db            # Store 74's product catalog
    101.db           # Store 101's product catalog
    ...
```

### Why This Architecture?

| Concern | Single-DB Approach | Per-Store Approach |
|---------|-------------------|-------------------|
| Query isolation | Must filter by `store_number` on every query | Impossible to accidentally query wrong store |
| Schema complexity | `store_products` junction table with composite keys | Simple `products` table, no store_number column |
| Data refresh | Must track which products belong to which store | Just refresh the entire store database |
| Working set | All stores loaded | Only active store in memory |
| Cross-store queries | Possible (risk of confusion) | Requires explicit database selection |

## Database Schemas

### settings.db

Stores global configuration that applies across all stores.

```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,           -- Algolia API key
  app_id TEXT NOT NULL,        -- Algolia app ID
  extracted_at TEXT NOT NULL,  -- ISO timestamp
  expires_at TEXT              -- ISO timestamp (if known)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: 'active_store' (currently selected store number)
```

### stores.db

Caches Wegmans store locations fetched from their API.

```sql
CREATE TABLE stores (
  store_number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  street_address TEXT,
  latitude REAL,
  longitude REAL,
  phone_number TEXT,
  has_pickup INTEGER,
  has_delivery INTEGER,
  has_ecommerce INTEGER,
  has_pharmacy INTEGER,
  sells_alcohol INTEGER,
  open_state TEXT,
  opening_date TEXT,
  zones TEXT,
  last_updated TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: 'stores_last_updated' (cache freshness timestamp)
```

### stores/{storeNumber}.db

Per-store product catalog. Each store has an identical schema.

```sql
-- Merged products table (combines what was products + store_products)
CREATE TABLE products (
  -- Base product metadata
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
  category_path TEXT,
  tags_filter TEXT,    -- JSON array
  tags_popular TEXT,   -- JSON array

  -- Store-specific pricing (no store_number needed!)
  price_in_store REAL,
  price_in_store_loyalty REAL,
  price_delivery REAL,
  price_delivery_loyalty REAL,
  unit_price TEXT,

  -- Store-specific location
  aisle TEXT,
  shelf TEXT,

  -- Availability
  is_available INTEGER,
  is_sold_at_store INTEGER,
  last_updated TEXT
);

CREATE TABLE servings (
  product_id TEXT PRIMARY KEY,
  serving_size TEXT,
  serving_size_unit TEXT,
  servings_per_container TEXT,
  household_measurement TEXT,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

CREATE TABLE nutrition_facts (
  product_id TEXT NOT NULL,
  nutrient TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  percent_daily REAL,
  category TEXT NOT NULL CHECK (category IN ('general', 'vitamin')),
  PRIMARY KEY (product_id, nutrient),
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

CREATE TABLE categories (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  product_count INTEGER
);

CREATE TABLE tags (
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  product_count INTEGER,
  PRIMARY KEY (name, type)
);

-- Views for convenient access
CREATE VIEW product_categories AS
SELECT product_id, category_path FROM products WHERE category_path IS NOT NULL;

CREATE VIEW product_tags AS
SELECT product_id, value as tag_name, 'filter' as tag_type
FROM products, json_each(tags_filter) WHERE tags_filter IS NOT NULL
UNION ALL
SELECT product_id, value as tag_name, 'popular' as tag_type
FROM products, json_each(tags_popular) WHERE tags_popular IS NOT NULL;
```

## Connection Management

The server manages multiple database connections through `src/db/connection.ts`:

```typescript
interface DatabaseConnections {
  settings: Database.Database;          // Always open
  stores: Database.Database;            // Always open
  storeData: Database.Database | null;  // Open when store selected
  storeDataReadonly: Database.Database | null;
  activeStoreNumber: string | null;
}
```

### Startup Flow

1. `openDatabases(dataDir)` - Opens settings.db and stores.db
2. `restoreActiveStore()` - Checks settings for previously active store
3. `openStoreDatabase(dataDir, storeNumber)` - Opens the store's database if one was active
4. `refreshStoresIfNeeded()` - Updates store cache if stale (>24h)

### Store Selection Flow

1. User calls `setStore(storeNumber)`
2. Validate store exists in stores.db
3. Close current store database (if any)
4. Open `stores/{storeNumber}.db`
5. Initialize schema if new database
6. Refresh catalog if empty or stale
7. Update `active_store` in settings.db

## Query Tool Routing

The `query` tool accepts a `database` parameter:

```typescript
// In tool handler
if (database === "stores") {
  // Route to stores.db (always available)
  const storesDb = getStoresDb();
  return queryTool(storesDb, sql);
} else {
  // Route to active store's database
  const { readonlyDb } = getStoreDataDb();  // Throws if no store selected
  return queryTool(readonlyDb, sql);
}
```

This allows Claude to:
1. Query stores to find a store number (before any store is selected)
2. Call setStore with the discovered store number
3. Query products for that store

## Schema Embedding

Tool descriptions dynamically embed the current database schemas:

```typescript
export function getToolDefinitions(storesDb?, storeDataDb?) {
  // Always available
  const storesSchema = schemaTool(storesDb);

  // Only if store selected
  const productsSchema = storeDataDb
    ? schemaTool(storeDataDb)
    : "No store selected. Use setStore first.";

  return [{
    name: "query",
    description: `...
      STORES SCHEMA: ${storesSchema}
      PRODUCTS SCHEMA: ${productsSchema}
    `
  }];
}
```

The `schemaTool` function extracts DDL from SQLite's `sqlite_master` table, so Claude always sees the actual current schema.

## Data Flow

```
                                    ┌─────────────────┐
                                    │   Claude Code   │
                                    └────────┬────────┘
                                             │ MCP Protocol
                                             ▼
┌────────────────────────────────────────────────────────────────┐
│                        Forager Server                           │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │    query    │    │  setStore   │    │   ListTools         │ │
│  │    tool     │    │    tool     │    │   (schema embed)    │ │
│  └──────┬──────┘    └──────┬──────┘    └──────────┬──────────┘ │
│         │                  │                       │            │
│         ▼                  ▼                       ▼            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Connection Manager                          │   │
│  │  getStoresDb() │ getStoreDataDb() │ openStoreDatabase() │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                  │                       │            │
└─────────┼──────────────────┼───────────────────────┼────────────┘
          │                  │                       │
          ▼                  ▼                       ▼
   ┌────────────┐    ┌────────────┐          ┌────────────┐
   │ stores.db  │    │  74.db     │          │ settings.db│
   │            │    │ (products) │          │ (api keys) │
   └────────────┘    └────────────┘          └────────────┘
```

## Data Location

Data is stored at `~/.local/share/forager/` (or `$XDG_DATA_HOME/forager/` if set).
