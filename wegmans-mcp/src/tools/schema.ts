/**
 * Schema tool for retrieving database table definitions.
 *
 * Provides DDL (CREATE TABLE statements) for all tables in the database.
 * Helps Claude understand what tables and columns are available for querying.
 */

import type Database from "better-sqlite3";

export interface TableDDL {
  name: string;
  ddl: string;
}

export interface SchemaToolResult {
  success: boolean;
  tables?: TableDDL[];
  error?: string;
}

/**
 * Retrieve DDL for all tables in the database.
 *
 * @param db - Database connection
 * @returns Schema result with table DDL on success, or error on failure
 */
export function schemaTool(db: Database.Database): SchemaToolResult {
  try {
    // Query sqlite_master for all table definitions
    const stmt = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const rows = stmt.all() as Array<{ name: string; sql: string }>;

    const tables: TableDDL[] = rows.map((row) => ({
      name: row.name,
      ddl: row.sql,
    }));

    return {
      success: true,
      tables,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
