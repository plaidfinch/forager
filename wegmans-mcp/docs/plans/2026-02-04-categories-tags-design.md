# Categories & Tags Feature Design

Date: 2026-02-04

## Goal

Add category and tag support to enable:
1. **Browsing** - Query products by category without text search
2. **Filtering** - Filter by tags like "Gluten Free", "Organic"
3. **Reference** - Claude knows what categories/tags exist for natural language queries

## Philosophy

- **Algolia populates, SQL queries** - Use broad Algolia searches to populate the local SQLite mirror, then use SQL for filtering/joins/aggregations
- **Just-in-time mirroring** - Be a good API citizen; don't aggressively mirror everything
- **Claude should be aware** local data may be partial and proactively search when needed

## Database Schema Changes

### New columns on `products` table

```sql
ALTER TABLE products ADD COLUMN category_path TEXT;
ALTER TABLE products ADD COLUMN tags_filter TEXT;   -- JSON array
ALTER TABLE products ADD COLUMN tags_popular TEXT;  -- JSON array
```

- `category_path`: Full leaf path, e.g., "Dairy > Milk > Whole Milk"
- `tags_filter`: JSON array, e.g., `["Gluten Free", "Organic"]`
- `tags_popular`: JSON array, e.g., `["Wegmans Brand", "Family Pack"]`

### Ontology reference tables

```sql
CREATE TABLE IF NOT EXISTS categories (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  product_count INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  product_count INTEGER,
  PRIMARY KEY (name, type)
);
```

### Views for relational queries

```sql
CREATE VIEW IF NOT EXISTS product_categories AS
SELECT product_id, category_path
FROM products
WHERE category_path IS NOT NULL;

CREATE VIEW IF NOT EXISTS product_tags AS
SELECT product_id, value as tag_name, 'filter' as tag_type
FROM products, json_each(tags_filter)
WHERE tags_filter IS NOT NULL
UNION ALL
SELECT product_id, value as tag_name, 'popular' as tag_type
FROM products, json_each(tags_popular)
WHERE tags_popular IS NOT NULL;
```

## Ontology Population

**When:** Server startup, if `categories` table is empty.

**How:** Single empty-string search with `facets: ["*"]` returns complete ontology:
- ~1,141 category paths across 4 levels
- ~22 filter tags, ~8 popular tags
- Product counts for each

**Implementation:**
```typescript
async function populateOntology(db: Database, apiKey: string, storeNumber: string) {
  const count = db.prepare("SELECT COUNT(*) as n FROM categories").get();
  if (count.n > 0) return;  // Already populated

  const result = await searchProducts(apiKey, {
    query: "",
    storeNumber,
    hitsPerPage: 1,  // Only need facets
  });

  // Extract and insert categories from categories.lvl0, lvl1, lvl2, lvl3
  // Extract and insert tags from filterTags, popularTags
}
```

## Search Tool Changes

Add optional `filters` parameter for raw Algolia filter strings:

```typescript
interface SearchToolParams {
  query: string;
  storeNumber?: string;
  hitsPerPage?: number;
  page?: number;
  filters?: string;  // Optional Algolia filter string
}
```

**Examples:**
- `filterTags:Organic`
- `categories.lvl0:Dairy AND filterTags:"Gluten Free"`
- `consumerBrandName:Wegmans`

**Merge with base filters:**
```typescript
const baseFilters = `storeNumber:${storeNumber} AND isSoldAtStore:true`;
const finalFilters = filters ? `${baseFilters} AND ${filters}` : baseFilters;
```

## Transform Updates

Extract category and tags when transforming Algolia hits:

```typescript
function extractLeafCategoryPath(hit: AlgoliaProductHit): string | null {
  const cats = hit.categories;
  if (!cats) return null;
  return cats.lvl4 ?? cats.lvl3 ?? cats.lvl2 ?? cats.lvl1 ?? cats.lvl0 ?? null;
}

// In transformHitToProduct:
categoryPath: extractLeafCategoryPath(hit),
tagsFilter: hit.filterTags ? JSON.stringify(hit.filterTags) : null,
tagsPopular: hit.popularTags ? JSON.stringify(hit.popularTags) : null,
```

## Query Examples

**Products in Dairy (any subcategory):**
```sql
SELECT p.* FROM products p
WHERE p.category_path LIKE 'Dairy%';
```

**Gluten-free products:**
```sql
SELECT p.* FROM products p
JOIN product_tags pt ON p.product_id = pt.product_id
WHERE pt.tag_name = 'Gluten Free';
```

**Organic dairy products:**
```sql
SELECT p.* FROM products p
JOIN product_tags pt ON p.product_id = pt.product_id
WHERE p.category_path LIKE 'Dairy%'
  AND pt.tag_name = 'Organic';
```

**What categories exist:**
```sql
SELECT path, product_count FROM categories ORDER BY path;
```

**What tags exist:**
```sql
SELECT name, type, product_count FROM tags ORDER BY product_count DESC;
```

## Snapshot Coverage

One-time capture script with diverse queries:

| Query | Purpose |
|-------|---------|
| `""` (empty) | Browse all, full facets |
| `"milk"` | Common search term |
| `"wine"` | Alcohol products |
| `"deli meat"` | Sold-by-weight products |
| `"vitamins"` | OTC/restricted items |
| `filters: categories.lvl0:Frozen` | Category filter |
| `filters: categories.lvl0:Cheese` | Different category |
| `filters: filterTags:Organic` | Tag filter |
| `filters: filterTags:Vegan` | Different tag |
| `"xyznonexistent"` | No results |
| `page: 99` | Pagination beyond data |
| `hitsPerPage: 1` | Minimal response |

## Implementation Tasks

1. Update database schema (new columns, ontology tables, views)
2. Update Product type and Zod schema
3. Update transform functions to extract category/tags
4. Implement ontology population function
5. Call ontology population on server startup
6. Add `filters` parameter to search tool
7. Update schema tool to document filterable fields
8. Create snapshot capture script
9. Run capture script, commit snapshots
10. Update/add tests for new functionality
