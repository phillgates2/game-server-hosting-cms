/**
 * Regression tests for the panel updater (public/update.sh).
 *
 * The updater used to run `npx drizzle-kit push` with no --config, so
 * drizzle-kit fell back to the tracked drizzle.config.json — a file that only
 * carries development placeholder credentials, because the installer
 * deliberately restores the tracked copy and keeps the real database URL in
 * .env. The migration step then pulled the schema from (or pushed it into) the
 * wrong database, and every update aborted at "Applying database migrations"
 * with "Cannot continue with an unapplied database schema".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "..");
const updateSh = readFileSync(path.join(root, "public", "update.sh"), "utf8");

function extractFunction(source: string, name: string): string {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(match, `${name}() not found in update.sh`);
  return match[0];
}

test("update.sh is syntactically valid bash", () => {
  const result = spawnSync("bash", ["-n", path.join(root, "public", "update.sh")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("the updater never pushes the schema with the tracked placeholder config", () => {
  assert.doesNotMatch(
    updateSh,
    /npx drizzle-kit push(?! --config)/,
    "every drizzle-kit push must pass --config with the real DATABASE_URL"
  );
  assert.match(updateSh, /drizzle-kit push --config \$DRIZZLE_UPDATE_CONFIG_Q/);
  assert.doesNotMatch(updateSh, />\s*drizzle\.config\.json/, "credentials must not be written into the tracked config");
});

test("the updater builds the push config from .env and removes it afterwards", () => {
  assert.match(
    updateSh,
    /grep -E "\^DATABASE_URL=" "\$INSTALL_DIR\/\.env"/,
    "the push config must use the DATABASE_URL the panel itself uses"
  );
  const removals = updateSh.match(/rm -f -- "\$DRIZZLE_UPDATE_CONFIG"/g) ?? [];
  assert.ok(removals.length >= 2, "the throwaway config must be removed on success and on failure");
  assert.match(updateSh, /rm -f -- "\$DRIZZLE_UPDATE_CONFIG"' EXIT/, "the EXIT trap must clean up too");
});

test("migration failures name the migration log", () => {
  assert.match(updateSh, /die "[^"]*migration log \(\$DRIZZLE_LOG\)/);
});

test("json_escape round-trips database URLs through the JSON config body", () => {
  const values = [
    "postgresql://user:pass@127.0.0.1:5432/app_db",
    'postgresql://user:pa"ss\\word@127.0.0.1:5432/app_db',
    "postgresql://user:$(echo x)`tick`@127.0.0.1:5432/app_db",
  ];
  const script = [
    extractFunction(updateSh, "json_escape"),
    ...values.map((value, i) => `printf '%s\\n' "$(json_escape "$VALUE_${i}")"`),
  ].join("\n");
  const env: Record<string, string> = {};
  values.forEach((value, i) => {
    env[`VALUE_${i}`] = value;
  });
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  lines.forEach((line, i) => {
    // Each escaped value must survive being placed inside a JSON string body —
    // exactly how the updater writes dbCredentials.url.
    assert.equal(JSON.parse(`"${line}"`), values[i], `value ${i} did not round-trip`);
  });
});
