/**
 * Ontology population for categories and tags.
 *
 * Extracts category hierarchy and tags from product hits
 * and populates the reference tables.
 */

import type Database from "better-sqlite3";
import type { AlgoliaHit } from "./fetch.js";

interface CategoryInfo {
  path: string;
  name: string;
  level: number;
}

interface TagInfo {
  name: string;
  type: "filter" | "popular";
}

/**
 * Extract all category paths from a hit's categories object.
 */
function extractCategories(hit: AlgoliaHit): CategoryInfo[] {
  const categories = hit["categories"] as
    | { lvl0?: string; lvl1?: string; lvl2?: string; lvl3?: string; lvl4?: string }
    | undefined;

  if (!categories) return [];

  const result: CategoryInfo[] = [];

  for (let level = 0; level <= 4; level++) {
    const key = `lvl${level}` as keyof typeof categories;
    const path = categories[key];
    if (path) {
      // Extract name from path (last segment after " > ")
      const segments = path.split(" > ");
      const name = segments[segments.length - 1] ?? path;
      result.push({ path, name, level });
    }
  }

  return result;
}

/**
 * Extract tags from a hit.
 */
function extractTags(hit: AlgoliaHit): TagInfo[] {
  const result: TagInfo[] = [];

  const filterTags = hit["filterTags"] as string[] | undefined;
  if (filterTags) {
    for (const name of filterTags) {
      result.push({ name, type: "filter" });
    }
  }

  const popularTags = hit["popularTags"] as string[] | undefined;
  if (popularTags) {
    for (const name of popularTags) {
      result.push({ name, type: "popular" });
    }
  }

  return result;
}

/**
 * Populate the categories and tags ontology tables from product hits.
 *
 * @param db - Database connection
 * @param hits - Product hits from catalog fetch
 */
export function populateOntology(db: Database.Database, hits: AlgoliaHit[]): void {
  // Collect unique categories with counts
  const categoryCounts = new Map<string, { info: CategoryInfo; count: number }>();

  // Collect unique tags with counts
  const tagCounts = new Map<string, { info: TagInfo; count: number }>();

  for (const hit of hits) {
    // Process categories
    const categories = extractCategories(hit);
    for (const cat of categories) {
      const existing = categoryCounts.get(cat.path);
      if (existing) {
        existing.count++;
      } else {
        categoryCounts.set(cat.path, { info: cat, count: 1 });
      }
    }

    // Process tags
    const tags = extractTags(hit);
    for (const tag of tags) {
      const key = `${tag.type}:${tag.name}`;
      const existing = tagCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        tagCounts.set(key, { info: tag, count: 1 });
      }
    }
  }

  // Upsert categories — accumulates counts across repeated calls
  const insertCategory = db.prepare(`
    INSERT INTO categories (path, name, level, product_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET product_count = product_count + excluded.product_count
  `);

  for (const { info, count } of categoryCounts.values()) {
    insertCategory.run(info.path, info.name, info.level, count);
  }

  // Upsert tags — accumulates counts across repeated calls
  const insertTag = db.prepare(`
    INSERT INTO tags (name, type, product_count)
    VALUES (?, ?, ?)
    ON CONFLICT(name, type) DO UPDATE SET product_count = product_count + excluded.product_count
  `);

  for (const { info, count } of tagCounts.values()) {
    insertTag.run(info.name, info.type, count);
  }
}

/**
 * Get ontology statistics from the database.
 */
export function getOntologyStats(db: Database.Database): {
  categoryCount: number;
  tagCount: number;
} {
  const categoryCount = (
    db.prepare("SELECT COUNT(*) as count FROM categories").get() as { count: number }
  ).count;

  const tagCount = (
    db.prepare("SELECT COUNT(*) as count FROM tags").get() as { count: number }
  ).count;

  return { categoryCount, tagCount };
}
