/**
 * Tests for the file manager's SQLite browser.
 *
 * Game servers keep player stats, claims and economies in SQLite sidecars.
 * The file manager opens those read-only through Node's built-in sqlite —
 * these tests pin the table listing, paginated reads, blob truncation, the
 * identifier quoting (a hostile table name must be browsed, not executed),
 * and the matching ops on the remote-node agent.
 *
 *   npm test
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isSqliteBytes,
  looksLikeDbFile,
  quoteIdentifier,
  listDbTables,
  readDbRows,
  SqliteBrowseError,
} from "../src/lib/sqlite-browser";
import { readText } from "../src/lib/server-file-ops";

describe("sqlite-browser: file detection", () => {
  test("recognises the SQLite magic header", () => {
    const good = Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(100)]);
    assert.equal(isSqliteBytes(good), true);
    assert.equal(isSqliteBytes(Buffer.from("SQLite format 3\0")), true);
    assert.equal(isSqliteBytes(Buffer.from("not a database at all........")), false);
    assert.equal(isSqliteBytes(Buffer.alloc(0)), false);
    assert.equal(isSqliteBytes(Buffer.from("short")), false);
  });

  test("opens db-like extensions in the database browser", () => {
    for (const name of ["players.db", "stats.sqlite", "eco.sqlite3", "data.db3", "x.s3db", "UPPER.DB"]) {
      assert.equal(looksLikeDbFile(name), true, name);
    }
    for (const name of ["server.properties", "data.db-wal", "data.db-shm", "noextension", "archive.zip", ".db"]) {
      assert.equal(looksLikeDbFile(name), false, name);
    }
  });

  test("quotes identifiers so hostile table names stay inert", () => {
    assert.equal(quoteIdentifier("users"), '"users"');
    assert.equal(quoteIdentifier('x"; DROP TABLE users;--'), '"x""; DROP TABLE users;--"');
  });
});

describe("sqlite-browser: browsing a real database", () => {
  let dir = "";
  let dbPath = "";
  // A table name that would drop `users` if it were ever interpolated raw.
  const EVIL = 'x"; DROP TABLE users;--';

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "gsm-sqlite-"));
    dbPath = join(dir, "players.db");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL, avatar BLOB, note TEXT)");
      const insert = db.prepare("INSERT INTO users (name, score, avatar, note) VALUES (?, ?, ?, ?)");
      insert.run("alice", 12.5, Buffer.from("tiny-blob"), null);
      insert.run("bob", null, Buffer.alloc(1024, 0xab), "has a note");
      insert.run("carol", 0.5, null, null);
      db.exec(`CREATE TABLE ${quoteIdentifier(EVIL)} (id INTEGER PRIMARY KEY, v TEXT)`);
      db.exec(`INSERT INTO ${quoteIdentifier(EVIL)} (v) VALUES ('still here')`);
      db.exec("CREATE VIEW grownups AS SELECT * FROM users WHERE score IS NOT NULL");
      db.exec("CREATE TABLE withauto (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
      db.exec("INSERT INTO withauto (v) VALUES ('x')");
    } finally {
      db.close();
    }
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("lists tables and views with row counts, skipping sqlite internals", async () => {
    const tables = await listDbTables(dbPath);
    const byName = new Map(tables.map((t) => [t.name, t]));
    assert.ok(byName.has("users"), "users table listed");
    assert.ok(byName.has("grownups"), "view listed");
    assert.ok(byName.has(EVIL), "hostile table name listed");
    assert.ok(!byName.has("sqlite_sequence"), "sqlite_sequence hidden");
    assert.equal(byName.get("users")!.kind, "table");
    assert.equal(byName.get("users")!.rows, 3);
    assert.equal(byName.get("grownups")!.kind, "view");
    assert.equal(byName.get("grownups")!.rows, 2);
    assert.match(byName.get("users")!.sql || "", /CREATE TABLE users/);
  });

  test("reads rows with columns, types and pagination", async () => {
    const page1 = await readDbRows(dbPath, "users", { limit: 2, offset: 0 });
    assert.deepEqual(
      page1.columns.map((c) => c.name),
      ["id", "name", "score", "avatar", "note"]
    );
    assert.equal(page1.columns[1].type, "TEXT");
    assert.equal(page1.total, 3);
    assert.equal(page1.rows.length, 2);
    assert.deepEqual(page1.rows[0][1], "alice");
    assert.equal(page1.rows[0][4], null);

    const page2 = await readDbRows(dbPath, "users", { limit: 2, offset: 2 });
    assert.equal(page2.rows.length, 1);
    assert.deepEqual(page2.rows[0][1], "carol");
  });

  test("truncates blobs instead of shipping megabytes of base64", async () => {
    const page = await readDbRows(dbPath, "users", { limit: 10, offset: 0 });
    const avatarIdx = page.columns.findIndex((c) => c.name === "avatar");
    const small = page.rows[0][avatarIdx] as { $blob: boolean; bytes: number; truncated: boolean };
    const big = page.rows[1][avatarIdx] as { $blob: boolean; bytes: number; truncated: boolean; preview: string };
    assert.equal(small.$blob, true);
    assert.equal(small.bytes, 9);
    assert.equal(small.truncated, false);
    assert.equal(big.$blob, true);
    assert.equal(big.bytes, 1024);
    assert.equal(big.truncated, true);
    assert.equal(Buffer.from(big.preview, "base64").length, 256);
  });

  test("a hostile table name is browsed, not executed", async () => {
    const page = await readDbRows(dbPath, EVIL, {});
    assert.equal(page.rows.length, 1);
    // And the injection target survived.
    const users = await readDbRows(dbPath, "users", {});
    assert.equal(users.total, 3);
  });

  test("views are browsable", async () => {
    const page = await readDbRows(dbPath, "grownups", {});
    assert.equal(page.total, 2);
  });

  test("unknown tables fail cleanly", async () => {
    await assert.rejects(() => readDbRows(dbPath, "nope", {}), (e: unknown) => {
      assert.ok(e instanceof SqliteBrowseError);
      assert.equal(e.status, 404);
      return true;
    });
  });

  test("limits are clamped", async () => {
    const huge = await readDbRows(dbPath, "users", { limit: 99999 });
    assert.equal(huge.limit, 500);
    const zero = await readDbRows(dbPath, "users", { limit: 0 });
    assert.equal(zero.limit, 100);
    const negative = await readDbRows(dbPath, "users", { offset: -5 });
    assert.equal(negative.offset, 0);
  });

  test("non-databases fail with a friendly error", async () => {
    const fake = join(dir, "fake.db");
    await writeFile(fake, "this is definitely not sqlite");
    await assert.rejects(() => listDbTables(fake), /not a readable SQLite database/);
    await assert.rejects(() => readDbRows(fake, "users", {}), /not a readable SQLite database/);
  });

  test("browsing never modifies the database", async () => {
    const before = await listDbTables(dbPath);
    await readDbRows(dbPath, "users", { limit: 500 });
    const after = await listDbTables(dbPath);
    assert.deepEqual(after, before);
    const check = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tables = (check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
        (r) => r.name
      );
      assert.ok(!tables.some((t) => t.startsWith("x\";") === false && t.includes("DROP")), "no injected table created");
    } finally {
      check.close();
    }
  });
});

describe("server-file-ops: readText flags SQLite files", () => {
  let dir = "";

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "gsm-sqlite-flag-"));
    const dbPath = join(dir, "stats.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE t (a TEXT)");
    db.close();
    // A database past the text editor's 2 MB cap: header + zero padding
    // stays a valid "SQLite file" for magic purposes.
    const big = join(dir, "big.db");
    const header = Buffer.from("SQLite format 3\0", "latin1");
    await writeFile(big, Buffer.concat([header, Buffer.alloc(3 * 1024 * 1024)]));
    await writeFile(join(dir, "blob.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("a small .db reports binary with the sqlite hint", async () => {
    const r = await readText(dir, "stats.db");
    assert.equal(r.binary, true);
    assert.equal((r as { sqlite?: boolean }).sqlite, true);
  });

  test("an over-cap .db reports tooLarge with the sqlite hint", async () => {
    const r = await readText(dir, "big.db");
    assert.equal(r.tooLarge, true);
    assert.equal((r as { sqlite?: boolean }).sqlite, true);
  });

  test("a non-sqlite binary has no sqlite hint", async () => {
    const r = await readText(dir, "blob.bin");
    assert.equal(r.binary, true);
    assert.equal((r as { sqlite?: boolean }).sqlite, false);
  });
});

describe("node agent: db browse ops", () => {
  let dir = "";
  let srvDir = "";
  let handler: import("node:http").RequestListener;
  let server: import("node:http").Server | null = null;
  let base = "";
  const KEY = "agent-test-key";

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "gsm-agent-db-"));
    srvDir = join(dir, "srv1");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(srvDir, { recursive: true });
    const db = new DatabaseSync(join(srvDir, "players.db"));
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO users (name) VALUES ('alice'), ('bob')");
    db.close();
    await writeFile(join(srvDir, "fake.db"), "not sqlite");

    // @ts-ignore — the agent is a standalone .mjs with no type declarations
    const agent = await import("../agent/gsm-agent.mjs");
    handler = agent.createAgentHandler({ apiKey: KEY, root: dir });
    const http = await import("node:http");
    server = http.createServer(handler);
    await new Promise<void>((resolveP) => server!.listen(0, "127.0.0.1", resolveP));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolveP) => server!.close(() => resolveP()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function rpc(body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await fetch(`${base}/rpc/fs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  }

  test("dbtables lists tables on the agent", async () => {
    const { status, data } = await rpc({ op: "dbtables", installPath: srvDir, path: "players.db" });
    assert.equal(status, 200);
    assert.equal(data.type, "db");
    const tables = data.tables as Array<{ name: string; rows: number }>;
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, "users");
    assert.equal(tables[0].rows, 2);
  });

  test("dbrows pages through a remote table", async () => {
    const { status, data } = await rpc({
      op: "dbrows",
      installPath: srvDir,
      path: "players.db",
      table: "users",
      limit: 1,
      offset: 1,
    });
    assert.equal(status, 200);
    assert.equal(data.type, "dbrows");
    assert.equal(data.total, 2);
    assert.deepEqual((data.rows as unknown[][])[0][1], "bob");
  });

  test("non-databases and escapes are refused", async () => {
    const fake = await rpc({ op: "dbtables", installPath: srvDir, path: "fake.db" });
    assert.equal(fake.status, 400);
    assert.match(String(fake.data.error), /not a readable SQLite database/);

    const escape = await rpc({ op: "dbtables", installPath: srvDir, path: "../players.db" });
    assert.equal(escape.status, 400);

    const missing = await rpc({ op: "dbrows", installPath: srvDir, path: "players.db", table: "nope" });
    assert.equal(missing.status, 404);
  });
});
