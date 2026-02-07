# Connection Pool with Inode-Based Invalidation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the singleton "active store" connection manager with a multi-store connection pool that automatically detects when a database file has been atomically swapped and reopens the connection.

**Architecture:** The connection manager becomes a `Map<storeNumber, CachedConnection>` where each entry tracks the inode of the file at open time. On every `getStoreDb(storeNumber)` call, `statSync` the path and compare inodes — if the file was swapped (different inode), close the stale connection and open a fresh one. An LRU eviction policy caps the number of simultaneously open connections.

**Tech Stack:** better-sqlite3, Node.js `fs.statSync`/`fs.existsSync`, vitest

---

### Task 1: Write failing tests for inode-based connection invalidation

This is the core new behavior. The connection manager must detect when the underlying file has been replaced by a new file (different inode) and transparently reopen.

**Files:**
- Modify: `tests/db/connection.test.ts`

**Step 1: Write the failing tests**

Add a new `describe` block at the end of the existing test file (before the closing `});` of the outer describe):

```typescript
describe("inode-based invalidation", () => {
  beforeEach(() => {
    openDatabases(testDir);
  });

  it("detects file swap and reopens connection", () => {
    openStoreDatabase(testDir, "74");
    const { readonlyDb: db1 } = getStoreDataDb("74");

    // Write a marker row into the original database
    const { db: rwDb } = getStoreDataDb("74");
    rwDb.exec(
      `INSERT INTO products (product_id, name) VALUES ('marker', 'Original')`
    );

    // Atomically swap the file: write a new db, rename over the old one
    const storePath = join(testDir, "stores", "74.db");
    const tmpPath = storePath + ".tmp";
    const tmpDb = new (await import("better-sqlite3")).default(tmpPath);
    // Need to use the sync import that's already in the test file
    // Actually we already import Database at the top
    // We'll adjust the import in the step — for now, describe the intent:
    // Create a fresh database at tmpPath, initialize schema, add different marker
    // renameSync(tmpPath, storePath) to atomically swap
    // Then getStoreDataDb("74") should return a connection to the NEW file

    // The next call should detect the inode change and reopen
    const { readonlyDb: db2 } = getStoreDataDb("74");

    // Should see the new database (no 'marker' row, has 'swapped' row)
    const rows = db2
      .prepare(`SELECT product_id FROM products`)
      .all() as Array<{ product_id: string }>;
    const ids = rows.map((r) => r.product_id);
    expect(ids).not.toContain("marker");
    expect(ids).toContain("swapped");
  });

  it("reuses connection when file has not changed", () => {
    openStoreDatabase(testDir, "74");
    const { readonlyDb: db1 } = getStoreDataDb("74");
    const { readonlyDb: db2 } = getStoreDataDb("74");

    // Same connection object — not reopened
    expect(db2).toBe(db1);
  });
});
```

We need to add imports for `renameSync` and `Database` (the concrete constructor). Here is the complete test block to add, with proper imports handled:

Add to the imports at the top of `tests/db/connection.test.ts`:

```typescript
import { existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import DatabaseImpl from "better-sqlite3";
import { initializeStoreDataSchema } from "../../src/db/schema.js";
```

(Modify the existing `import { existsSync, mkdirSync, rmSync }` line to add `renameSync`, and add the two new imports.)

Then add the new describe block inside the outer describe, after the "readonly connection enforcement" block:

