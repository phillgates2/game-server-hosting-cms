/**
 * Settings import atomicity.
 *
 * POST /api/settings/import used to apply settings and roles row by row with
 * independent statements, so a bad entry halfway through left half the import
 * applied and no way to tell which half. The route now imports inside one
 * transaction, upserting settings in a single statement, and only invalidates
 * the role cache after the commit.
 *
 * These tests reproduce the route's SQL against PGlite and assert the two
 * properties that matter: the upsert updates rather than duplicates, and a
 * failure mid-import leaves the database untouched.
 *
 *   npm test
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE settings (
      id serial PRIMARY KEY,
      key varchar(128) NOT NULL UNIQUE,
      value text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE roles (
      id serial PRIMARY KEY,
      name varchar(64) NOT NULL UNIQUE,
      display_name varchar(128) NOT NULL,
      is_system boolean NOT NULL DEFAULT false,
      permissions jsonb NOT NULL DEFAULT '{}'
    );
  `);
});

/** The single-statement upsert the route now uses for settings. */
async function upsertSettings(rows: Array<{ key: string; value: string }>) {
  const values = rows
    .map((r) => `('${r.key.replace(/'/g, "''")}', '${r.value.replace(/'/g, "''")}', now())`)
    .join(", ");
  await db.exec(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ${values}
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
  `);
}

describe("settings import", () => {
  test("upserting the same key twice updates the value instead of duplicating", async () => {
    await upsertSettings([{ key: "panel_name", value: "My Panel" }]);
    await upsertSettings([
      { key: "panel_name", value: "Renamed" },
      { key: "hero_title", value: "Welcome" },
    ]);
    const all = await db.query<{ key: string; value: string }>("SELECT key, value FROM settings ORDER BY key");
    const names = all.rows.map((r) => r.key);
    assert.deepEqual(names, ["hero_title", "panel_name"], "no duplicate keys, all rows present");
    assert.equal(all.rows.find((r) => r.key === "panel_name")?.value, "Renamed");
  });

  test("a failure mid-import rolls everything back", async () => {
    const before = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM settings");

    try {
      await db.exec("BEGIN");
      await upsertSettings([{ key: "announcement", value: "Maintenance tonight" }]);
      // A role name over the varchar(64) column width aborts the transaction.
      await db.exec(`INSERT INTO roles (name, display_name, permissions)
        VALUES ('${"x".repeat(80)}', 'Too long', '{}')`);
      await db.exec("COMMIT");
      assert.fail("the long role name should have aborted the transaction");
    } catch {
      await db.exec("ROLLBACK");
    }

    const after = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM settings");
    assert.equal(after.rows[0].n, before.rows[0].n, "no partial settings may survive");
    const ann = await db.query("SELECT 1 FROM settings WHERE key = 'announcement'");
    assert.equal(ann.rows.length, 0);
  });
});
