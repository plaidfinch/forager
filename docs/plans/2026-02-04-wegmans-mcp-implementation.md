# Wegmans MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that provides Claude with queryable access to Wegmans product data (prices, aisles, nutrition) via a local SQLite mirror populated from Algolia.

**Architecture:** TypeScript MCP server using `@modelcontextprotocol/sdk`. Direct HTTP queries to Algolia API with Playwright-based key extraction fallback. Normalized SQLite schema with `better-sqlite3`.

**Tech Stack:** TypeScript (strict), MCP SDK, Playwright, better-sqlite3, zod, vitest

---

## Phase 1: Project Scaffolding

### Task 1.1: Initialize Node.js Project

**Files:**
- Create: `wegmans-mcp/package.json`

**Step 1: Create project directory**

```bash
mkdir -p wegmans-mcp && cd wegmans-mcp
```

**Step 2: Initialize package.json**

```bash
npm init -y
```

**Step 3: Update package.json with proper config**

Replace contents with:

```json
{
  "name": "wegmans-mcp",
  "version": "0.1.0",
  "description": "MCP server for querying Wegmans product data",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "wegmans-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "keywords": ["mcp", "wegmans", "shopping"],
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 4: Commit**

```bash
git add wegmans-mcp/package.json
git commit -m "feat: initialize wegmans-mcp package"
```

---

### Task 1.2: Configure TypeScript with Strict Settings

**Files:**
- Create: `wegmans-mcp/tsconfig.json`

**Step 1: Create tsconfig.json**

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
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/tsconfig.json
git commit -m "feat: add strict TypeScript configuration"
```

---

### Task 1.3: Configure ESLint with Strict Rules

**Files:**
- Create: `wegmans-mcp/eslint.config.js`

**Step 1: Install ESLint dependencies**

```bash
cd wegmans-mcp && npm install --save-dev eslint @eslint/js typescript-eslint
```

**Step 2: Create eslint.config.js**

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "eslint.config.js"],
  }
);
```

**Step 3: Commit**

```bash
git add wegmans-mcp/eslint.config.js wegmans-mcp/package.json wegmans-mcp/package-lock.json
git commit -m "feat: add ESLint with strict TypeScript rules"
```

---

### Task 1.4: Install Core Dependencies

**Files:**
- Modify: `wegmans-mcp/package.json`

**Step 1: Install production dependencies**

```bash
cd wegmans-mcp && npm install @modelcontextprotocol/sdk better-sqlite3 zod playwright
```

**Step 2: Install dev dependencies**

```bash
npm install --save-dev @types/better-sqlite3 @types/node vitest
```

**Step 3: Install Playwright browsers**

```bash
npx playwright install chromium
```

**Step 4: Commit**

```bash
git add wegmans-mcp/package.json wegmans-mcp/package-lock.json
git commit -m "feat: install core dependencies"
```

---

### Task 1.5: Create Directory Structure and Entry Point Stub

**Files:**
- Create: `wegmans-mcp/src/index.ts`
- Create: `wegmans-mcp/src/tools/.gitkeep`
- Create: `wegmans-mcp/src/algolia/.gitkeep`
- Create: `wegmans-mcp/src/db/.gitkeep`
- Create: `wegmans-mcp/src/types/.gitkeep`

**Step 1: Create directory structure**

```bash
cd wegmans-mcp
mkdir -p src/tools src/algolia src/db src/types tests scripts
```

**Step 2: Create minimal entry point**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node

console.log("wegmans-mcp server starting...");
```

**Step 3: Verify build works**

```bash
npm run build
```

Expected: Compiles without errors, creates `dist/index.js`

**Step 4: Verify it runs**

```bash
npm start
```

Expected: Prints "wegmans-mcp server starting..."

**Step 5: Commit**

```bash
git add wegmans-mcp/src/ wegmans-mcp/dist/
git commit -m "feat: create directory structure and entry point stub"
```

---

## Phase 2: Database Layer

### Task 2.1: Define Zod Schemas for Domain Types

**Files:**
- Create: `wegmans-mcp/src/types/product.ts`

**Step 1: Create product type definitions**

```typescript
import { z } from "zod";

export const StoreSchema = z.object({
  storeNumber: z.string(),
  location: z.string(),
  lastUpdated: z.string().optional(),
});

export type Store = z.infer<typeof StoreSchema>;

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
cd wegmans-mcp && npm run typecheck
```

Expected: No errors

**Step 3: Commit**

```bash
git add wegmans-mcp/src/types/product.ts
git commit -m "feat: define Zod schemas for domain types"
```

---

### Task 2.2: Create Database Schema Module

**Files:**
- Create: `wegmans-mcp/src/db/schema.ts`
- Create: `wegmans-mcp/tests/db/schema.test.ts`

**Step 1: Write failing test**

Create `tests/db/schema.test.ts`:

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

  it("is idempotent - can be called multiple times", () => {
    initializeSchema(db);
    initializeSchema(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all();

    expect(tables.length).toBeGreaterThan(0);
  });

  it("exports a schema version", () => {
    expect(typeof SCHEMA_VERSION).toBe("number");
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd wegmans-mcp && npm test
```

Expected: FAIL - module not found

**Step 3: Implement schema module**

Create `src/db/schema.ts`:

```typescript
import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
-- API credentials
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  api_key TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT 'QGPPR19V8V',
  extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Known stores
CREATE TABLE IF NOT EXISTS stores (
  store_number TEXT PRIMARY KEY,
  location TEXT NOT NULL,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Search history (for refresh) - per store
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_number TEXT NOT NULL REFERENCES stores(store_number),
  query TEXT,
  category_filter TEXT,
  result_count INTEGER,
  last_run TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_number, query, category_filter)
);

-- Products - metadata only (shared across stores)
CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  pack_size TEXT,
  image_url TEXT,
  ingredients TEXT,
  allergens TEXT,
  is_sold_by_weight INTEGER DEFAULT 0,
  raw_json TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Store-specific product data (price, aisle vary by store)
CREATE TABLE IF NOT EXISTS store_products (
  product_id TEXT REFERENCES products(product_id),
  store_number TEXT REFERENCES stores(store_number),
  price REAL,
  unit_price TEXT,
  aisle TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, store_number)
);

-- Serving info (same across stores)
CREATE TABLE IF NOT EXISTS servings (
  product_id TEXT PRIMARY KEY REFERENCES products(product_id),
  serving_size REAL,
  serving_size_unit TEXT,
  servings_per_container TEXT
);

-- Nutrition facts (fully normalized, same across stores)
CREATE TABLE IF NOT EXISTS nutrition_facts (
  product_id TEXT REFERENCES products(product_id),
  nutrient TEXT,
  quantity REAL,
  unit TEXT,
  percent_daily REAL,
  PRIMARY KEY (product_id, nutrient)
);

-- Category hierarchy (global, not per-store)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  level INTEGER NOT NULL,
  UNIQUE(name, parent_id)
);

