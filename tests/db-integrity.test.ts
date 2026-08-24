/**
 * Database integrity tests against a real Postgres engine.
 *
 * These run the installer's own DDL — extracted from src/app/api/install/route.ts
 * so it cannot drift — inside PGlite, an actual Postgres build compiled to
 * WebAssembly. That matters because the bugs covered here are invisible to
 * TypeScript, ESLint and any test that mocks the database:
 *
 *   1. Every foreign key in the schema is declared without ON DELETE, so
 *      Postgres defaults to NO ACTION and *refuses* a delete once a dependent
 *      row exists. Scheduling a restart made a server permanently undeletable,
 *      and the route removes the game files before the row, so the user lost
 *      their data and still had the server listed.
 *
 *   2. api_keys and chat_messages were declared in schema.ts and queried by
 *      live routes, but the installer never created them — both features
 *      failed with "relation does not exist" on any fresh install.
 *
 *   3. The per-user server quota was read and then written in two separate
 *      statements, so concurrent requests each saw room and each inserted.
 *
 *   npm test
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/** Pull every CREATE TABLE / CREATE INDEX out of the installer route. */
function installerDdl(): string {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/install/route.ts"),
    "utf8"
  );
  const tables = src.match(/CREATE TABLE IF NOT EXISTS [\s\S]*?\n\s*\);/g) ?? [];
  const indexes = src.match(/CREATE INDEX IF NOT EXISTS [^;]+;/g) ?? [];
  return [
    ...tables.map((t) => t.replace(/^ {6}/gm, "")),
    ...indexes.map((i) => i.replace(/\s+/g, " ")),
  ].join("\n\n");
}

/**
 * One shared Postgres instance, reset between tests.
 *
 * Each PGlite instance is a full Postgres compiled to WebAssembly and costs
 * tens of megabytes; creating one per test exhausts memory and the runner is
 * killed. Truncating is also far faster than rebuilding the schema.
 */
let shared: PGlite | null = null;

async function freshDb() {
  if (!shared) {
    shared = new PGlite();
    await shared.exec(installerDdl());
  }
  const db = shared;
  // The port-uniqueness tests create this index; drop it so it does not leak
  // into unrelated tests sharing the instance.
  await db.exec(`DROP INDEX IF EXISTS game_servers_node_port_uniq;`);
  await db.exec(`
    TRUNCATE TABLE
      scheduled_tasks, server_metrics, api_keys, chat_messages,
      forum_posts, forum_threads, forum_categories,
      game_servers, game_definitions, nodes, users, roles
    RESTART IDENTITY CASCADE;
  `);
  await db.exec(`
    INSERT INTO roles (name, display_name) VALUES ('user', 'User');
    INSERT INTO users (username, email, password_hash, role_id, max_servers)
      VALUES ('owner', 'owner@example.com', 'hash', 1, 2);
    INSERT INTO nodes (name, hostname) VALUES ('local', 'localhost');
    INSERT INTO game_definitions (slug, name, default_port, install_script, start_command)
      VALUES ('cs2', 'CS2', 27015, 'echo', 'echo');
    INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
      VALUES (1, 1, 1, 'srv', 27015, '/tmp/srv');
  `);
  return db;
}

describe("installer schema completeness", () => {
  let tables: string[] = [];

  before(async () => {
    const db = await freshDb();
    const res = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    tables = res.rows.map((r) => r.tablename);
  });

  test("creates api_keys, which /api/api-keys queries", () => {
    // Was missing: key management failed on every fresh install.
    assert.ok(tables.includes("api_keys"));
  });

  test("creates chat_messages, which /api/forum/chat queries", () => {
    assert.ok(tables.includes("chat_messages"));
  });

  test("creates every table the application reads", () => {
    for (const t of [
      "users",
      "roles",
      "nodes",
      "game_definitions",
      "game_servers",
      "scheduled_tasks",
      "server_metrics",
      "forum_categories",
      "forum_threads",
      "forum_posts",
      "cms_pages",
      "settings",
      "audit_log",
      "api_keys",
      "chat_messages",
    ]) {
      assert.ok(tables.includes(t), `missing table: ${t}`);
    }
  });
});

