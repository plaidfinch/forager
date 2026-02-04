/**
 * Query tool for executing read-only SQL queries.
 *
 * Provides a safe way for Claude to query the product database using raw SQL.
 * Uses a read-only database connection for safety.
 */

import type Database from "better-sqlite3";
import { executeQuery } from "../db/queries.js";

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
  const result = executeQuery(readonlyDb, sql);

  if (!result.success || !result.columns || !result.rows) {
    return {
      success: false,
      error: result.error ?? "Query failed",
    };
  }

  return {
    success: true,
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rows.length,
  };
}
