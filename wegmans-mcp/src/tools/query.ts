/**
 * Query tool for executing read-only SQL queries.
 *
 * Provides a safe way for Claude to query the product database using raw SQL.
 * Uses a read-only database connection for safety.
 */

import type Database from "better-sqlite3";

export interface QueryToolResult {
  success: boolean;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  error?: string;
}

/**
 * Execute a read-only SQL query against the database.
 *
 * @param readonlyDb - Read-only database connection
 * @param sql - SQL statement to execute
 * @returns Query result with columns, rows, rowCount on success, or error on failure
 */
export function queryTool(
  readonlyDb: Database.Database,
  sql: string
): QueryToolResult {
  try {
    const stmt = readonlyDb.prepare(sql);
    const rows = stmt.all() as Array<Record<string, unknown>>;

    // Extract column names from the statement
    const columns = stmt.columns().map((col) => col.name);

    return {
      success: true,
      columns,
      rows,
      rowCount: rows.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