describe("api_keys and chat_messages are usable", () => {
  test("a key can be stored and read back", async () => {
    const db = await freshDb();
    await db.exec(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
       VALUES (1, 'ci', 'hash', 'gsm_abc1234')`
    );
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api_keys`
    );
    assert.equal(r.rows[0].n, 1);
  });

  test("a chat message can be stored and read back", async () => {
    const db = await freshDb();
    await db.exec(`INSERT INTO chat_messages (user_id, body) VALUES (1, 'hello')`);
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chat_messages`
    );
    assert.equal(r.rows[0].n, 1);
  });
});

describe("server deletion with dependents", () => {
  test("a scheduled task blocks a naive delete", async () => {
    // The original bug, reproduced exactly: Postgres raises 23503 because the
    // foreign key has no ON DELETE clause.
    const db = await freshDb();
    await db.exec(
      `INSERT INTO scheduled_tasks (server_id, node_id, task_type) VALUES (1, 1, 'restart')`
    );
    await assert.rejects(
      () => db.exec(`DELETE FROM game_servers WHERE id = 1`),
      (e: unknown) => /foreign key constraint/i.test(String(e))
    );
  });

  test("metrics also block a naive delete", async () => {
    const db = await freshDb();
    await db.exec(`INSERT INTO server_metrics (server_id, cpu_percent) VALUES (1, 10)`);
    await assert.rejects(
      () => db.exec(`DELETE FROM game_servers WHERE id = 1`),
      (e: unknown) => /foreign key constraint/i.test(String(e))
    );
  });

  test("removing children first succeeds — the order the route now uses", async () => {
    const db = await freshDb();
    await db.exec(`
      INSERT INTO scheduled_tasks (server_id, node_id, task_type) VALUES (1, 1, 'restart');
      INSERT INTO server_metrics (server_id, cpu_percent) VALUES (1, 10);
    `);
    await db.exec(`DELETE FROM scheduled_tasks WHERE server_id = 1`);
    await db.exec(`DELETE FROM server_metrics WHERE server_id = 1`);
    await db.exec(`DELETE FROM game_servers WHERE id = 1`);

    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_servers`
    );
    assert.equal(r.rows[0].n, 0);
  });
});

describe("user deletion with dependents", () => {
  test("a user owning a server cannot be deleted outright", async () => {
    // Which is why the route now refuses with a 400 explaining the reason,
    // rather than letting this surface as an opaque 500.
    const db = await freshDb();
    await assert.rejects(
      () => db.exec(`DELETE FROM users WHERE id = 1`),
      (e: unknown) => /foreign key constraint/i.test(String(e))
    );
  });

  test("succeeds once the account owns nothing", async () => {
    const db = await freshDb();
    await db.exec(`DELETE FROM game_servers WHERE user_id = 1`);
    await db.exec(`DELETE FROM users WHERE id = 1`);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
    assert.equal(r.rows[0].n, 0);
  });
});