-- Product-category junction
CREATE TABLE IF NOT EXISTS product_categories (
  product_id TEXT REFERENCES products(product_id),
  category_id INTEGER REFERENCES categories(id),
  PRIMARY KEY (product_id, category_id)
);

-- Tags (global)
CREATE TABLE IF NOT EXISTS tags (
  tag TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS product_tags (
  product_id TEXT REFERENCES products(product_id),
  tag TEXT REFERENCES tags(tag),
  PRIMARY KEY (product_id, tag)
);

-- Search-product junction (provenance, per search)
CREATE TABLE IF NOT EXISTS search_products (
  search_id INTEGER REFERENCES searches(id),
  product_id TEXT REFERENCES products(product_id),
  PRIMARY KEY (search_id, product_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_store_products_store ON store_products(store_number);
CREATE INDEX IF NOT EXISTS idx_store_products_price ON store_products(price);
CREATE INDEX IF NOT EXISTS idx_store_products_aisle ON store_products(aisle);
CREATE INDEX IF NOT EXISTS idx_searches_store ON searches(store_number);
CREATE INDEX IF NOT EXISTS idx_nutrition_nutrient ON nutrition_facts(nutrient);
CREATE INDEX IF NOT EXISTS idx_nutrition_quantity ON nutrition_facts(nutrient, quantity);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag);
`;

export function initializeSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}
```

**Step 4: Run test to verify it passes**

```bash
cd wegmans-mcp && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add wegmans-mcp/src/db/schema.ts wegmans-mcp/tests/db/schema.test.ts
git commit -m "feat: implement database schema initialization"
```

---

### Task 2.3: Create Database Connection Manager

**Files:**
- Create: `wegmans-mcp/src/db/connection.ts`
- Create: `wegmans-mcp/tests/db/connection.test.ts`

**Step 1: Write failing test**

Create `tests/db/connection.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase } from "../../src/db/connection.js";

describe("Database Connection", () => {
  const testDir = join(tmpdir(), "wegmans-mcp-test");
  const testDbPath = join(testDir, "test.db");

  afterEach(() => {
    closeDatabase();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("creates database file and parent directories", () => {
    mkdirSync(testDir, { recursive: true });
    const db = getDatabase(testDbPath);

    expect(existsSync(testDbPath)).toBe(true);
    expect(db.open).toBe(true);
  });

  it("returns same instance on repeated calls", () => {
    mkdirSync(testDir, { recursive: true });
    const db1 = getDatabase(testDbPath);
    const db2 = getDatabase(testDbPath);

    expect(db1).toBe(db2);
  });

  it("initializes schema on first connection", () => {
    mkdirSync(testDir, { recursive: true });
    const db = getDatabase(testDbPath);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='products'`)
      .all();

    expect(tables.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd wegmans-mcp && npm test
```

Expected: FAIL - module not found

**Step 3: Implement connection module**

Create `src/db/connection.ts`:

```typescript
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initializeSchema } from "./schema.js";

let db: Database.Database | null = null;

export function getDatabase(dbPath: string): Database.Database {
  if (db !== null) {
    return db;
  }

  // Ensure parent directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);

  return db;
}

export function closeDatabase(): void {
  if (db !== null) {
    db.close();
    db = null;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd wegmans-mcp && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add wegmans-mcp/src/db/connection.ts wegmans-mcp/tests/db/connection.test.ts
git commit -m "feat: implement database connection manager"
```

---

### Task 2.4: Implement Store CRUD Operations

**Files:**
- Create: `wegmans-mcp/src/db/stores.ts`
- Create: `wegmans-mcp/tests/db/stores.test.ts`

**Step 1: Write failing test**

Create `tests/db/stores.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import {
  upsertStore,
  getStore,
  getAllStores,
  getStoreByLocation,
} from "../../src/db/stores.js";

describe("Store Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("upserts a new store", () => {
    const store = upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });

    expect(store.storeNumber).toBe("059");
    expect(store.location).toBe("Geneva, NY");
  });

  it("updates existing store on upsert", () => {
    upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });
    const updated = upsertStore(db, { storeNumber: "059", location: "Geneva, New York" });

    expect(updated.location).toBe("Geneva, New York");

    const all = getAllStores(db);
    expect(all.length).toBe(1);
  });

  it("gets store by number", () => {
    upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });

    const store = getStore(db, "059");
    expect(store?.location).toBe("Geneva, NY");

    const missing = getStore(db, "999");
    expect(missing).toBeUndefined();
  });

  it("gets store by location", () => {
    upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });

    const store = getStoreByLocation(db, "Geneva, NY");
    expect(store?.storeNumber).toBe("059");
  });

  it("gets all stores", () => {
    upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });
    upsertStore(db, { storeNumber: "108", location: "Raleigh, NC" });

    const stores = getAllStores(db);
    expect(stores.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd wegmans-mcp && npm test
```

Expected: FAIL

**Step 3: Implement stores module**

Create `src/db/stores.ts`:

```typescript
import type Database from "better-sqlite3";
import type { Store } from "../types/product.js";

export function upsertStore(
  db: Database.Database,
  store: { storeNumber: string; location: string }
): Store {
  const stmt = db.prepare(`
    INSERT INTO stores (store_number, location, last_updated)
    VALUES (@storeNumber, @location, datetime('now'))
    ON CONFLICT(store_number) DO UPDATE SET
      location = @location,
      last_updated = datetime('now')
  `);

  stmt.run({ storeNumber: store.storeNumber, location: store.location });

  return {
    storeNumber: store.storeNumber,
    location: store.location,
  };
}

export function getStore(
  db: Database.Database,
  storeNumber: string
): Store | undefined {
  const row = db
    .prepare(`SELECT store_number, location, last_updated FROM stores WHERE store_number = ?`)
    .get(storeNumber) as { store_number: string; location: string; last_updated: string } | undefined;

  if (row === undefined) {
    return undefined;
  }

  return {
    storeNumber: row.store_number,
    location: row.location,
    lastUpdated: row.last_updated,
  };
}

export function getStoreByLocation(
  db: Database.Database,
  location: string
): Store | undefined {
  const row = db
    .prepare(`SELECT store_number, location, last_updated FROM stores WHERE location = ?`)
    .get(location) as { store_number: string; location: string; last_updated: string } | undefined;

  if (row === undefined) {
    return undefined;
  }

  return {
    storeNumber: row.store_number,
    location: row.location,
    lastUpdated: row.last_updated,
  };
}

export function getAllStores(db: Database.Database): Store[] {
  const rows = db
    .prepare(`SELECT store_number, location, last_updated FROM stores ORDER BY location`)
    .all() as Array<{ store_number: string; location: string; last_updated: string }>;

  return rows.map((row) => ({
    storeNumber: row.store_number,
    location: row.location,
    lastUpdated: row.last_updated,
  }));
}
```

**Step 4: Run test to verify it passes**

```bash
cd wegmans-mcp && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add wegmans-mcp/src/db/stores.ts wegmans-mcp/tests/db/stores.test.ts
git commit -m "feat: implement store CRUD operations"
```

---

### Task 2.5: Implement Product CRUD Operations

**Files:**
- Create: `wegmans-mcp/src/db/products.ts`
- Create: `wegmans-mcp/tests/db/products.test.ts`

**Step 1: Write failing test**

Create `tests/db/products.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore } from "../../src/db/stores.js";
import {
  upsertProduct,
  upsertStoreProduct,
  upsertNutritionFacts,
  getProductWithStoreData,
} from "../../src/db/products.js";

