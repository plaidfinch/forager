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

export interface ViewDDL {
  name: string;
  ddl: string;
}

export interface SchemaToolResultExtended extends SchemaToolResult {
  views?: ViewDDL[];
}

/**
 * Retrieve DDL for all tables and views in the database.
 *
 * @param db - Database connection
 * @returns Schema result with table/view DDL on success, or error on failure
 */
export function schemaTool(db: Database.Database): SchemaToolResultExtended {
  try {
    // Query sqlite_master for all table definitions
    const tableStmt = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const tableRows = tableStmt.all() as Array<{ name: string; sql: string }>;

    const tables: TableDDL[] = tableRows.map((row) => ({
      name: row.name,
      ddl: row.sql,
    }));

    // Query sqlite_master for all view definitions
    const viewStmt = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'view'
      ORDER BY name
    `);

    const viewRows = viewStmt.all() as Array<{ name: string; sql: string }>;

    const views: ViewDDL[] = viewRows.map((row) => ({
      name: row.name,
      ddl: row.sql,
    }));

    return {
      success: true,
      tables,
      views,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
