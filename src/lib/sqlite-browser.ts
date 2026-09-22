/**
 * Read-only SQLite browser for the file manager.
 *
 * Game servers scatter SQLite databases around their install directories
 * (player stats, claims, economies, ban lists). These are binary files the
 * text editor must refuse — but operators still need to look inside them
 * without downloading the file and opening it locally. This module opens a
 * database strictly read-only through Node's built-in `node:sqlite`
 * (no native module, no wasm runtime) and serves table lists plus
 * paginated rows to the file-manager UI.
 *
 * Safety notes:
 * - The database is opened with `readOnly: true`, so browsing can never
 *   modify a live game database — not even its locking state beyond a
 *   shared read lock. A busy timeout keeps reads from failing while the
 *   game server itself is writing.
 * - Table names are user input (they arrive from the browser). They are
 *   validated against sqlite_master AND quoted as identifiers, so a table
 *   literally named `x"; DROP TABLE users;--` is browsed, not executed.
 * - Blobs are truncated before serialisation: a 10 MB blob must not ride
 *   back as base64 inside a 100-row page.
 */

import { createRequire } from "node:module";

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | null = null;

async function loadSqlite(): Promise<SqliteModule> {
  if (sqliteModule) return sqliteModule;
  try {
    // Resolve the optional built-in through Node, not a bundler-generated
    // dynamic-import context. Keep loading lazy for hosts without node:sqlite.
    const require = createRequire(`${process.cwd()}/package.json`);
    sqliteModule = require("node:sqlite") as SqliteModule;
  } catch {
    throw new SqliteBrowseError(
      "SQLite browsing is unavailable on this host. Upgrade the panel's Node.js runtime to 22.16 or newer and restart it.",
      501
    );
  }
  if (!sqliteModule || typeof sqliteModule.DatabaseSync !== "function" ||
      typeof sqliteModule.StatementSync?.prototype.columns !== "function") {
    sqliteModule = null;
    throw new SqliteBrowseError(
      "SQLite browsing needs Node.js 22.16 or newer on this host. Upgrade the panel's runtime and restart it.",
      501
    );
  }
  return sqliteModule;
}

/** The 16-byte header every SQLite 3 database file starts with. */
const SQLITE_MAGIC = "SQLite format 3\0";

/** True when the leading bytes identify a SQLite 3 database file. */
export function isSqliteBytes(sample: Uint8Array | Buffer): boolean {
  if (sample.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (sample[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** Extensions the file manager treats as "open in the database browser". */
const DB_FILE_EXTS = new Set(["db", "sqlite", "sqlite3", "db3", "s3db"]);

/**
 * True for file names that should open straight into the database browser.
 * The magic bytes are still verified before anything is opened — a
 * `level.db` that is really LevelDB gets a clear error, not a crash.
 */
export function looksLikeDbFile(fileName: string): boolean {
  const base = fileName.split("/").pop() ?? fileName;
  // A leading dot means a dotfile (".db"), not an extension.
  const withoutLeadingDot = base.startsWith(".") ? base.slice(1) : base;
  if (!withoutLeadingDot.includes(".")) return false;
  const ext = withoutLeadingDot.split(".").pop()!.toLowerCase();
  return DB_FILE_EXTS.has(ext);
}

/** Quote an identifier so any table name is safe to interpolate. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a string literal (pragma functions take strings, not identifiers). */
export function quoteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface DbTableInfo {
  name: string;
  kind: "table" | "view";
  /** Row count, or null when counting failed (e.g. a broken view). */
  rows: number | null;
  /** The CREATE TABLE / CREATE VIEW statement, for the schema view. */
  sql: string | null;
}

export interface DbColumnInfo {
  name: string;
  /** Declared type (may be "" for views and expressions). */
  type: string;
}

/** A cell value after JSON-safe serialisation. */
export type DbCellValue =
  | string
  | number
  | boolean
  | null
  | { $blob: true; bytes: number; truncated: boolean; preview: string };

/** How much of a blob is sent to the browser (base64 of the head). */
const BLOB_PREVIEW_BYTES = 256;

function serialiseValue(value: unknown): DbCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    const head = value.subarray(0, BLOB_PREVIEW_BYTES);
    return {
      $blob: true,
      bytes: value.length,
      truncated: value.length > head.length,
      preview: Buffer.from(head).toString("base64"),
    };
  }
  return String(value);
}

export class SqliteBrowseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function friendlyOpenError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not a database|file is not a database|malformed/i.test(msg)) {
    return new SqliteBrowseError("That file is not a readable SQLite database", 400);
  }
  if (/unable to open|no such file|ENOENT/i.test(msg)) {
    return new SqliteBrowseError("Database file not found", 404);
  }
  return e instanceof Error ? e : new Error(msg);
}

