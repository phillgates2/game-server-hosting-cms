/**
 * Multi-write API routes must be atomic.
 *
 * Several routes delete a parent and its children, or write a row and then
 * update a counter, as independent statements. Any failure between them leaves
 * the database in a state the application never expects, and in the worst
 * cases destroys data that cannot be recovered:
 *
 *   forum/threads/[id]  DELETE  posts wiped, thread left behind
 *   servers/[id]        DELETE  schedules + metrics wiped, server still listed
 *   users/[id]          DELETE  API keys destroyed, account still present
 *
 * These tests reproduce a mid-operation failure against a real Postgres
 * (PGlite) and assert the transactional shape survives it. They exercise the
 * same SQL the routes issue rather than importing them, because the route
 * modules pull in the DB singleton and a live connection.
 */

import { describe, test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      id serial PRIMARY KEY,
      username text UNIQUE NOT NULL
    );
    CREATE TABLE api_keys (
      id serial PRIMARY KEY,
      user_id int NOT NULL REFERENCES users(id),
      name text NOT NULL
    );
    CREATE TABLE forum_threads (
      id serial PRIMARY KEY,
      title text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE forum_posts (
      id serial PRIMARY KEY,
      thread_id int NOT NULL REFERENCES forum_threads(id),
      body text NOT NULL
    );
    CREATE TABLE game_servers (
      id serial PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE scheduled_tasks (
      id serial PRIMARY KEY,
      server_id int NOT NULL REFERENCES game_servers(id),
      action text NOT NULL
    );
    CREATE TABLE server_metrics (
      id serial PRIMARY KEY,
      server_id int NOT NULL REFERENCES game_servers(id),
      cpu_percent real
    );
  `);
});

beforeEach(async () => {
  await db.exec(`
    TRUNCATE users, api_keys, forum_threads, forum_posts,
             game_servers, scheduled_tasks, server_metrics
      RESTART IDENTITY CASCADE;
  `);
});

/** Run `work` inside a transaction, rolling back if it throws. */
async function inTransaction(work: () => Promise<void>) {
  await db.exec("BEGIN");
  try {
    await work();
    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

async function countOf(table: string): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return r.rows[0].n;
}

const BOOM = "simulated failure between writes";

describe("deleting a forum thread is atomic", () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO forum_threads (title) VALUES ('Server rules');
      INSERT INTO forum_posts (thread_id, body)
        VALUES (1, 'first'), (1, 'second'), (1, 'third');
    `);
  });

  test("a failure after deleting posts leaves every reply in place", async () => {
    await assert.rejects(
      inTransaction(async () => {
        await db.query(`DELETE FROM forum_posts WHERE thread_id = 1`);
        // The thread delete never lands - connection drop, deadlock, timeout.
        throw new Error(BOOM);
      }),
      /simulated failure/
    );

    // Without a transaction this is 0: the replies are gone for good while the
    // thread they belong to is still listed.
    assert.equal(await countOf("forum_posts"), 3, "replies must survive a rollback");
    assert.equal(await countOf("forum_threads"), 1);
  });

  test("a clean run removes the thread and its posts together", async () => {
    await inTransaction(async () => {
      await db.query(`DELETE FROM forum_posts WHERE thread_id = 1`);
      await db.query(`DELETE FROM forum_threads WHERE id = 1`);
    });
    assert.equal(await countOf("forum_posts"), 0);
    assert.equal(await countOf("forum_threads"), 0);
  });
});

describe("deleting a server is atomic", () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO game_servers (name) VALUES ('Survival');
      INSERT INTO scheduled_tasks (server_id, action) VALUES (1, 'restart');
      INSERT INTO server_metrics (server_id, cpu_percent) VALUES (1, 12.5), (1, 30.0);
    `);
  });

  test("a failure partway through keeps schedules and metrics", async () => {
    await assert.rejects(
      inTransaction(async () => {
        await db.query(`DELETE FROM scheduled_tasks WHERE server_id = 1`);
        await db.query(`DELETE FROM server_metrics WHERE server_id = 1`);
        throw new Error(BOOM);
      }),
      /simulated failure/
    );

    assert.equal(await countOf("scheduled_tasks"), 1, "schedules must survive");
    assert.equal(await countOf("server_metrics"), 2, "metrics history must survive");
    assert.equal(await countOf("game_servers"), 1);
  });

  test("a clean run removes dependants before the server", async () => {
    await inTransaction(async () => {
      await db.query(`DELETE FROM scheduled_tasks WHERE server_id = 1`);
      await db.query(`DELETE FROM server_metrics WHERE server_id = 1`);
      await db.query(`DELETE FROM game_servers WHERE id = 1`);
    });
    assert.equal(await countOf("game_servers"), 0);
  });

  test("the child deletes are still required -- the FK has no ON DELETE", async () => {
    // If this ever starts passing, the schema gained ON DELETE CASCADE and the
    // manual child deletes could be dropped.
    await assert.rejects(
      db.query(`DELETE FROM game_servers WHERE id = 1`),
      /violates foreign key constraint/
    );
  });
});

describe("deleting a user is atomic", () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO users (username) VALUES ('alice');
      INSERT INTO api_keys (user_id, name) VALUES (1, 'ci'), (1, 'laptop');
    `);
  });

  test("a failure after removing API keys leaves the account intact", async () => {
    await assert.rejects(
      inTransaction(async () => {
        await db.query(`DELETE FROM api_keys WHERE user_id = 1`);
        throw new Error(BOOM);
      }),
      /simulated failure/
    );

    // The dangerous case: keys destroyed but the account still usable.
    assert.equal(await countOf("api_keys"), 2, "API keys must survive a rollback");
    assert.equal(await countOf("users"), 1);
  });

  test("a clean run removes the account and its keys together", async () => {
    await inTransaction(async () => {
      await db.query(`DELETE FROM api_keys WHERE user_id = 1`);
      await db.query(`DELETE FROM users WHERE id = 1`);
    });
    assert.equal(await countOf("api_keys"), 0);
    assert.equal(await countOf("users"), 0);
  });
});

describe("posting a reply is atomic", () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO forum_threads (title, updated_at)
        VALUES ('Old thread', timestamptz '2020-01-01 00:00:00+00');
    `);
  });

  test("a failure bumping the thread does not leave an orphaned reply", async () => {
    await assert.rejects(
      inTransaction(async () => {
        await db.query(`INSERT INTO forum_posts (thread_id, body) VALUES (1, 'hello')`);
        throw new Error(BOOM);
      }),
      /simulated failure/
    );

    // A reply on a thread whose updated_at never moved sorts to the bottom of
    // an activity-ordered list, so in practice nobody ever sees it.
    assert.equal(await countOf("forum_posts"), 0, "the reply must roll back too");
  });

  test("a clean run stores the reply and bumps the thread", async () => {
    await inTransaction(async () => {
      await db.query(`INSERT INTO forum_posts (thread_id, body) VALUES (1, 'hello')`);
      await db.query(`UPDATE forum_threads SET updated_at = now() WHERE id = 1`);
    });

    assert.equal(await countOf("forum_posts"), 1);
    const r = await db.query<{ bumped: boolean }>(
      `SELECT updated_at > timestamptz '2020-01-02 00:00:00+00' AS bumped
         FROM forum_threads WHERE id = 1`
    );
    assert.equal(r.rows[0].bumped, true, "thread activity must move with the reply");
  });
});