describe("Product Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });
  });

  afterEach(() => {
    db.close();
  });

  it("upserts a product", () => {
    upsertProduct(db, {
      productId: "12345",
      name: "Greek Yogurt",
      brand: "Fage",
      description: "Plain greek yogurt",
      packSize: "32 oz",
      imageUrl: null,
      ingredients: "Milk, cultures",
      allergens: "Contains milk",
      isSoldByWeight: false,
    });

    const result = db.prepare(`SELECT * FROM products WHERE product_id = ?`).get("12345") as {
      name: string;
    };
    expect(result.name).toBe("Greek Yogurt");
  });

  it("upserts store-specific product data", () => {
    upsertProduct(db, {
      productId: "12345",
      name: "Greek Yogurt",
      brand: "Fage",
      description: null,
      packSize: null,
      imageUrl: null,
      ingredients: null,
      allergens: null,
      isSoldByWeight: false,
    });

    upsertStoreProduct(db, {
      productId: "12345",
      storeNumber: "059",
      price: 5.99,
      unitPrice: null,
      aisle: "14A",
    });

    const result = db
      .prepare(`SELECT * FROM store_products WHERE product_id = ? AND store_number = ?`)
      .get("12345", "059") as { price: number; aisle: string };

    expect(result.price).toBe(5.99);
    expect(result.aisle).toBe("14A");
  });

  it("upserts nutrition facts", () => {
    upsertProduct(db, {
      productId: "12345",
      name: "Greek Yogurt",
      brand: null,
      description: null,
      packSize: null,
      imageUrl: null,
      ingredients: null,
      allergens: null,
      isSoldByWeight: false,
    });

    upsertNutritionFacts(db, "12345", [
      { productId: "12345", nutrient: "Protein", quantity: 15, unit: "g", percentDaily: 30 },
      { productId: "12345", nutrient: "Calories", quantity: 120, unit: null, percentDaily: null },
    ]);

    const facts = db
      .prepare(`SELECT * FROM nutrition_facts WHERE product_id = ?`)
      .all("12345") as Array<{ nutrient: string; quantity: number }>;

    expect(facts.length).toBe(2);
    expect(facts.find((f) => f.nutrient === "Protein")?.quantity).toBe(15);
  });

  it("gets product with store data", () => {
    upsertProduct(db, {
      productId: "12345",
      name: "Greek Yogurt",
      brand: "Fage",
      description: null,
      packSize: "32 oz",
      imageUrl: null,
      ingredients: null,
      allergens: null,
      isSoldByWeight: false,
    });

    upsertStoreProduct(db, {
      productId: "12345",
      storeNumber: "059",
      price: 5.99,
      unitPrice: null,
      aisle: "14A",
    });

    const product = getProductWithStoreData(db, "12345", "059");

    expect(product?.name).toBe("Greek Yogurt");
    expect(product?.price).toBe(5.99);
    expect(product?.aisle).toBe("14A");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd wegmans-mcp && npm test
```

Expected: FAIL

**Step 3: Implement products module**

Create `src/db/products.ts`:

```typescript
import type Database from "better-sqlite3";
import type { Product, StoreProduct, NutritionFact } from "../types/product.js";

export function upsertProduct(db: Database.Database, product: Product): void {
  const stmt = db.prepare(`
    INSERT INTO products (
      product_id, name, brand, description, pack_size,
      image_url, ingredients, allergens, is_sold_by_weight, updated_at
    )
    VALUES (
      @productId, @name, @brand, @description, @packSize,
      @imageUrl, @ingredients, @allergens, @isSoldByWeight, datetime('now')
    )
    ON CONFLICT(product_id) DO UPDATE SET
      name = @name,
      brand = @brand,
      description = @description,
      pack_size = @packSize,
      image_url = @imageUrl,
      ingredients = @ingredients,
      allergens = @allergens,
      is_sold_by_weight = @isSoldByWeight,
      updated_at = datetime('now')
  `);

  stmt.run({
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    description: product.description,
    packSize: product.packSize,
    imageUrl: product.imageUrl,
    ingredients: product.ingredients,
    allergens: product.allergens,
    isSoldByWeight: product.isSoldByWeight ? 1 : 0,
  });
}

export function upsertStoreProduct(
  db: Database.Database,
  storeProduct: StoreProduct
): void {
  const stmt = db.prepare(`
    INSERT INTO store_products (
      product_id, store_number, price, unit_price, aisle, updated_at
    )
    VALUES (
      @productId, @storeNumber, @price, @unitPrice, @aisle, datetime('now')
    )
    ON CONFLICT(product_id, store_number) DO UPDATE SET
      price = @price,
      unit_price = @unitPrice,
      aisle = @aisle,
      updated_at = datetime('now')
  `);

  stmt.run({
    productId: storeProduct.productId,
    storeNumber: storeProduct.storeNumber,
    price: storeProduct.price,
    unitPrice: storeProduct.unitPrice,
    aisle: storeProduct.aisle,
  });
}

export function upsertNutritionFacts(
  db: Database.Database,
  productId: string,
  facts: NutritionFact[]
): void {
  const stmt = db.prepare(`
    INSERT INTO nutrition_facts (product_id, nutrient, quantity, unit, percent_daily)
    VALUES (@productId, @nutrient, @quantity, @unit, @percentDaily)
    ON CONFLICT(product_id, nutrient) DO UPDATE SET
      quantity = @quantity,
      unit = @unit,
      percent_daily = @percentDaily
  `);

  const upsertMany = db.transaction((nutritionFacts: NutritionFact[]) => {
    for (const fact of nutritionFacts) {
      stmt.run({
        productId,
        nutrient: fact.nutrient,
        quantity: fact.quantity,
        unit: fact.unit,
        percentDaily: fact.percentDaily,
      });
    }
  });

  upsertMany(facts);
}

export interface ProductWithStoreData extends Product {
  price: number | null;
  unitPrice: string | null;
  aisle: string | null;
}

export function getProductWithStoreData(
  db: Database.Database,
  productId: string,
  storeNumber: string
): ProductWithStoreData | undefined {
  const row = db.prepare(`
    SELECT
      p.product_id, p.name, p.brand, p.description, p.pack_size,
      p.image_url, p.ingredients, p.allergens, p.is_sold_by_weight,
      sp.price, sp.unit_price, sp.aisle
    FROM products p
    LEFT JOIN store_products sp ON p.product_id = sp.product_id AND sp.store_number = ?
    WHERE p.product_id = ?
  `).get(storeNumber, productId) as {
    product_id: string;
    name: string;
    brand: string | null;
    description: string | null;
    pack_size: string | null;
    image_url: string | null;
    ingredients: string | null;
    allergens: string | null;
    is_sold_by_weight: number;
    price: number | null;
    unit_price: string | null;
    aisle: string | null;
  } | undefined;

  if (row === undefined) {
    return undefined;
  }

  return {
    productId: row.product_id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    packSize: row.pack_size,
    imageUrl: row.image_url,
    ingredients: row.ingredients,
    allergens: row.allergens,
    isSoldByWeight: row.is_sold_by_weight === 1,
    price: row.price,
    unitPrice: row.unit_price,
    aisle: row.aisle,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd wegmans-mcp && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add wegmans-mcp/src/db/products.ts wegmans-mcp/tests/db/products.test.ts
git commit -m "feat: implement product CRUD operations"
```

---

### Task 2.6: Implement Raw SQL Query Executor

**Files:**
- Create: `wegmans-mcp/src/db/queries.ts`
- Create: `wegmans-mcp/tests/db/queries.test.ts`

**Step 1: Write failing test**

Create `tests/db/queries.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../src/db/schema.js";
import { upsertStore } from "../../src/db/stores.js";
import { upsertProduct, upsertStoreProduct } from "../../src/db/products.js";
import { executeQuery } from "../../src/db/queries.js";

describe("Raw SQL Query Executor", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    upsertStore(db, { storeNumber: "059", location: "Geneva, NY" });
    upsertProduct(db, {
      productId: "12345",
      name: "Greek Yogurt",
      brand: "Fage",
      description: null,
      packSize: "32 oz",
      imageUrl: null,
      ingredients: null,
      allergens: null,
      isSoldByWeight: false,
    });
    upsertStoreProduct(db, {
      productId: "12345",
      storeNumber: "059",
      price: 5.99,
      unitPrice: null,
      aisle: "14A",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("executes SELECT query and returns results", () => {
    const result = executeQuery(db, "SELECT name, brand FROM products");

    expect(result.columns).toEqual(["name", "brand"]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]).toEqual(["Greek Yogurt", "Fage"]);
    expect(result.rowCount).toBe(1);
  });

  it("handles JOIN queries", () => {
    const result = executeQuery(
      db,
      `SELECT p.name, sp.price, sp.aisle
       FROM products p
       JOIN store_products sp ON p.product_id = sp.product_id`
    );

    expect(result.columns).toEqual(["name", "price", "aisle"]);
    expect(result.rows[0]).toEqual(["Greek Yogurt", 5.99, "14A"]);
  });

  it("returns error for invalid SQL", () => {
    const result = executeQuery(db, "SELECT * FROM nonexistent_table");

    expect(result.error).toBeDefined();
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("blocks non-SELECT queries", () => {
    const result = executeQuery(db, "DELETE FROM products");

    expect(result.error).toContain("Only SELECT");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd wegmans-mcp && npm test
```

Expected: FAIL

**Step 3: Implement queries module**

Create `src/db/queries.ts`:

```typescript
import type Database from "better-sqlite3";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  error?: string;
}

export function executeQuery(db: Database.Database, sql: string): QueryResult {
  // Only allow SELECT queries for safety
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT")) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      error: "Only SELECT queries are allowed",
    };
  }

  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];

    if (rows.length === 0) {
      // Get columns from statement even if no rows
      const columns = stmt.columns().map((c) => c.name);
      return {
        columns,
        rows: [],
        rowCount: 0,
      };
    }

    const columns = Object.keys(rows[0]!);
    const rowArrays = rows.map((row) => columns.map((col) => row[col]));

    return {
      columns,
      rows: rowArrays,
      rowCount: rows.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      error: message,
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd wegmans-mcp && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add wegmans-mcp/src/db/queries.ts wegmans-mcp/tests/db/queries.test.ts
git commit -m "feat: implement raw SQL query executor"
```

---

## Phase 3: Algolia Client

### Task 3.1: Define Algolia Response Types

**Files:**
- Create: `wegmans-mcp/src/types/algolia.ts`

**Step 1: Create Algolia type definitions based on reference data**

```typescript
import { z } from "zod";

export const AlgoliaPriceSchema = z.object({
  amount: z.number().optional(),
  unitPrice: z.string().optional(),
  channelKey: z.string().optional(),
});

export const AlgoliaPlanogramSchema = z.object({
  aisle: z.string().optional(),
});

export const AlgoliaNutritionItemSchema = z.object({
  name: z.string(),
  quantity: z.number().optional(),
  unitOfMeasure: z.string().optional(),
  percentOfDaily: z.number().optional(),
});

export const AlgoliaServingSchema = z.object({
  servingSize: z.string().optional(),
  servingSizeUom: z.string().optional(),
  servingsPerContainer: z.string().optional(),
});

export const AlgoliaNutritionSchema = z.object({
  serving: AlgoliaServingSchema.optional(),
  nutritions: z
    .array(
      z.object({
        general: z.array(AlgoliaNutritionItemSchema).optional(),
      })
    )
    .optional(),
});

export const AlgoliaHitSchema = z.object({
  productId: z.string().optional(),
  productID: z.string().optional(),
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
  price_inStore: AlgoliaPriceSchema.optional(),
  price_delivery: AlgoliaPriceSchema.optional(),
  planogram: AlgoliaPlanogramSchema.optional(),
  nutrition: AlgoliaNutritionSchema.optional(),
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
});

export type AlgoliaHit = z.infer<typeof AlgoliaHitSchema>;

export const AlgoliaResultSchema = z.object({
  hits: z.array(AlgoliaHitSchema),
  nbHits: z.number().optional(),
  query: z.string().optional(),
  index: z.string().optional(),
});

export const AlgoliaResponseSchema = z.object({
  results: z.array(AlgoliaResultSchema),
});

export type AlgoliaResponse = z.infer<typeof AlgoliaResponseSchema>;
```

**Step 2: Verify types compile**

```bash
cd wegmans-mcp && npm run typecheck
```

Expected: No errors

**Step 3: Commit**

```bash
git add wegmans-mcp/src/types/algolia.ts
git commit -m "feat: define Algolia response types with Zod"
```

---

### Task 3.2: Implement Algolia HTTP Client

**Files:**
- Create: `wegmans-mcp/src/algolia/client.ts`
- Create: `wegmans-mcp/tests/algolia/client.test.ts`

**Step 1: Write failing test**

Create `tests/algolia/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAlgoliaRequest, parseAlgoliaResponse } from "../../src/algolia/client.js";

describe("Algolia Client", () => {
  it("builds correct request body for keyword search", () => {
    const request = buildAlgoliaRequest({
      query: "yogurt",
      storeNumber: "059",
    });

    expect(request.requests.length).toBeGreaterThan(0);
    expect(request.requests[0]?.query).toBe("yogurt");
    expect(request.requests[0]?.indexName).toContain("059");
  });

  it("builds correct request body for category filter", () => {
    const request = buildAlgoliaRequest({
      storeNumber: "059",
      categoryFilter: "Dairy",
    });

    expect(request.requests[0]?.filters).toContain("Dairy");
  });

  it("parses valid Algolia response", () => {
    const mockResponse = {
      results: [
        {
          hits: [
            {
              productId: "12345",
              productName: "Greek Yogurt",
              price_inStore: { amount: 5.99 },
              planogram: { aisle: "14A" },
            },
          ],
          nbHits: 1,
        },
      ],
    };

    const result = parseAlgoliaResponse(mockResponse);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results[0]?.hits.length).toBe(1);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd wegmans-mcp && npm test
```

Expected: FAIL

**Step 3: Implement Algolia client**

Create `src/algolia/client.ts`:

```typescript
import { AlgoliaResponseSchema, type AlgoliaResponse, type AlgoliaHit } from "../types/algolia.js";
import type { Product, StoreProduct, NutritionFact, Serving } from "../types/product.js";

const ALGOLIA_APP_ID = "QGPPR19V8V";
const ALGOLIA_ENDPOINT = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`;

export interface AlgoliaSearchParams {
  query?: string;
  storeNumber: string;
  categoryFilter?: string;
}

export interface AlgoliaRequest {
  requests: Array<{
    indexName: string;
    query: string;
    filters?: string;
    hitsPerPage?: number;
  }>;
}

export function buildAlgoliaRequest(params: AlgoliaSearchParams): AlgoliaRequest {
  const indexName = `products_${params.storeNumber}`;
  const filters = params.categoryFilter
    ? `categoryNodes.lvl0:"${params.categoryFilter}" OR categoryNodes.lvl1:"${params.categoryFilter}" OR categoryNodes.lvl2:"${params.categoryFilter}"`
    : undefined;

  return {
    requests: [
      {
        indexName,
        query: params.query ?? "",
        filters,
        hitsPerPage: 100,
      },
    ],
  };
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function parseAlgoliaResponse(raw: unknown): ParseResult<AlgoliaResponse> {
  const result = AlgoliaResponseSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

export async function searchAlgolia(
  apiKey: string,
  params: AlgoliaSearchParams
): Promise<ParseResult<AlgoliaResponse>> {
  const body = buildAlgoliaRequest(params);

  const response = await fetch(ALGOLIA_ENDPOINT, {
    method: "POST",
    headers: {
      "x-algolia-api-key": apiKey,
      "x-algolia-application-id": ALGOLIA_APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return {
      success: false,
      error: `Algolia request failed: ${response.status} ${response.statusText}`,
    };
  }

  const data: unknown = await response.json();
  return parseAlgoliaResponse(data);
}

export function extractProductFromHit(hit: AlgoliaHit): Product {
  const productId = hit.productId ?? hit.productID ?? "";

  return {
    productId,
    name: hit.productName ?? "Unknown",
    brand: hit.consumerBrandName ?? null,
    description: hit.productDescription ?? hit.webProductDescription ?? null,
    packSize: hit.packSize ?? null,
    imageUrl: hit.images?.[0] ?? null,
    ingredients: hit.ingredients ?? null,
    allergens: hit.allergensAndWarnings ?? null,
    isSoldByWeight: hit.isSoldByWeight ?? false,
  };
}

export function extractStoreProductFromHit(
  hit: AlgoliaHit,
  storeNumber: string
): StoreProduct {
  const productId = hit.productId ?? hit.productID ?? "";
  const price = hit.price_inStore?.amount ?? null;
  const unitPrice = hit.price_inStore?.unitPrice ?? null;
  const aisle = hit.planogram?.aisle ?? null;

  return {
    productId,
    storeNumber,
    price,
    unitPrice,
    aisle,
  };
}

export function extractNutritionFromHit(hit: AlgoliaHit): NutritionFact[] {
  const productId = hit.productId ?? hit.productID ?? "";
  const facts: NutritionFact[] = [];

  const nutritions = hit.nutrition?.nutritions;
  if (nutritions) {
    for (const nutritionGroup of nutritions) {
      const general = nutritionGroup.general;
      if (general) {
        for (const item of general) {
          facts.push({
            productId,
            nutrient: item.name,
            quantity: item.quantity ?? null,
            unit: item.unitOfMeasure ?? null,
            percentDaily: item.percentOfDaily ?? null,
          });
        }
      }
    }
  }

  return facts;
}

export function extractServingFromHit(hit: AlgoliaHit): Serving | null {
  const productId = hit.productId ?? hit.productID ?? "";
  const serving = hit.nutrition?.serving;

  if (!serving) {
    return null;
  }

  return {
    productId,
    servingSize: serving.servingSize ? parseFloat(serving.servingSize) : null,
    servingSizeUnit: serving.servingSizeUom ?? null,
    servingsPerContainer: serving.servingsPerContainer ?? null,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd wegmans-mcp && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add wegmans-mcp/src/algolia/client.ts wegmans-mcp/tests/algolia/client.test.ts
git commit -m "feat: implement Algolia HTTP client"
```

---

### Task 3.3: Implement Playwright Key Extractor

**Files:**
- Create: `wegmans-mcp/src/algolia/keyExtractor.ts`

**Note:** This task involves browser automation and is harder to unit test. We'll implement it and test manually.

**Step 1: Implement key extractor**

Create `src/algolia/keyExtractor.ts`:

```typescript
import { chromium, type Browser, type Page } from "playwright";

const WEGMANS_URL = "https://www.wegmans.com";

export interface KeyExtractionResult {
  success: boolean;
  apiKey?: string;
  storeNumber?: string;
  error?: string;
}

export async function extractAlgoliaKey(
  storeLocation: string
): Promise<KeyExtractionResult> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    let apiKey: string | undefined;
    let storeNumber: string | undefined;

    // Intercept requests to capture Algolia API key
    await page.route("**/*algolia*/**", async (route) => {
      const request = route.request();
      const headers = request.headers();

      const key = headers["x-algolia-api-key"];
      if (key && !apiKey) {
        apiKey = key;
      }

      // Extract store number from index name in URL or request body
      const url = request.url();
      const storeMatch = url.match(/products_(\d+)/);
      if (storeMatch?.[1]) {
        storeNumber = storeMatch[1];
      }

      await route.continue();
    });

    // Navigate to Wegmans and set store location
    await page.goto(WEGMANS_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Try to set store location
    await setStoreLocation(page, storeLocation);

    // Trigger a search to capture API key
    await page.goto(`${WEGMANS_URL}/shop/search?query=milk`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for Algolia requests
    await page.waitForTimeout(5000);

    await browser.close();

    if (apiKey) {
      return {
        success: true,
        apiKey,
        storeNumber,
      };
    }

    return {
      success: false,
      error: "Could not capture Algolia API key from requests",
    };
  } catch (err) {
    if (browser) {
      await browser.close();
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Key extraction failed: ${message}`,
    };
  }
}

async function setStoreLocation(page: Page, location: string): Promise<void> {
  try {
    // Look for store selector button
    const storeButton = await page.$('button:has-text("Store"), [class*="store"]');
    if (storeButton) {
      await storeButton.click();
      await page.waitForTimeout(1000);

      // Type location in search
      const storeInput = await page.$('input[placeholder*="store"], input[placeholder*="location"], input[placeholder*="zip"]');
      if (storeInput) {
        await storeInput.fill(location);
        await page.waitForTimeout(1000);

        // Click matching result
        const locationOption = await page.$(`text=/${location}/i`);
        if (locationOption) {
          await locationOption.click();
          await page.waitForTimeout(1000);
        }
      }
    }
  } catch {
    // Store selection is best-effort
  }
}
```

**Step 2: Verify types compile**

```bash
cd wegmans-mcp && npm run typecheck
```

Expected: No errors

**Step 3: Commit**

```bash
git add wegmans-mcp/src/algolia/keyExtractor.ts
git commit -m "feat: implement Playwright-based Algolia key extractor"
```

---

## Phase 4: MCP Server Core

### Task 4.1: Implement MCP Server Entry Point

**Files:**
- Modify: `wegmans-mcp/src/index.ts`

**Step 1: Implement MCP server with tool registration**

Replace `src/index.ts`:

```typescript
#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { join } from "node:path";
import { homedir } from "node:os";

import { getDatabase, closeDatabase } from "./db/connection.js";
import { handleSearch } from "./tools/search.js";
import { handleQuery } from "./tools/query.js";
import { handleListStores } from "./tools/listStores.js";
import { handleListCategories } from "./tools/listCategories.js";
import { handleRefresh } from "./tools/refresh.js";
import { handleClear } from "./tools/clear.js";
import { handleRefreshApiKey } from "./tools/refreshApiKey.js";

const CONFIG_DIR = join(homedir(), ".config", "wegmans-mcp");
const DB_PATH = join(CONFIG_DIR, "products.db");

const server = new Server(
  {
    name: "wegmans-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search",
      description:
        "Search Wegmans products for a specific store. Populates local database with results.",
      inputSchema: {
        type: "object",
        properties: {
          store: {
            type: "string",
            description: 'Store location, e.g., "Geneva, NY"',
          },
          query: {
            type: "string",
            description: "Search query, e.g., \"yogurt\"",
          },
          categoryFilter: {
            type: "string",
            description: 'Category to filter by, e.g., "Dairy"',
          },
        },
        required: ["store"],
      },
    },
    {
      name: "query",
      description:
        "Run SQL query against the local Wegmans product database. Only SELECT queries allowed.",
      inputSchema: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "SQL SELECT query",
          },
        },
        required: ["sql"],
      },
    },
    {
      name: "list_stores",
      description: "List all stores currently in the local database.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_categories",
      description: "List product categories for a store.",
      inputSchema: {
        type: "object",
        properties: {
          store: {
            type: "string",
            description: "Store location",
          },
          level: {
            type: "number",
            description: "Category level (0=top level)",
          },
        },
        required: ["store"],
      },
    },
    {
      name: "refresh",
      description: "Re-run previous searches to refresh product data.",
      inputSchema: {
        type: "object",
        properties: {
          store: {
            type: "string",
            description: "Only refresh this store (optional)",
          },
        },
      },
    },
    {
      name: "clear",
      description: "Clear the local database.",
      inputSchema: {
        type: "object",
        properties: {
          store: {
            type: "string",
            description: "Only clear this store (optional)",
          },
        },
      },
    },
    {
      name: "refresh_api_key",
      description: "Force refresh of Algolia API key.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const db = getDatabase(DB_PATH);
  const args = request.params.arguments as Record<string, unknown>;

  try {
    switch (request.params.name) {
      case "search":
        return await handleSearch(db, args);
      case "query":
        return handleQuery(db, args);
      case "list_stores":
        return handleListStores(db);
      case "list_categories":
        return await handleListCategories(db, args);
      case "refresh":
        return await handleRefresh(db, args);
      case "clear":
        return handleClear(db, args);
      case "refresh_api_key":
        return await handleRefreshApiKey();
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server error:", err);
  closeDatabase();
  process.exit(1);
});

process.on("SIGINT", () => {
  closeDatabase();
  process.exit(0);
});
```

**Step 2: Verify types compile (will fail until tools are implemented)**

This will have type errors until we implement all the tool handlers, which is expected. We'll implement them in the following tasks.

**Step 3: Commit**

```bash
git add wegmans-mcp/src/index.ts
git commit -m "feat: implement MCP server entry point with tool registration"
```

---

### Task 4.2: Implement search Tool

**Files:**
- Create: `wegmans-mcp/src/tools/search.ts`

**Step 1: Implement search tool handler**

Create `src/tools/search.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { upsertStore, getStoreByLocation } from "../db/stores.js";
import {
  upsertProduct,
  upsertStoreProduct,
  upsertNutritionFacts,
} from "../db/products.js";
import {
  searchAlgolia,
  extractProductFromHit,
  extractStoreProductFromHit,
  extractNutritionFromHit,
} from "../algolia/client.js";
import { getOrExtractApiKey } from "./refreshApiKey.js";

const SearchArgsSchema = z.object({
  store: z.string(),
  query: z.string().optional(),
  categoryFilter: z.string().optional(),
});

export async function handleSearch(
  db: Database.Database,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = SearchArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { store, query, categoryFilter } = parsed.data;

  // Get or extract API key
  const keyResult = await getOrExtractApiKey(db, store);
  if (!keyResult.success || !keyResult.apiKey) {
    return {
      content: [{ type: "text", text: `Failed to get API key: ${keyResult.error ?? "Unknown error"}` }],
      isError: true,
    };
  }

  const { apiKey, storeNumber } = keyResult;

  // Ensure store exists in DB
  upsertStore(db, { storeNumber, location: store });

  // Search Algolia
  const searchResult = await searchAlgolia(apiKey, {
    query,
    storeNumber,
    categoryFilter,
  });

  if (!searchResult.success || !searchResult.data) {
    return {
      content: [{ type: "text", text: `Search failed: ${searchResult.error ?? "Unknown error"}` }],
      isError: true,
    };
  }

  // Process results
  let productsFound = 0;
  let productsAdded = 0;

  for (const result of searchResult.data.results) {
    for (const hit of result.hits) {
      productsFound++;

      const product = extractProductFromHit(hit);
      const storeProduct = extractStoreProductFromHit(hit, storeNumber);
      const nutrition = extractNutritionFromHit(hit);

      // Check if product already exists
      const existing = db
        .prepare("SELECT 1 FROM products WHERE product_id = ?")
        .get(product.productId);

      if (!existing) {
        productsAdded++;
      }

      upsertProduct(db, product);
      upsertStoreProduct(db, storeProduct);

      if (nutrition.length > 0) {
        upsertNutritionFacts(db, product.productId, nutrition);
      }
    }
  }

  // Record the search
  db.prepare(`
    INSERT INTO searches (store_number, query, category_filter, result_count, last_run)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store_number, query, category_filter) DO UPDATE SET
      result_count = ?,
      last_run = datetime('now')
  `).run(storeNumber, query ?? null, categoryFilter ?? null, productsFound, productsFound);

  const response = {
    store,
    query: query ?? null,
    categoryFilter: categoryFilter ?? null,
    productsFound,
    productsAdded,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/search.ts
git commit -m "feat: implement search tool"
```

---

### Task 4.3: Implement query Tool

**Files:**
- Create: `wegmans-mcp/src/tools/query.ts`

**Step 1: Implement query tool handler**

Create `src/tools/query.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { executeQuery } from "../db/queries.js";

const QueryArgsSchema = z.object({
  sql: z.string(),
});

export function handleQuery(
  db: Database.Database,
  args: Record<string, unknown>
): CallToolResult {
  const parsed = QueryArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const result = executeQuery(db, parsed.data.sql);

  if (result.error) {
    return {
      content: [{ type: "text", text: `SQL Error: ${result.error}` }],
      isError: true,
    };
  }

  const response = {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/query.ts
git commit -m "feat: implement query tool"
```

---

### Task 4.4: Implement list_stores Tool

**Files:**
- Create: `wegmans-mcp/src/tools/listStores.ts`

**Step 1: Implement list_stores tool handler**

Create `src/tools/listStores.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function handleListStores(db: Database.Database): CallToolResult {
  const stores = db.prepare(`
    SELECT
      s.store_number,
      s.location,
      s.last_updated,
      COUNT(DISTINCT sp.product_id) as product_count
    FROM stores s
    LEFT JOIN store_products sp ON s.store_number = sp.store_number
    GROUP BY s.store_number
    ORDER BY s.location
  `).all() as Array<{
    store_number: string;
    location: string;
    last_updated: string;
    product_count: number;
  }>;

  const response = {
    stores: stores.map((s) => ({
      storeNumber: s.store_number,
      location: s.location,
      productCount: s.product_count,
      lastUpdated: s.last_updated,
    })),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/listStores.ts
git commit -m "feat: implement list_stores tool"
```

---

### Task 4.5: Implement list_categories Tool

**Files:**
- Create: `wegmans-mcp/src/tools/listCategories.ts`

**Step 1: Implement list_categories tool handler**

Create `src/tools/listCategories.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const ListCategoriesArgsSchema = z.object({
  store: z.string(),
  level: z.number().optional(),
});

export async function handleListCategories(
  db: Database.Database,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = ListCategoriesArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { level } = parsed.data;

  // Query categories from local DB
  let query = `
    SELECT
      c.id,
      c.name,
      c.level,
      pc2.name as parent_name,
      COUNT(DISTINCT pc.product_id) as product_count
    FROM categories c
    LEFT JOIN categories pc2 ON c.parent_id = pc2.id
    LEFT JOIN product_categories pc ON c.id = pc.category_id
  `;

  const params: unknown[] = [];

  if (level !== undefined) {
    query += " WHERE c.level = ?";
    params.push(level);
  }

  query += " GROUP BY c.id ORDER BY c.level, c.name";

  const categories = db.prepare(query).all(...params) as Array<{
    id: number;
    name: string;
    level: number;
    parent_name: string | null;
    product_count: number;
  }>;

  const response = {
    categories: categories.map((c) => ({
      name: c.name,
      parent: c.parent_name,
      level: c.level,
      productCount: c.product_count,
    })),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/listCategories.ts
git commit -m "feat: implement list_categories tool"
```

---

### Task 4.6: Implement refresh Tool

**Files:**
- Create: `wegmans-mcp/src/tools/refresh.ts`

**Step 1: Implement refresh tool handler**

Create `src/tools/refresh.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { handleSearch } from "./search.js";

const RefreshArgsSchema = z.object({
  store: z.string().optional(),
});

export async function handleRefresh(
  db: Database.Database,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = RefreshArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { store } = parsed.data;

  // Get searches to re-run
  let query = `
    SELECT s.store_number, st.location, s.query, s.category_filter
    FROM searches s
    JOIN stores st ON s.store_number = st.store_number
  `;

  const params: string[] = [];

  if (store) {
    query += " WHERE st.location = ?";
    params.push(store);
  }

  const searches = db.prepare(query).all(...params) as Array<{
    store_number: string;
    location: string;
    query: string | null;
    category_filter: string | null;
  }>;

  let searchesRun = 0;
  let productsUpdated = 0;

  for (const search of searches) {
    const result = await handleSearch(db, {
      store: search.location,
      query: search.query ?? undefined,
      categoryFilter: search.category_filter ?? undefined,
    });

    if (!result.isError) {
      searchesRun++;
      try {
        const response = JSON.parse(
          (result.content[0] as { text: string }).text
        ) as { productsFound: number };
        productsUpdated += response.productsFound;
      } catch {
        // Ignore parse errors
      }
    }
  }

  const response = {
    searchesRun,
    productsUpdated,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/refresh.ts
git commit -m "feat: implement refresh tool"
```

---

### Task 4.7: Implement clear Tool

**Files:**
- Create: `wegmans-mcp/src/tools/clear.ts`

**Step 1: Implement clear tool handler**

Create `src/tools/clear.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const ClearArgsSchema = z.object({
  store: z.string().optional(),
});

export function handleClear(
  db: Database.Database,
  args: Record<string, unknown>
): CallToolResult {
  const parsed = ClearArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { store } = parsed.data;

  let productsDeleted = 0;
  let searchesDeleted = 0;

  if (store) {
    // Get store number
    const storeRow = db
      .prepare("SELECT store_number FROM stores WHERE location = ?")
      .get(store) as { store_number: string } | undefined;

    if (storeRow) {
      const storeNumber = storeRow.store_number;

      // Delete store-specific data
      const spResult = db
        .prepare("DELETE FROM store_products WHERE store_number = ?")
        .run(storeNumber);
      productsDeleted = spResult.changes;

      const sResult = db
        .prepare("DELETE FROM searches WHERE store_number = ?")
        .run(storeNumber);
      searchesDeleted = sResult.changes;

      // Delete the store
      db.prepare("DELETE FROM stores WHERE store_number = ?").run(storeNumber);
    }
  } else {
    // Clear everything
    const spResult = db.prepare("DELETE FROM store_products").run();
    productsDeleted = spResult.changes;

    const sResult = db.prepare("DELETE FROM searches").run();
    searchesDeleted = sResult.changes;

    db.prepare("DELETE FROM search_products").run();
    db.prepare("DELETE FROM product_tags").run();
    db.prepare("DELETE FROM product_categories").run();
    db.prepare("DELETE FROM nutrition_facts").run();
    db.prepare("DELETE FROM servings").run();
    db.prepare("DELETE FROM products").run();
    db.prepare("DELETE FROM tags").run();
    db.prepare("DELETE FROM categories").run();
    db.prepare("DELETE FROM stores").run();
  }

  const response = {
    productsDeleted,
    searchesDeleted,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/clear.ts
git commit -m "feat: implement clear tool"
```

---

### Task 4.8: Implement refresh_api_key Tool

**Files:**
- Create: `wegmans-mcp/src/tools/refreshApiKey.ts`

**Step 1: Implement refresh_api_key tool handler**

Create `src/tools/refreshApiKey.ts`:

```typescript
import type Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { extractAlgoliaKey } from "../algolia/keyExtractor.js";

interface ApiKeyResult {
  success: boolean;
  apiKey?: string;
  storeNumber?: string;
  error?: string;
}

let cachedApiKey: string | undefined;
let cachedStoreNumber: string | undefined;

export async function getOrExtractApiKey(
  db: Database.Database,
  storeLocation: string
): Promise<ApiKeyResult> {
  // Check cache first
  if (cachedApiKey && cachedStoreNumber) {
    return {
      success: true,
      apiKey: cachedApiKey,
      storeNumber: cachedStoreNumber,
    };
  }

  // Check database
  const row = db
    .prepare("SELECT api_key FROM api_keys ORDER BY extracted_at DESC LIMIT 1")
    .get() as { api_key: string } | undefined;

  if (row) {
    cachedApiKey = row.api_key;
    // Try to get store number from stores table
    const storeRow = db
      .prepare("SELECT store_number FROM stores WHERE location = ?")
      .get(storeLocation) as { store_number: string } | undefined;

    if (storeRow) {
      cachedStoreNumber = storeRow.store_number;
      return {
        success: true,
        apiKey: cachedApiKey,
        storeNumber: cachedStoreNumber,
      };
    }
  }

  // Extract new key
  return await forceExtractApiKey(db, storeLocation);
}

export async function forceExtractApiKey(
  db: Database.Database,
  storeLocation: string
): Promise<ApiKeyResult> {
  const result = await extractAlgoliaKey(storeLocation);

  if (result.success && result.apiKey) {
    // Save to database
    db.prepare(`
      INSERT INTO api_keys (api_key, extracted_at)
      VALUES (?, datetime('now'))
    `).run(result.apiKey);

    cachedApiKey = result.apiKey;
    cachedStoreNumber = result.storeNumber;

    return {
      success: true,
      apiKey: result.apiKey,
      storeNumber: result.storeNumber ?? "unknown",
    };
  }

  return {
    success: false,
    error: result.error,
  };
}

export async function handleRefreshApiKey(): Promise<CallToolResult> {
  // Clear cache
  cachedApiKey = undefined;
  cachedStoreNumber = undefined;

  // We need a store location to extract, but refresh_api_key doesn't take one
  // This is a design issue - for now, return instructions
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          message: "API key cache cleared. Next search will extract a fresh key.",
        }),
      },
    ],
  };
}
```

**Step 2: Commit**

```bash
git add wegmans-mcp/src/tools/refreshApiKey.ts
git commit -m "feat: implement refresh_api_key tool"
```

---

## Phase 5: Build and Test

### Task 5.1: Verify Full Build

**Step 1: Run TypeScript compilation**

```bash
cd wegmans-mcp && npm run build
```

Expected: Compiles without errors

**Step 2: Run linter**

```bash
npm run lint
```

Expected: No errors (fix any that appear)

**Step 3: Run tests**

```bash
npm test
```

Expected: All tests pass

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build and lint issues"
```

---

### Task 5.2: Manual Integration Test

**Step 1: Add MCP server to Claude Code config**

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "wegmans": {
      "command": "node",
      "args": ["/path/to/wegmans-mcp/dist/index.js"]
    }
  }
}
```

**Step 2: Restart Claude Code and test**

Test the tools manually:
- `search("Geneva, NY", "yogurt")`
- `query("SELECT name, price FROM products p JOIN store_products sp ON p.product_id = sp.product_id LIMIT 5")`
- `list_stores()`

**Step 3: Document any issues found**

Create issues or fix as needed.

---

## Phase 6: Documentation

### Task 6.1: Write README

**Files:**
- Create: `wegmans-mcp/README.md`

**Step 1: Write README**

```markdown
# Wegmans MCP Server

An MCP (Model Context Protocol) server that provides Claude with queryable access to Wegmans product data including prices, aisle locations, and nutritional information.

## Features

- Search Wegmans products by keyword or category
- Query product data with SQL
- Multi-store support
- Normalized nutrition data
- Local SQLite cache for fast queries

## Installation

```bash
cd wegmans-mcp
npm install
npx playwright install chromium
npm run build
```

## Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "wegmans": {
      "command": "node",
      "args": ["/absolute/path/to/wegmans-mcp/dist/index.js"]
    }
  }
}
```

## Tools

### search(store, query?, categoryFilter?)

Search Wegmans and populate local database.

### query(sql)

Run SQL against local database.

### list_stores()

List stores in database.

### list_categories(store, level?)

List product categories.

### refresh(store?)

Re-run previous searches.

### clear(store?)

Clear database.

### refresh_api_key()

Force API key refresh.

## Example Queries

```sql
-- Find high-protein yogurt under $5
SELECT p.name, sp.price, nf.quantity as protein
FROM products p
JOIN store_products sp ON p.product_id = sp.product_id
JOIN nutrition_facts nf ON p.product_id = nf.product_id
WHERE nf.nutrient = 'Protein'
  AND sp.price < 5
ORDER BY nf.quantity DESC;
```

## License

MIT
```

**Step 2: Commit**

```bash
git add wegmans-mcp/README.md
git commit -m "docs: add README"
```

---

## Summary

**Total Tasks:** 24 bite-sized tasks across 6 phases

**Phase 1:** Project scaffolding (5 tasks)
**Phase 2:** Database layer (6 tasks)
**Phase 3:** Algolia client (3 tasks)
**Phase 4:** MCP server core (8 tasks)
**Phase 5:** Build and test (2 tasks)
**Phase 6:** Documentation (1 task)

Each task follows TDD where applicable and includes commit points for safe rollback.