```typescript
describe("inode-based invalidation", () => {
  beforeEach(() => {
    openDatabases(testDir);
  });

  it("detects file swap and reopens connection", () => {
    openStoreDatabase(testDir, "74");

    // Write a marker into the original database
    const { db: rwDb } = getStoreDataDb("74");
    rwDb.exec(
      `INSERT INTO products (product_id, name) VALUES ('marker', 'Original')`
    );

    // Create a replacement database with different content
    const storePath = join(testDir, "stores", "74.db");
    const tmpPath = storePath + ".tmp";
    const tmpDb = new DatabaseImpl(tmpPath);
    tmpDb.pragma("foreign_keys = ON");
    initializeStoreDataSchema(tmpDb);
    tmpDb.exec(
      `INSERT INTO products (product_id, name) VALUES ('swapped', 'New')`
    );
    tmpDb.close();

    // Atomically swap the file
    renameSync(tmpPath, storePath);

    // The next call should detect the inode change and reopen
    const { readonlyDb } = getStoreDataDb("74");
    const rows = readonlyDb
      .prepare(`SELECT product_id FROM products`)
      .all() as Array<{ product_id: string }>;
    const ids = rows.map((r) => r.product_id);

    expect(ids).not.toContain("marker");
    expect(ids).toContain("swapped");
  });

  it("reuses connection when file has not changed", () => {
    openStoreDatabase(testDir, "74");
    const { readonlyDb: db1 } = getStoreDataDb("74");
    const { readonlyDb: db2 } = getStoreDataDb("74");

    // Same object reference — connection was reused, not reopened
    expect(db2).toBe(db1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: FAIL — `getStoreDataDb` does not accept a `storeNumber` argument yet, and there is no inode checking.

**Step 3: Commit**

```bash
git add tests/db/connection.test.ts
git commit -m "test: add failing tests for inode-based connection invalidation"
```

---

### Task 2: Write failing tests for multi-store connection pool

The connection manager must support holding connections to multiple stores simultaneously, keyed by store number.

**Files:**
- Modify: `tests/db/connection.test.ts`

**Step 1: Write the failing tests**

Add a new describe block inside the outer describe:

```typescript
describe("multi-store connection pool", () => {
  beforeEach(() => {
    openDatabases(testDir);
  });

  it("holds connections to multiple stores simultaneously", () => {
    openStoreDatabase(testDir, "74");
    openStoreDatabase(testDir, "101");

    // Both should be accessible
    const { readonlyDb: db74 } = getStoreDataDb("74");
    const { readonlyDb: db101 } = getStoreDataDb("101");

    expect(db74).toBeDefined();
    expect(db101).toBeDefined();
    expect(db74).not.toBe(db101);
  });

  it("getStoreDataDb opens store on demand if not in pool", () => {
    // Don't call openStoreDatabase — getStoreDataDb should open it lazily
    // But the file must exist on disk first
    const storePath = join(testDir, "stores", "74.db");
    const db = new DatabaseImpl(storePath);
    db.pragma("foreign_keys = ON");
    initializeStoreDataSchema(db);
    db.exec(
      `INSERT INTO products (product_id, name) VALUES ('p1', 'Test')`
    );
    db.close();

    const { readonlyDb } = getStoreDataDb("74");
    const rows = readonlyDb
      .prepare(`SELECT product_id FROM products`)
      .all() as Array<{ product_id: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].product_id).toBe("p1");
  });

  it("getStoreDataDb throws if database file does not exist", () => {
    expect(() => getStoreDataDb("999")).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: FAIL — current `openStoreDatabase` closes the previous store, and `getStoreDataDb` takes no argument.

**Step 3: Commit**

```bash
git add tests/db/connection.test.ts
git commit -m "test: add failing tests for multi-store connection pool"
```

---

### Task 3: Implement the connection pool with inode invalidation

Replace the singleton store connection with a `Map`-based pool. Each entry tracks the inode at open time. `getStoreDataDb(storeNumber)` checks the inode on every call and reopens if stale.

**Files:**
- Modify: `src/db/connection.ts`

**Step 1: Implement the new connection manager**

The key changes:
1. Replace `storeData`/`storeDataReadonly`/`activeStoreNumber` fields with a `Map`
2. `getStoreDataDb(storeNumber)` checks inode, reopens if changed, opens lazily if missing
3. `openStoreDatabase` adds to pool instead of replacing
4. Keep backward compat: `getStoreDataDb()` with no arg throws a clear error
5. `closeDatabases()` closes all pooled connections
6. Remove `getActiveStoreNumber()` (no longer meaningful)

Replace the entire contents of `src/db/connection.ts` with:

```typescript
/**
 * Database connection management for multi-database architecture.
 *
 * Three database types:
 * - settings.db: API keys and global settings
 * - stores.db: Store locations from Wegmans API
 * - stores/{storeNumber}.db: Product data for each store
 *
 * Store connections are pooled by store number with inode-based
 * invalidation: if the underlying file is atomically swapped
 * (e.g. by refreshCatalogToFile), the next access detects the
 * new inode and transparently reopens the connection.
 */

import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  initializeSettingsSchema,
  initializeStoresSchema,
  initializeStoreDataSchema,
} from "./schema.js";

interface CachedStoreConnection {
  db: Database.Database;
  readonlyDb: Database.Database;
  path: string;
  ino: number;
}

interface ConnectionState {
  settings: Database.Database;
  stores: Database.Database;
  dataDir: string;
  storePool: Map<string, CachedStoreConnection>;
}

let state: ConnectionState | null = null;

/**
 * Open settings and stores databases.
 * Creates the stores/ subdirectory for per-store databases.
 */
export function openDatabases(dataDir: string): void {
  if (state !== null) {
    throw new Error(
      "Databases already open. Close them first before opening again."
    );
  }

  const storesDir = join(dataDir, "stores");
  if (!existsSync(storesDir)) {
    mkdirSync(storesDir, { recursive: true });
  }

  const settingsPath = join(dataDir, "settings.db");
  const settings = new Database(settingsPath);
  settings.pragma("foreign_keys = ON");
  initializeSettingsSchema(settings);

  const storesPath = join(dataDir, "stores.db");
  const stores = new Database(storesPath);
  stores.pragma("foreign_keys = ON");
  initializeStoresSchema(stores);

  state = {
    settings,
    stores,
    dataDir,
    storePool: new Map(),
  };
}

/**
 * Open a store connection and add it to the pool.
 *
 * If the store is already in the pool, this is a no-op (use
 * getStoreDataDb to get the connection — it handles invalidation).
 */
export function openStoreDatabase(
  dataDir: string,
  storeNumber: string
): void {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }

  // If already in pool with valid inode, skip
  if (state.storePool.has(storeNumber)) {
    return;
  }

  const entry = openStoreEntry(dataDir, storeNumber);
  state.storePool.set(storeNumber, entry);
}

/**
 * Get the settings database connection.
 */
export function getSettingsDb(): Database.Database {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }
  return state.settings;
}

/**
 * Get the stores database connection.
 */
export function getStoresDb(): Database.Database {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }
  return state.stores;
}

/**
 * Get a store's data connections (read-write and read-only).
 *
 * Checks the file inode on every call. If the file has been
 * atomically swapped (different inode), the old connections are
 * closed and fresh ones opened transparently.
 *
 * If the store is not in the pool but the file exists, it is
 * opened lazily.
 *
 * @param storeNumber - Store number to get connections for
 * @throws If databases not initialized or store file does not exist
 */
export function getStoreDataDb(storeNumber: string): {
  db: Database.Database;
  readonlyDb: Database.Database;
} {
  if (state === null) {
    throw new Error(
      "Databases not initialized. Call openDatabases() first."
    );
  }

  const cached = state.storePool.get(storeNumber);

  if (cached) {
    // Check if file was swapped (inode changed)
    const currentIno = statSync(cached.path).ino;
    if (currentIno === cached.ino) {
      return { db: cached.db, readonlyDb: cached.readonlyDb };
    }

    // Inode changed — close stale connections, reopen below
    closeStoreEntry(cached);
    state.storePool.delete(storeNumber);
  }

  // Open lazily (or reopen after invalidation)
  const storePath = join(state.dataDir, "stores", `${storeNumber}.db`);
  if (!existsSync(storePath)) {
    throw new Error(
      `Store ${storeNumber} database not found at ${storePath}`
    );
  }

  const entry = openStoreEntry(state.dataDir, storeNumber);
  state.storePool.set(storeNumber, entry);
  return { db: entry.db, readonlyDb: entry.readonlyDb };
}

/**
 * Close all database connections.
 * Safe to call multiple times (idempotent).
 */
export function closeDatabases(): void {
  if (state !== null) {
    // Close all pooled store connections
    for (const entry of state.storePool.values()) {
      closeStoreEntry(entry);
    }
    state.storePool.clear();

    state.stores.close();
    state.settings.close();
    state = null;
  }
}

// --- Internal helpers ---

function openStoreEntry(
  dataDir: string,
  storeNumber: string
): CachedStoreConnection {
  const storePath = join(dataDir, "stores", `${storeNumber}.db`);

  const db = new Database(storePath);
  db.pragma("foreign_keys = ON");
  initializeStoreDataSchema(db);

  const readonlyDb = new Database(storePath, { readonly: true });

  const ino = statSync(storePath).ino;

  return { db, readonlyDb, path: storePath, ino };
}

function closeStoreEntry(entry: CachedStoreConnection): void {
  try {
    if (entry.readonlyDb !== entry.db) {
      entry.readonlyDb.close();
    }
    entry.db.close();
  } catch {
    // Ignore close errors (db may already be closed)
  }
}
```

**Step 2: Run the new tests to verify they pass**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: The inode invalidation and multi-store pool tests pass. Some old tests may need minor fixes (see Task 4).

**Step 3: Commit**

```bash
git add src/db/connection.ts
git commit -m "feat: replace singleton store connection with pooled inode-checking manager"
```

---

### Task 4: Fix existing connection.test.ts tests for new API

Some existing tests assume the old singleton behavior (e.g., `getStoreDataDb()` with no args, `getActiveStoreNumber()`). Update them to match the new API.

**Files:**
- Modify: `tests/db/connection.test.ts`

**Step 1: Update broken tests**

Key changes needed:

1. **Remove `getActiveStoreNumber` import and tests** — this function no longer exists.

2. **Update `getStoreDataDb()` calls to pass store number:**
   - `getStoreDataDb()` → `getStoreDataDb("74")` (or whatever store is being tested)

3. **Update "switches stores" test** — it tested that opening store 101 closes store 74. Now both stay open. Rewrite to verify both are accessible with independent data.

4. **Update "throws when no store selected" test** — now throws with a store number that doesn't have a file, not a generic "no store selected".

5. **Update "readonly connection blocks writes" test** — pass store number.

Walk through each existing describe block and fix the assertions. The exact changes depend on which tests break; run tests iteratively and fix.

**Step 2: Run all connection tests**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/db/connection.test.ts
git commit -m "test: update connection tests for pooled multi-store API"
```

---

### Task 5: Update index.ts for per-query store routing

The MCP server entry point needs to change: `query` tool's `database="products"` must now accept a `storeNumber` parameter. The `setStore` tool becomes unnecessary in the deployed multi-user context but we keep it for the local MCP use case (just remove the `openStoreDatabase` call after it — the pool handles this).

**Files:**
- Modify: `src/index.ts`

**Step 1: Update the query tool handler**

In the `CallToolRequestSchema` handler, the `"query"` case for `database === "products"`:

```typescript
case "query": {
  const { sql, database = "products", storeNumber } = args as {
    sql?: string;
    database?: "stores" | "products";
    storeNumber?: string;
  };

  if (typeof sql !== "string") {
    return {
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: "Missing required parameter: sql" }) },
      ],
    };
  }

  if (database === "stores") {
    const storesDb = getStoresDb();
    const result = queryTool(storesDb, sql);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } else {
    // database === "products"
    if (!storeNumber) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error:
                "Missing required parameter: storeNumber. Query the stores database first to find the store number, then pass it here.",
            }),
          },
        ],
      };
    }

    try {
      const { readonlyDb } = getStoreDataDb(storeNumber);
      const result = queryTool(readonlyDb, sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  }
}
```

**Step 2: Update the query tool input schema**

In `getToolDefinitions`, add `storeNumber` to the query tool's `inputSchema.properties`:

```typescript
storeNumber: {
  type: "string",
  description:
    "Store number for product queries (required when database='products'). Query the stores database first to find store numbers.",
},
```

**Step 3: Update the query tool description**

Update the description string to mention that `storeNumber` is required for product queries instead of saying "requires setStore first".

**Step 4: Update the setStore handler**

Remove the `openStoreDatabase(dataDir, storeNumber)` call after successful setStore — the pool handles this automatically. The setStore tool remains available for triggering catalog refresh.

```typescript
case "setStore": {
  // ... existing parameter validation ...

  const result = await setStoreTool(dataDir, settingsDb, storesDb, {
    storeNumber,
    ...(forceRefresh !== undefined ? { forceRefresh } : {}),
    onProgress,
  });

  // No need to call openStoreDatabase — the pool opens lazily

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}
```

**Step 5: Remove restoreActiveStore()**

This function is no longer needed — there's no persistent "active store" concept. Remove the function and the call to it in `main()`.

**Step 6: Update reportCatalogStatus()**

This function tried to report on the single active store. Either remove it entirely or make it a no-op. Removing is simpler.

**Step 7: Remove unused imports**

Remove imports that are no longer needed: `openStoreDatabase`, `getActiveStore` (if no longer used in index.ts).

**Step 8: Run tests**

Run: `npx vitest run tests/index.test.ts`
Expected: Some tests will fail due to API changes. Fix in Task 6.

**Step 9: Commit**

```bash
git add src/index.ts
git commit -m "feat: route product queries by storeNumber parameter, remove active store"
```

---

### Task 6: Fix index.test.ts and E2E tests

Update tests that depend on the old "active store" flow.

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `tests/e2e/mcp-server.test.ts`

**Step 1: Update tests/index.test.ts**

Key changes:

1. **Remove `openStoreDatabase` import** if no longer needed by tests.
2. **Update "returns error when database='products' but no store selected"** — now the error is about missing `storeNumber` parameter, not "no store selected".
3. **Update "includes products schema when store database is available"** — `getToolDefinitions` still works the same way (it takes a db connection for schema embedding). The test may need to pass a store number to `getStoreDataDb("74")`.
4. **Remove or update `TOOL_DEFINITIONS` tests** — the static definitions (called with no databases) still work. Just verify the `storeNumber` property is in the query tool schema.

**Step 2: Update tests/e2e/mcp-server.test.ts**

1. **"returns error when querying products without store selected"** — update expected error message to mention `storeNumber` parameter.
2. **"defaults to products database when database parameter not specified"** — same error message update.
3. **Tool schema tests** — verify the query tool schema now includes `storeNumber`.

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add tests/index.test.ts tests/e2e/mcp-server.test.ts
git commit -m "test: update index and E2E tests for per-query store routing"
```