/**
 * Open a database strictly read-only.
 *
 * The caller must close the handle (try/finally). The busy timeout lets a
 * read wait out a writer — game servers hold brief write locks constantly,
 * and failing the browse on the first SQLITE_BUSY would make live
 * databases unreadable.
 */
async function openReadOnly(dbPath: string): Promise<InstanceType<SqliteModule["DatabaseSync"]>> {
  const { DatabaseSync } = await loadSqlite();
  try {
    const db = new DatabaseSync(dbPath, {
      open: true,
      readOnly: true,
      timeout: 5000,
    });
    return db;
  } catch (e: unknown) {
    throw friendlyOpenError(e);
  }
}

/**
 * List the user tables and views in a database, with row counts.
 * Internal `sqlite_%` tables (sqlite_sequence, sqlite_stat1) are noise
 * for an operator and are left out.
 */
export async function listDbTables(dbPath: string): Promise<DbTableInfo[]> {
  const db = await openReadOnly(dbPath);
  try {
    let master: Array<{ name: string; type: string; sql: string | null }>;
    try {
      master = db
        .prepare(
          "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ESCAPE '\\' ORDER BY name"
        )
        .all() as Array<{ name: string; type: string; sql: string | null }>;
    } catch (e: unknown) {
      throw friendlyOpenError(e);
    }
    const tables: DbTableInfo[] = [];
    for (const row of master) {
      let count: number | null = null;
      try {
        const r = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(row.name)}`).get() as {
          n: number | bigint;
        };
        count = typeof r.n === "bigint" ? Number(r.n) : r.n;
      } catch {
        // A view over a dropped table (or similar) still deserves a listing;
        // the rows view will surface the actual error.
        count = null;
      }
      tables.push({
        name: row.name,
        kind: row.type === "view" ? "view" : "table",
        rows: count,
        sql: row.sql,
      });
    }
    return tables;
  } finally {
    db.close();
  }
}

export interface DbRowsPage {
  table: string;
  columns: DbColumnInfo[];
  rows: DbCellValue[][];
  total: number | null;
  limit: number;
  offset: number;
}

export const DB_ROWS_DEFAULT_LIMIT = 100;
export const DB_ROWS_MAX_LIMIT = 500;

/**
 * Read one page of a table (or view), in the database's own row order.
 *
 * The table name is checked against sqlite_master first: an unknown name
 * is a clean 404 rather than a SQL error, and it makes injection
 * structurally impossible even before the identifier quoting.
 */
export async function readDbRows(
  dbPath: string,
  table: string,
  opts?: { limit?: number; offset?: number }
): Promise<DbRowsPage> {
  const limit = Math.min(
    DB_ROWS_MAX_LIMIT,
    Math.max(1, Math.floor(opts?.limit ?? DB_ROWS_DEFAULT_LIMIT) || DB_ROWS_DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0) || 0);

  const db = await openReadOnly(dbPath);
  try {
    let master: Array<{ name: string }>;
    try {
      master = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
        .all(table) as Array<{ name: string }>;
    } catch (e: unknown) {
      throw friendlyOpenError(e);
    }
    if (master.length === 0) {
      throw new SqliteBrowseError(`Table "${table}" does not exist`, 404);
    }
    const quoted = quoteIdentifier(table);

    let total: number | null = null;
    try {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number | bigint };
      total = typeof r.n === "bigint" ? Number(r.n) : r.n;
    } catch {
      total = null;
    }

    let stmt;
    try {
      stmt = db.prepare(`SELECT * FROM ${quoted} LIMIT ? OFFSET ?`);
    } catch (e: unknown) {
      throw new SqliteBrowseError(
        e instanceof Error ? e.message : `Cannot read table "${table}"`,
        400
      );
    }
    const columns: DbColumnInfo[] = stmt.columns().map((c) => ({ name: c.name, type: "" }));
    const rawRows = stmt.all(limit, offset) as Record<string, unknown>[];
    const rows = rawRows.map((r) => columns.map((c) => serialiseValue(r[c.name])));

    // Declared column types come from pragma when this is a real table;
    // for views the SELECT already gave us the names and "" is honest.
    try {
      const pragma = db.prepare(
        `SELECT name, type FROM pragma_table_info(${quoteStringLiteral(table)})`
      );
      for (const col of pragma.all() as Array<{ name: string; type: string | null }>) {
        const found = columns.find((c) => c.name === col.name);
        if (found) found.type = col.type ?? "";
      }
    } catch {
      /* views and odd tables simply carry no declared types */
    }

    return { table, columns, rows, total, limit, offset };
  } finally {
    db.close();
  }
}
