# Forager

An MCP (Model Context Protocol) server that provides Claude with queryable access to Wegmans product inventory, prices, aisle locations, and nutritional information.

## Features

- **Product Search**: Query ~29,000 products per store with prices, aisle locations, and nutrition data
- **Multi-Store Support**: Each store has its own database - query isolation prevents cross-store confusion
- **Location Discovery**: Find Wegmans stores by city, state, or coordinates
- **Offline Capable**: Data is cached locally in SQLite for fast, offline queries
- **Auto-Refresh**: Catalog data refreshes automatically when stale (>24 hours)

## Quick Start

```bash
cd forager
./install.sh
```

This installs dependencies, builds, and adds the server to Claude Code.

Then restart Claude Code and try: "Find Wegmans stores near me"

### Manual Installation

```bash
npm install
npm run build
claude mcp add --transport stdio forager -- node $PWD/dist/src/index.js
```

### Uninstall

```bash
claude mcp remove forager
```

### Updating

When the repo is updated, rebuild to get the latest changes:

```bash
git pull
npm install      # In case dependencies changed
npm run build    # Rebuild TypeScript
```

The MCP server points to the built files, so changes take effect on the next Claude Code restart. No need to re-run `claude mcp add`.

## Data Location

Data is stored following the XDG Base Directory Specification:

```
~/.local/share/forager/    # or $XDG_DATA_HOME/forager/
  settings.db        # API keys, active store setting
  stores.db          # Store locations (from Wegmans API)
  stores/
    74.db            # Store 74's products, nutrition, etc.
    101.db           # Store 101's products
```

Override with: `XDG_DATA_HOME=/custom/path`

## Tools

### `query`

Execute read-only SQL queries against either the stores database or the active store's product database.

**Parameters:**
- `sql` (required): SQL SELECT statement
- `database` (optional): `"stores"` or `"products"` (default: `"products"`)

**Examples:**

```sql
-- Find stores in New York (database="stores")
SELECT store_number, name, city, state
FROM stores
WHERE state = 'NY'

-- Search products by name (database="products", requires setStore first)
SELECT name, brand, price_in_store, aisle
FROM products
WHERE name LIKE '%yogurt%'
ORDER BY price_in_store

-- Find high-protein products under $5
SELECT p.name, p.price_in_store, nf.quantity as protein_g
FROM products p
JOIN nutrition_facts nf ON p.product_id = nf.product_id
WHERE nf.nutrient = 'Protein'
  AND nf.quantity > 20
  AND p.price_in_store < 5
ORDER BY nf.quantity DESC
```

### `setStore`

Select a Wegmans store and fetch its product catalog.

**Parameters:**
- `storeNumber` (required): Store number (e.g., "74")
- `forceRefresh` (optional): Force catalog refresh even if data exists

**Usage:**
1. First, query stores to find a store number
2. Call `setStore` with the store number
3. Then query products for that store

## Database Schemas

### Stores Database (`database="stores"`)

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
  sells_alcohol INTEGER
);
```

### Products Database (`database="products"`)

```sql
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  pack_size TEXT,
  image_url TEXT,
  ingredients TEXT,
  allergens TEXT,
  is_sold_by_weight INTEGER,
  is_alcohol INTEGER,
  upc TEXT,
  category_path TEXT,          -- e.g., "Dairy > Milk > Whole Milk"
  tags_filter TEXT,            -- JSON array: ["Organic", "Gluten Free"]
  tags_popular TEXT,           -- JSON array: ["Wegmans Brand"]
  -- Store-specific fields
  price_in_store REAL,
  price_in_store_loyalty REAL, -- Shoppers Club price
  price_delivery REAL,
  price_delivery_loyalty REAL,
  unit_price TEXT,             -- e.g., "$2.99/lb"
  aisle TEXT,
  shelf TEXT,
  is_available INTEGER,
  is_sold_at_store INTEGER,
  last_updated TEXT
);

CREATE TABLE servings (
  product_id TEXT PRIMARY KEY,
  serving_size TEXT,
  serving_size_unit TEXT,
  servings_per_container TEXT,
  household_measurement TEXT
);

CREATE TABLE nutrition_facts (
  product_id TEXT NOT NULL,
  nutrient TEXT NOT NULL,      -- e.g., "Calories", "Protein", "Vitamin D"
  quantity REAL,
  unit TEXT,
  percent_daily REAL,
  category TEXT,               -- "general" or "vitamin"
  PRIMARY KEY (product_id, nutrient)
);

CREATE TABLE categories (
  path TEXT PRIMARY KEY,       -- e.g., "Dairy > Milk > Whole Milk"
  name TEXT NOT NULL,          -- e.g., "Whole Milk"
  level INTEGER NOT NULL,      -- 0-4 (depth in hierarchy)
  product_count INTEGER
);

CREATE TABLE tags (
  name TEXT NOT NULL,
  type TEXT NOT NULL,          -- "filter" or "popular"
  product_count INTEGER,
  PRIMARY KEY (name, type)
);

-- Views for convenient queries
CREATE VIEW product_categories AS ...;
CREATE VIEW product_tags AS ...;
```

## Development

```bash
npm test           # Run tests
npm run build      # Build TypeScript
npm run start      # Start MCP server
```

### Windows

On native Windows, use `cmd /c` wrapper:

```bash
claude mcp add --transport stdio forager -- cmd /c node /path/to/forager/dist/src/index.js
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for details on the multi-database design.

## License

MIT