---

### Task 7: Remove getActiveStoreNumber export and update setStore.ts

Clean up the `getActiveStoreNumber` removal from the connection manager and any remaining references.

**Files:**
- Modify: `src/db/connection.ts` (if not already done — verify `getActiveStoreNumber` is removed)
- Modify: `src/tools/setStore.ts` — remove the `openStoreDatabase` call concern in the docstring/comments
- Modify: `src/index.ts` — verify no remaining references to `getActiveStoreNumber` from connection.ts

**Step 1: Search for remaining references**

Search the codebase for `getActiveStoreNumber` and `activeStoreNumber` to find any remaining references that need updating.

**Step 2: Update or remove references**

The `getActiveStore()` function in `setStore.ts` reads from `settings.db` — this is separate from the connection manager's `getActiveStoreNumber()`. It should remain as-is since it reads persistent state. But verify `index.ts` doesn't import `getActiveStoreNumber` from `connection.ts` anymore.

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove getActiveStoreNumber and clean up stale references"
```

---

### Task 8: Add LRU eviction to the connection pool

With 114 stores, we don't want 114 × 2 = 228 open file descriptors. Add an LRU eviction policy that caps the pool at a configurable size (default: 10).

**Files:**
- Modify: `tests/db/connection.test.ts`
- Modify: `src/db/connection.ts`

**Step 1: Write the failing test**

```typescript
describe("LRU eviction", () => {
  beforeEach(() => {
    openDatabases(testDir);
  });

  it("evicts least-recently-used connection when pool exceeds max size", () => {
    // Set max pool size to 2 for testing
    setMaxPoolSize(2);

    // Create 3 store database files
    for (const num of ["1", "2", "3"]) {
      const path = join(testDir, "stores", `${num}.db`);
      const db = new DatabaseImpl(path);
      db.pragma("foreign_keys = ON");
      initializeStoreDataSchema(db);
      db.close();
    }

    // Open stores 1, 2, 3 in order
    getStoreDataDb("1");
    getStoreDataDb("2");
    getStoreDataDb("3"); // Should evict store 1

    // Store 3 should be accessible (just opened)
    expect(() => getStoreDataDb("3")).not.toThrow();

    // Store 2 should be accessible (recently used before 3)
    expect(() => getStoreDataDb("2")).not.toThrow();

    // Store 1 was evicted but can be reopened lazily
    expect(() => getStoreDataDb("1")).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: FAIL — `setMaxPoolSize` does not exist.

**Step 3: Implement LRU eviction**

In `src/db/connection.ts`:

1. Add a module-level `maxPoolSize` variable (default 10).
2. Export `setMaxPoolSize(n: number)` for testing.
3. In `getStoreDataDb`, after adding a new entry, if `storePool.size > maxPoolSize`, evict the least-recently-used entry. Use insertion order of the `Map` — on each access, delete and re-insert the entry to move it to the end. The first entry in the map is the LRU candidate.

Add to `getStoreDataDb`, at the point where we return a cached connection:

```typescript
// Touch: move to end of Map (most recently used)
state.storePool.delete(storeNumber);
state.storePool.set(storeNumber, cached);
```

And after inserting a new entry:

```typescript
// Evict LRU if over capacity
while (state.storePool.size > maxPoolSize) {
  const [lruKey, lruEntry] = state.storePool.entries().next().value;
  closeStoreEntry(lruEntry);
  state.storePool.delete(lruKey);
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: All tests pass including the new LRU test.

**Step 5: Commit**

```bash
git add src/db/connection.ts tests/db/connection.test.ts
git commit -m "feat: add LRU eviction to store connection pool"
```

---

### Task 9: Update ListToolsRequestSchema handler for pool

The `ListToolsRequestSchema` handler currently tries to get the single active store's schema. In the multi-store world, we embed a representative schema (from any store, since they're all identical).

**Files:**
- Modify: `src/index.ts`

**Step 1: Update the handler**

The product schema is the same for every store, so we can use any store's database to generate it. If no stores are loaded yet, fall back to "use setStore or pass storeNumber".

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const storesDb = getStoresDb();

    // Use any available store database for schema (all stores share the same schema)
    let storeDataDb: Database.Database | null = null;
    // Check if any store .db files exist and open one for schema
    const storesDir = join(dataDir, "stores");
    if (existsSync(storesDir)) {
      const files = readdirSync(storesDir).filter((f) => f.endsWith(".db") && !f.endsWith(".tmp"));
      if (files.length > 0) {
        const sampleStore = files[0].replace(".db", "");
        try {
          const { readonlyDb } = getStoreDataDb(sampleStore);
          storeDataDb = readonlyDb;
        } catch {
          // Ignore — schema not available
        }
      }
    }

    return { tools: getToolDefinitions(storesDb, storeDataDb) };
  } catch {
    return { tools: getToolDefinitions() };
  }
});
```

Add `readdirSync` to the `fs` import.

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All pass.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: use any available store for schema in tool definitions"
```

---

### Task 10: Final integration test and cleanup

Run the full test suite, fix any remaining issues, and do a final commit.

**Files:**
- All modified files

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 2: Build and run E2E tests**

Run: `npx tsc && npx vitest run tests/e2e/`
Expected: All E2E tests pass (these hit the real network, so run with `SKIP_INTEGRATION=false` if needed).

**Step 3: Final commit if any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for connection pool migration"
```