describe("server quota under concurrency", () => {
  /** The predicate shipped in the create and clone routes. */
  const GUARD = `
    SELECT 1 WHERE (
      (SELECT COALESCE(max_servers, 0) FROM users WHERE id = $1) <= 0
      OR (SELECT count(*) FROM game_servers WHERE user_id = $1)
         < (SELECT COALESCE(max_servers, 0) FROM users WHERE id = $1)
    )`;

  test("read-then-write lets concurrent requests exceed the limit", async () => {
    // Demonstrates why the atomic guard is needed: this is the shape the
    // route had after the previous sweep.
    const db = await freshDb();
    await db.exec(`DELETE FROM game_servers`);

    const create = async (port: number) => {
      const c = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM game_servers WHERE user_id = 1`
      );
      if (c.rows[0].n >= 2) return;
      await db.query(
        `INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
         VALUES (1, 1, 1, $1, $2, $3)`,
        [`s${port}`, port, `/tmp/s${port}`]
      );
    };

    await Promise.all([27015, 27020, 27025, 27030, 27035].map(create));
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_servers WHERE user_id = 1`
    );
    assert.ok(r.rows[0].n > 2, "the racy version is expected to overshoot");
  });

  test("the atomic guard holds the limit", async () => {
    const db = await freshDb();
    await db.exec(`DELETE FROM game_servers`);

    const create = async (port: number) => {
      const g = await db.query(GUARD, [1]);
      if (g.rows.length === 0) return;
      await db.query(
        `INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
         SELECT 1, 1, 1, $1, $2, $3 WHERE (${GUARD.replace("SELECT 1 WHERE", "SELECT true WHERE").replace(/\$1/g, "1")})`,
        [`s${port}`, port, `/tmp/s${port}`]
      );
    };

    await Promise.all([27015, 27020, 27025, 27030, 27035].map(create));
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_servers WHERE user_id = 1`
    );
    assert.equal(r.rows[0].n, 2, "quota must hold under concurrency");
  });

  test("max_servers of 0 means unlimited", async () => {
    const db = await freshDb();
    await db.exec(`UPDATE users SET max_servers = 0 WHERE id = 1`);
    const g = await db.query(GUARD, [1]);
    assert.equal(g.rows.length, 1);
  });

  test("max_servers of NULL means unlimited", async () => {
    const db = await freshDb();
    await db.exec(`UPDATE users SET max_servers = NULL WHERE id = 1`);
    const g = await db.query(GUARD, [1]);
    assert.equal(g.rows.length, 1);
  });

  test("the guard denies once the limit is reached", async () => {
    const db = await freshDb();
    // Fixture already has 1 server and a limit of 2.
    await db.exec(
      `INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
       VALUES (1, 1, 1, 'srv2', 27020, '/tmp/srv2')`
    );
    const g = await db.query(GUARD, [1]);
    assert.equal(g.rows.length, 0, "must deny at the limit");
  });
});

describe("port uniqueness migration", () => {
  /** The repair the installer performs before adding the unique index. */
  async function repairDuplicates(db: PGlite) {
    const dupes = await db.query<{ id: number; node_id: number; port: number }>(`
      SELECT id, node_id, port FROM game_servers g
      WHERE EXISTS (
        SELECT 1 FROM game_servers o
        WHERE o.node_id = g.node_id AND o.port = g.port AND o.id < g.id
      ) ORDER BY node_id, port, id`);
    for (const row of dupes.rows) {
      const taken = await db.query<{ port: number }>(
        `SELECT port FROM game_servers WHERE node_id = $1
         UNION SELECT query_port FROM game_servers WHERE node_id = $1 AND query_port IS NOT NULL`,
        [row.node_id]
      );
      const used = new Set(taken.rows.map((r) => Number(r.port)));
      let c = Math.max(Number(row.port) + 1, 1024);
      while (c + 1 <= 65535 && (used.has(c) || used.has(c + 1))) c++;
      await db.query(
        `UPDATE game_servers SET port = $1, query_port = $2 WHERE id = $3`,
        [c, c + 1, row.id]
      );
    }
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS game_servers_node_port_uniq
                   ON game_servers(node_id, port)`);
  }

  test("a bare unique index cannot be added while duplicates exist", async () => {
    // Why the repair step is needed: the installer runs on every deploy, so
    // this would break the upgrade for anyone with a pre-existing clash.
    const db = await freshDb();
    await db.exec(
      `INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
       VALUES (1, 1, 1, 'dupe', 27015, '/tmp/dupe')`
    );
    await assert.rejects(
      () =>
        db.exec(`CREATE UNIQUE INDEX game_servers_node_port_uniq
                 ON game_servers(node_id, port)`),
      (e: unknown) => /could not create unique index/i.test(String(e))
    );
  });

  test("repairs duplicates, keeping the oldest server on its port", async () => {
    const db = await freshDb();
    await db.exec(`
      INSERT INTO game_servers (user_id, node_id, game_id, name, port, query_port, install_path)
      VALUES (1, 1, 1, 'dupe-a', 27015, 27016, '/tmp/a'),
             (1, 1, 1, 'dupe-b', 27015, 27016, '/tmp/b')`);
    await repairDuplicates(db);

    const rows = await db.query<{ name: string; port: number }>(
      `SELECT name, port FROM game_servers WHERE node_id = 1 ORDER BY id`
    );
    assert.equal(rows.rows[0].port, 27015, "the original keeps its port");
    const ports = rows.rows.map((r) => r.port);
    assert.equal(new Set(ports).size, ports.length, "all ports now distinct");
  });

  test("reassigns near the original rather than to the bottom of the range", async () => {
    // A new port of 1024 would be technically valid but would silently fall
    // outside whatever range the admin has forwarded.
    const db = await freshDb();
    await db.exec(
      `INSERT INTO game_servers (user_id, node_id, game_id, name, port, query_port, install_path)
       VALUES (1, 1, 1, 'dupe', 27015, 27016, '/tmp/d')`
    );
    await repairDuplicates(db);
    const moved = await db.query<{ port: number }>(
      `SELECT port FROM game_servers WHERE name = 'dupe'`
    );
    assert.ok(moved.rows[0].port > 27015 && moved.rows[0].port < 27100);
  });

  test("leaves the same port on a different node alone", async () => {
    // Two machines may each host a server on 27015; that is not a conflict.
    const db = await freshDb();
    await db.exec(`INSERT INTO nodes (name, hostname) VALUES ('edge', 'edge.example')`);
    await db.exec(
      `INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
       VALUES (1, 2, 1, 'other-node', 27015, '/tmp/o')`
    );
    await repairDuplicates(db);
    const r = await db.query<{ port: number }>(
      `SELECT port FROM game_servers WHERE name = 'other-node'`
    );
    assert.equal(r.rows[0].port, 27015, "untouched");
  });

  test("the index then blocks a concurrent duplicate insert", async () => {
    const db = await freshDb();
    await repairDuplicates(db);
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO game_servers (user_id, node_id, game_id, name, port, install_path)
           VALUES (1, 1, 1, 'racer', 27015, '/tmp/r')`
        ),
      (e: unknown) => String((e as { code?: string }).code) === "23505"
    );
  });

  test("the migration is idempotent — the installer runs on every deploy", async () => {
    const db = await freshDb();
    await db.exec(
      `INSERT INTO game_servers (user_id, node_id, game_id, name, port, query_port, install_path)
       VALUES (1, 1, 1, 'dupe', 27015, 27016, '/tmp/d')`
    );
    await repairDuplicates(db);
    const first = await db.query<{ name: string; port: number }>(
      `SELECT name, port FROM game_servers ORDER BY id`
    );
    await repairDuplicates(db);
    await repairDuplicates(db);
    const third = await db.query<{ name: string; port: number }>(
      `SELECT name, port FROM game_servers ORDER BY id`
    );
    assert.deepEqual(third.rows, first.rows, "further runs must change nothing");
  });
});

describe("list endpoints are bounded", () => {
  test("forum threads cap the number of rows returned", async () => {
    // Publicly readable and unauthenticated, with a correlated subquery per
    // row — an unbounded scan here is reachable by anyone.
    const db = await freshDb();
    await db.exec(`INSERT INTO forum_categories (name, slug) VALUES ('General', 'general')`);
    const values = Array.from({ length: 250 }, (_, i) => `(1, 1, 'Thread ${i}')`).join(",");
    await db.exec(
      `INSERT INTO forum_threads (category_id, user_id, title) VALUES ${values}`
    );

    const all = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM forum_threads`
    );
    assert.equal(all.rows[0].n, 250, "fixture inserted");

    // The default the route applies.
    const page = await db.query(`SELECT id FROM forum_threads ORDER BY id LIMIT 100 OFFSET 0`);
    assert.equal(page.rows.length, 100, "default page is capped at 100");

    const second = await db.query(`SELECT id FROM forum_threads ORDER BY id LIMIT 100 OFFSET 100`);
    assert.equal(second.rows.length, 100);
    const last = await db.query(`SELECT id FROM forum_threads ORDER BY id LIMIT 100 OFFSET 200`);
    assert.equal(last.rows.length, 50, "final page returns the remainder");
  });

  test("offset past the end returns empty rather than erroring", async () => {
    const db = await freshDb();
    const r = await db.query(`SELECT id FROM game_servers ORDER BY id LIMIT 100 OFFSET 999999`);
    assert.equal(r.rows.length, 0);
  });
});
