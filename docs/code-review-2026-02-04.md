# Comprehensive Code Review: Forager MCP Server

**Date:** 2026-02-04
**Reviewer:** Fresh Eyes Code Review (Opus subagent)

## Executive Summary

The **forager** project is an MCP server for querying Wegmans product data. Overall, the codebase is **well-structured, well-tested, and functional**. The architecture is clean with good separation of concerns. All 265 tests pass. However, there are several areas that warrant attention, ranging from dead code to potential improvements.

---

## 1. CORRECTNESS

### Critical Issues

**None found.** The code correctly implements its intended functionality and all tests pass.

### Important Issues

#### 1.1 Inconsistent Directory Name in Documentation
**Severity: Important**
**File:** `/Users/finch/src/forager/docs/architecture.md` (lines 9-17)

The documentation references `$XDG_DATA_HOME/wegmans-mcp/` but the actual code uses `forager`:

```markdown
# In architecture.md (line 10-11):
$XDG_DATA_HOME/wegmans-mcp/    # defaults to ~/.local/share/wegmans-mcp/
```

```typescript
// In src/index.ts (line 48):
return join(xdgDataHome, "forager");
```

This documentation inconsistency could confuse users looking for their data files.

#### 1.2 Dead Code: Unused listStores Tool
**Severity: Important**
**Files:**
- `/Users/finch/src/forager/src/tools/listStores.ts` (entire file)
- `/Users/finch/src/forager/src/tools/search.ts` (entire file)
- `/Users/finch/src/forager/src/tools/refreshApiKey.ts` (entire file)

These tools exist but are not wired into the MCP server (see `src/index.ts` which only registers `query` and `setStore`). The git history indicates `listStores` was intentionally removed (commit aa2c812: "refactor: remove listStores tool, use SQL queries instead"), but the file remains.

**Recommendation:** Delete these unused files or document them as internal utilities.

### Minor Issues

#### 1.3 Potential Race Condition in Key Extraction
**Severity: Minor**
**File:** `/Users/finch/src/forager/src/algolia/keyExtractor.ts` (lines 144-153)

The `waitForTimeout(5000)` is a fixed delay that may be insufficient on slow connections or excessive on fast ones:

```typescript
// Wait for Algolia requests to complete
await page.waitForTimeout(5000);
```

**Recommendation:** Consider using `page.waitForRequest()` or `page.waitForResponse()` with a specific URL pattern for more deterministic behavior.

---

## 2. COMPLETENESS

### Important Issues

#### 2.1 Missing API Key Expiration Handling
**Severity: Important**
**File:** `/Users/finch/src/forager/src/tools/setStore.ts` (lines 131-168)

The code extracts and stores API credentials but never checks if they've expired. The `api_keys` table has an `expires_at` column that is always set to NULL:

```typescript
// Line 123-125 in setStore.ts
stmt.run(apiKey, appId, new Date().toISOString());
// expires_at is never set

// No check for expiration in ensureApiCredentials()
const existing = getApiCredentials(settingsDb);
if (existing) {
  return existing;  // Always returns existing, never checks validity
}
```

**Recommendation:** Add logic to detect 401/403 responses from Algolia and trigger re-extraction when credentials fail.

#### 2.2 Missing SIGTERM Handling in setStore
**Severity: Minor**
**File:** `/Users/finch/src/forager/src/tools/setStore.ts` (lines 291-298)

The `setStoreTool` function opens a database in the `finally` block but closes it unconditionally:

```typescript
} finally {
  // Close store database if we opened it
  // Note: In production, the caller may want to keep this open
  // For now, we close it to avoid leaking connections in tests
  if (storeDb) {
    storeDb.close();
  }
}
```

This is inconsistent with the production use case where the caller immediately opens the store database again via `openStoreDatabase()`.

#### 2.3 No Handling for Stale Store Data
**Severity: Minor**
**File:** `/Users/finch/src/forager/src/stores/fetch.ts`

Store data is cached for 24 hours but there's no mechanism for the user to force-refresh stores (unlike products which have `forceRefresh`).

---

## 3. DOCUMENTATION

