# Remove Playwright: Pure-fetch Algolia Key Extraction

## Motivation

The MCP server currently depends on Playwright (which downloads Chromium) solely
to extract Algolia API credentials from the Wegmans website. This prevents
running in sandboxed or browser environments. The goal is to replace Playwright
with pure-TypeScript HTTP fetching and JS parsing.

## Discovery

The Algolia API key and app ID are hardcoded as string literals in a Next.js
webpack chunk served from `wegmans.com`. The chunk is referenced as a `<script>`
tag in the homepage HTML. The key is used in an object literal with stable
property names:

```js
// Minified, variable names change per build:
C="QGPPR19V8V",b="9a10b1401634e9a6e55161c3a60c200d",...
{apiKey:b,appId:C,userToken:k}
```

The property names `apiKey` and `appId` are part of the Algolia SDK's public API
surface and survive minification. The variable names (`b`, `C`) are minifier
artifacts and change per build.

## Design

### Dependencies

Replace `playwright` with:
- **acorn**: Pure-JS ECMAScript parser (~130KB). Produces ESTree AST.
- **eslint-scope**: Pure-JS scope analysis for ESTree ASTs. Resolves identifier
  references to their definitions.

Both are pure TypeScript/JavaScript with zero native dependencies, suitable for
browser or sandboxed environments.

### Extraction Algorithm

**Step 1: Fetch homepage, collect chunk URLs**

```
GET https://www.wegmans.com
```

Parse the HTML (string matching) to collect all `<script src="/_next/static/chunks/...">` URLs.

**Step 2: Fetch all chunks in parallel, abort on success**

Create a shared `AbortController`. Fetch every chunk URL in parallel. For each
response:

1. **Quick filter**: Check if the response body contains the string `{apiKey:`
   (cheap string search). Skip chunks that don't match.

2. **Parse**: Parse the matching chunk with `acorn` into an ESTree AST.

3. **Find the anchor**: Walk the AST for an `ObjectExpression` containing
   properties with keys `apiKey` and `appId` whose values are `Identifier` nodes.
   Extract the identifier names (e.g. `b` and `C`).

4. **Resolve via scope analysis**: Use `eslint-scope` to build a scope tree.
   Look up each identifier in the scope containing the object expression. Follow
   the reference to its definition (a `VariableDeclarator` or assignment with a
   `Literal` string value).

5. **Validate**: Confirm the API key matches `/^[0-9a-f]{32}$/` and the app ID
   matches `/^[A-Z0-9]{8,15}$/`.

6. **Abort**: Signal the `AbortController` to cancel all remaining in-flight
   fetches. Return `{ apiKey, appId }`.

**Step 3: Error handling**

If no chunk yields a match, fail with a clear error message indicating the
extraction pattern may need updating. No silent fallback.

### Interface

The public interface (`KeyExtractionResult`) and the function signature of
`extractAlgoliaKey` remain unchanged. The `headless` option becomes irrelevant
and can be removed (or ignored). Callers (primarily `setStore.ts`) need no
changes beyond the removed option.

### What Changes

| File | Change |
|------|--------|
| `src/algolia/keyExtractor.ts` | Rewrite: replace Playwright with fetch + acorn + eslint-scope |
| `package.json` | Remove `playwright`, add `acorn` + `eslint-scope` |
| `tests/` | Update extraction tests to mock fetch instead of browser |
| `scripts/find-key-origin.ts` | Can be deleted (exploration script, served its purpose) |

### What Doesn't Change

- `KeyExtractionResult` interface
- `setStore.ts` and all other callers
- The Algolia client, catalog fetching, database layer
- The `parseAlgoliaKeyFromUrl` and `parseAlgoliaAppIdFromUrl` utility functions
  (still useful for response URL parsing in the Algolia client)
