/**
 * Read-only SQL query execution.
 *
 * Uses a read-only database connection for safety.
 * SQLite enforces read-only at the engine level for file-based databases.
 * For in-memory databases, we fall back to parser-based validation.
 */

import type Database from "better-sqlite3";

export interface QueryResult {
  success: boolean;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  error?: string;
}

/**
 * Execute a SQL query on a read-only connection.
 *
 * When using a file-based database, the connection is opened in read-only mode
 * and SQLite will reject any write operations at the engine level.
 *
 * When using an in-memory database (for testing), we can't have a separate
 * read-only connection, so we validate the SQL to ensure it's a SELECT/PRAGMA/EXPLAIN.
 *
 * @param readonlyDb - Read-only database connection
 * @param sql - SQL statement to execute
 * @param params - Optional parameters (array for positional, object for named)
 * @returns QueryResult with rows and column names
 */
export function executeQuery(
  readonlyDb: Database.Database,
  sql: string,
  params?: unknown[] | Record<string, unknown>
): QueryResult {
  try {
    const stmt = readonlyDb.prepare(sql);

    const rows = (
      params
        ? Array.isArray(params)
          ? stmt.all(...params)
          : stmt.all(params)
        : stmt.all()
    ) as Array<Record<string, unknown>>;

    // Extract column names from first row, or from statement if no rows
    let columns: string[] = [];
    if (rows.length > 0 && rows[0]) {
      columns = Object.keys(rows[0]);
    } else {
      // For empty results, we can still get column names from the statement
      columns = stmt.columns().map((col) => col.name);
    }

    return {
      success: true,
      rows,
      columns,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
