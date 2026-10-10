import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { escapeIdentifier, type Pool } from "pg";
import { databasePasswordChange, changeInstallDatabasePassword } from "../src/lib/install-database";
import { installErrorMessage } from "../src/lib/install-error";

const db = new PGlite();
after(() => db.close());

test("ALTER ROLE rejects placeholders but accepts correctly escaped passwords and configured roles", async () => {
  const role = 'panel"operator';
  await db.exec(`CREATE ROLE ${escapeIdentifier(role)} LOGIN`);
  await db.exec("CREATE TABLE password_change_sentinel (id int)");
  await assert.rejects(db.query(`ALTER ROLE ${escapeIdentifier(role)} WITH PASSWORD $1`, ["secret"]), /syntax error/);
  for (const password of ["normal-password", "' ; DROP TABLE password_change_sentinel; --", "back\\slash'quote", "p@ss:#%?/ ü", "%40literal"]) {
    const url = `postgresql://${encodeURIComponent(role)}:old@localhost/panel`;
    const change = databasePasswordChange(url, password);
    await db.exec(change.statement);
    assert.equal(decodeURIComponent(new URL(change.databaseUrl).password), password);
    assert.equal(decodeURIComponent(new URL(change.databaseUrl).username), role);
    await db.query("SELECT * FROM password_change_sentinel");
  }
});

test("invalid password/configuration is rejected rather than using a fallback database", () => {
  for (const password of ["", "bad\0password", "bad\npassword", "bad\rpassword"]) {
    assert.throws(() => databasePasswordChange("postgresql://operator:old@localhost/panel", password));
  }
  for (const url of ["", "not a url", "https://operator@localhost/panel", "postgresql://localhost/panel"]) {
    assert.throws(() => databasePasswordChange(url, "secret"));
  }
});

test("password rotation persists credentials, refreshes the pool, and rolls back failures", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "install-password-"));
  const envFile = path.join(dir, ".env");
  const originalUrl = process.env.DATABASE_URL;
  const url = "postgresql://operator:old@localhost/panel";
  const oldContents = `# retain comments\nGSM_PANEL_MASTER_KEY=keep-this\n export DATABASE_URL = ${url}\n`;
  const calls: string[] = [];
  let failCommit = false;
  const pool = {
    options: { connectionString: url, password: "old" },
    connect: async () => ({
      query: async (sql: string) => {
        calls.push(sql);
        if (failCommit && sql === "COMMIT") throw new Error("commit failed");
      },
      release: () => calls.push("release"),
    }),
  } as unknown as Pool;
  try {
    process.env.DATABASE_URL = url;
    await fs.writeFile(envFile, oldContents);
    await changeInstallDatabasePassword(pool, "new'password", envFile);
    assert.deepEqual(calls.map((sql) => sql.startsWith("ALTER ROLE") ? "ALTER ROLE" : sql), ["BEGIN", "ALTER ROLE", "COMMIT", "release"]);
    const saved = await fs.readFile(envFile, "utf8");
    assert.ok(saved.includes("# retain comments\nGSM_PANEL_MASTER_KEY=keep-this"));
    assert.equal((saved.match(/DATABASE_URL/g) ?? []).length, 1);
    assert.ok(saved.includes(`DATABASE_URL=${process.env.DATABASE_URL}`));
    assert.equal(pool.options.connectionString, process.env.DATABASE_URL);
    assert.equal(pool.options.password, "new'password");
    assert.equal((await fs.stat(envFile)).mode & 0o777, 0o600);

    // A file-write failure must not commit the database credential change.
    const currentUrl = process.env.DATABASE_URL;
    calls.length = 0;
    await assert.rejects(changeInstallDatabasePassword(pool, "different", path.join(dir, "missing", ".env")));
    assert.ok(calls.includes("ROLLBACK"));
    assert.ok(!calls.includes("COMMIT"));
    assert.equal(process.env.DATABASE_URL, currentUrl);

    // If commit fails, restore the original file and keep the pool unchanged.
    calls.length = 0;
    failCommit = true;
    await assert.rejects(changeInstallDatabasePassword(pool, "different", envFile), /commit failed/);
    assert.equal(await fs.readFile(envFile, "utf8"), saved);
    assert.equal(pool.options.connectionString, currentUrl);
    assert.equal(process.env.DATABASE_URL, currentUrl);
    assert.ok(calls.includes("ROLLBACK"));
    assert.equal(calls.at(-1), "release");
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("installer errors are actionable without disclosing database internals", () => {
  for (const [code, expected] of [
    ["28P01", /authentication failed/],
    ["ECONNREFUSED", /Cannot connect/],
    ["42501", /lacks permission/],
    ["42703", /out of date/],
    ["23505", /already in use/],
    ["EACCES", /cannot write/],
  ] as const) {
    const error = new Error("SQL and secret password", { cause: { code, message: "private details" } });
    const message = installErrorMessage(error, "schema creation");
    assert.match(message, expected);
    assert.doesNotMatch(message, /secret|private details|SQL and/);
  }
  const cycle = { cause: null as unknown };
  cycle.cause = cycle;
  assert.match(installErrorMessage(cycle, "admin account creation"), /admin account creation.*pm2 logs/);
});

test("the route rotates after seeding and marks installed only after rotation", async () => {
  const route = await fs.readFile("src/app/api/install/route.ts", "utf8");
  const rotate = route.indexOf("await changeInstallDatabasePassword(");
  const installed = route.indexOf('values({ key: "installed", value: "true" })');
  assert.ok(rotate > route.indexOf('await logStep("settings", "done"'));
  assert.ok(installed > rotate);
  assert.ok(!route.includes('"pm2", ["restart"'));
});