### What's Done Well

- **README.md** is comprehensive and well-structured
- **Database schemas** are clearly documented with SQL examples
- **Architecture decisions** are explained in `docs/architecture.md`
- **Inline JSDoc comments** are present on all public functions

### Important Issues

#### 3.1 Outdated Architecture Documentation Path Reference
**Severity: Important**
**File:** `/Users/finch/src/forager/docs/plans/2026-02-04-wegmans-mcp-design.md` (lines 8 and 474)

References to `../../wegmans-mcp/docs/architecture.md` are incorrect - the project is named `forager`, not `wegmans-mcp`:

```markdown
> **Note:** ... see [wegmans-mcp/docs/architecture.md](../../wegmans-mcp/docs/architecture.md)
```

#### 3.2 README Documents Removed Feature
**Severity: Minor**
**File:** `/Users/finch/src/forager/README.md`

The README correctly describes the 2-tool API (`query` and `setStore`), but some internal comments and design docs still reference the original 7-tool design.

---

## 4. CODE QUALITY

### What's Done Well

- **Strong typing** with Zod schemas for runtime validation
- **Clean separation of concerns**: tools, db, algolia, catalog, types
- **Dependency injection** for testability (e.g., `refreshCatalogFn`, `extractFn`)
- **Consistent error handling patterns** returning `{ success, error }` objects
- **Transaction usage** for bulk database operations

### Important Issues

#### 4.1 Legacy Schema Function Still Present
**Severity: Important**
**File:** `/Users/finch/src/forager/src/db/schema.ts` (lines 15-195)

The `initializeSchema()` function contains the old single-database schema with `store_products` table, but it's only used by tests and the deprecated `openDatabase()` function. The actual production code uses:
- `initializeSettingsSchema()`
- `initializeStoresSchema()`
- `initializeStoreDataSchema()`

```typescript
// This old schema is still present but not used in production:
export function initializeSchema(db: Database.Database): void {
  // ... includes store_products table which is no longer used
```

**Recommendation:** Remove `initializeSchema()` or mark it clearly as deprecated/test-only.

#### 4.2 Duplicated Active Store Logic
**Severity: Minor**
**Files:**
- `/Users/finch/src/forager/src/tools/setStore.ts` (line 67-72)
- `/Users/finch/src/forager/src/tools/listStores.ts` (line 28-33)

The `getActiveStore()` function is duplicated in both files with identical implementations:

```typescript
// Both files have:
export function getActiveStore(settingsDb: Database.Database): string | null {
  const row = settingsDb
    .prepare("SELECT value FROM settings WHERE key = 'active_store'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}
```

**Recommendation:** Extract to a shared module.

#### 4.3 Hardcoded Magic Numbers
**Severity: Minor**
**File:** `/Users/finch/src/forager/src/catalog/fetch.ts`

Several constants could be better documented or made configurable:

```typescript
const MAX_HITS_PER_QUERY = 1000;  // Algolia limit
const CONCURRENCY = 30;           // Why 30?
const BASE_DELAY_MS = 20;
const MAX_BACKOFF_MS = 30000;
const PLANNING_DELAY_MS = 30;
```

---

## 5. TEST QUALITY

### What's Done Well

- **Excellent test coverage** with 265 tests across all modules
- **Good separation** of unit, integration, and E2E tests
- **Property-based testing** used for database operations (`products.property.test.ts`)
- **Test isolation** with temp directories and cleanup
- **Mocking/dependency injection** for external dependencies

### Suggestions

#### 5.1 E2E Tests Skip in CI Without Explanation
**Severity: Suggestion**
**File:** `/Users/finch/src/forager/tests/e2e/mcp-server.test.ts` (line 24-27)

```typescript
const SKIP_INTEGRATION =
  process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

describe.skipIf(SKIP_INTEGRATION)("MCP Server E2E", () => {
```

No comment explains why E2E tests are skipped in CI. This should be documented.

#### 5.2 Missing Tests for Edge Cases
**Severity: Suggestion**

Consider adding tests for:
1. Network timeout scenarios in catalog fetch
2. Partial catalog fetch (some queries fail)
3. Corrupted database file handling
4. Concurrent `setStore` calls

---

## 6. SECURITY

### Minor Issues

#### 6.1 SQL Injection is Properly Mitigated
**Severity: None (Good!)**

The `queryTool` uses a read-only database connection, and SQLite enforces this at the engine level for file-based databases. This is good practice.

#### 6.2 API Keys Stored in Plain Text
**Severity: Suggestion**
**File:** `/Users/finch/src/forager/src/db/schema.ts`

API keys are stored as plain text in SQLite. While these are "public" Algolia search keys, consider if any encryption or obfuscation is warranted.

---

## Summary of Findings by Severity

### Critical (Must Fix)
None

### Important (Should Fix)
1. Documentation refers to wrong directory name (`wegmans-mcp` vs `forager`)
2. Dead code: Unused tool files (`listStores.ts`, `search.ts`, `refreshApiKey.ts`)
3. No API key expiration/failure handling
4. Legacy `initializeSchema()` function should be removed or marked deprecated
5. Broken path references in design documentation

### Minor (Nice to Have)
1. Race condition potential in key extraction (fixed timeout)
2. Duplicated `getActiveStore()` function
3. Hardcoded constants without documentation
4. Inconsistent database close behavior in `setStore`
5. No force-refresh for store list

### Suggestions
1. Add CI skip reason documentation for E2E tests
2. Add edge case tests for network failures
3. Consider API key encryption
4. Clean up comments referencing old 7-tool design

---

## Files Reviewed

| File | Purpose | Issues Found |
|------|---------|--------------|
| `/Users/finch/src/forager/src/index.ts` | MCP server entry point | Clean |
| `/Users/finch/src/forager/src/tools/query.ts` | Query tool | Clean |
| `/Users/finch/src/forager/src/tools/setStore.ts` | Set store tool | Duplicated function |
| `/Users/finch/src/forager/src/tools/schema.ts` | Schema tool | Clean |
| `/Users/finch/src/forager/src/tools/listStores.ts` | **Dead code** | Should delete |
| `/Users/finch/src/forager/src/tools/search.ts` | **Dead code** | Should delete |
| `/Users/finch/src/forager/src/tools/refreshApiKey.ts` | **Dead code** | Should delete |
| `/Users/finch/src/forager/src/db/connection.ts` | DB connection management | Clean |
| `/Users/finch/src/forager/src/db/schema.ts` | Schema definitions | Legacy function |
| `/Users/finch/src/forager/src/db/products.ts` | Product CRUD | Clean |
| `/Users/finch/src/forager/src/db/stores.ts` | Store CRUD | Clean |
| `/Users/finch/src/forager/src/db/queries.ts` | SQL execution | Clean |
| `/Users/finch/src/forager/src/algolia/client.ts` | Algolia client | Clean |
| `/Users/finch/src/forager/src/algolia/keyExtractor.ts` | Key extraction | Fixed timeout |
| `/Users/finch/src/forager/src/catalog/fetch.ts` | Catalog fetching | Magic numbers |
| `/Users/finch/src/forager/src/catalog/index.ts` | Catalog management | Clean |
| `/Users/finch/src/forager/src/catalog/ontology.ts` | Category/tag extraction | Clean |
| `/Users/finch/src/forager/src/stores/fetch.ts` | Store fetching | Clean |
| `/Users/finch/src/forager/src/types/product.ts` | Product types | Clean |
| `/Users/finch/src/forager/src/types/algolia.ts` | Algolia types | Clean |
| `/Users/finch/src/forager/README.md` | Documentation | Clean |
| `/Users/finch/src/forager/docs/architecture.md` | Architecture docs | Wrong path |
| `/Users/finch/src/forager/docs/plans/*` | Design docs | Outdated refs |

---

## Conclusion

The forager project is **well-implemented** with clean architecture, good test coverage, and functional correctness. The main concerns are **housekeeping issues** (dead code, outdated documentation) rather than bugs or design flaws. The codebase would benefit from a cleanup pass to remove legacy code and update documentation references to match the current implementation.
