/**
 * The `transfer.*` permission set.
 *
 * File transfer is a second door into the same disk as the file manager, so it
 * gets its own permissions rather than borrowing `servers.files`: a role can be
 * allowed to push files over FTP without being able to browse the panel, or the
 * reverse. These tests pin the set itself, the defaults a fresh install gets,
 * and the fact that every gate in the feature actually reads those keys.
 */
process.env.DATABASE_URL ??= "postgres://placeholder:placeholder@127.0.0.1:1/gsm_test";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateKeyScope } from "../src/lib/server-lifecycle";
import { scopeAllows } from "../src/lib/key-scope";

/** Lazy so the placeholder DATABASE_URL above is in place before the pool loads. */
const loadPermissions = () => import("../src/lib/permissions");

const TRANSFER_KEYS = [
  "transfer.view",
  "transfer.manage",
  "transfer.disconnect",
  "transfer.any",
  "transfer.settings",
] as const;

/** Read a source file relative to the repo root (tests run from there). */
function source(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("the file transfer permission category", () => {
  test("exists, is labelled, and holds exactly the transfer keys", async () => {
    const { PERMISSION_CATEGORIES } = await loadPermissions();
    const category = (PERMISSION_CATEGORIES as Record<string, { label: string; permissions: Record<string, string> }>)
      .transfer;
    assert.ok(category, "expected a `transfer` category");
    assert.ok(category.label.length > 0);
    assert.deepEqual(Object.keys(category.permissions).sort(), [...TRANSFER_KEYS].sort());
  });

  test("every key carries a human label and lands in ALL_PERMISSIONS", async () => {
    const { ALL_PERMISSIONS, PERMISSION_CATEGORIES } = await loadPermissions();
    for (const key of TRANSFER_KEYS) {
      assert.ok(ALL_PERMISSIONS.includes(key), `${key} is missing from ALL_PERMISSIONS`);
    }
    const labels = Object.values(
      PERMISSION_CATEGORIES as Record<string, { permissions: Record<string, string> }>
    ).flatMap((cat) => Object.entries(cat.permissions));
    for (const [key, label] of labels) {
      assert.ok(label.trim().length > 0, `${key} has no label`);
    }
  });

  test("no permission key is declared in two categories", async () => {
    const { PERMISSION_CATEGORIES } = await loadPermissions();
    const seen = new Set<string>();
    for (const cat of Object.values(PERMISSION_CATEGORIES as Record<string, { permissions: Record<string, string> }>)) {
      for (const key of Object.keys(cat.permissions)) {
        assert.ok(!seen.has(key), `${key} is declared twice`);
        seen.add(key);
      }
    }
  });

  test("ALL_PERMISSIONS is exactly the union of the categories, with no duplicates", async () => {
    const { ALL_PERMISSIONS, PERMISSION_CATEGORIES } = await loadPermissions();
    const declared = Object.values(
      PERMISSION_CATEGORIES as Record<string, { permissions: Record<string, string> }>
    ).flatMap((cat) => Object.keys(cat.permissions));
    assert.deepEqual([...ALL_PERMISSIONS].sort(), [...declared].sort());
    assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
  });

  test("the keys are addressable from an API key scope", async () => {
    const { ALL_PERMISSIONS } = await loadPermissions();
    const scope = Object.fromEntries(TRANSFER_KEYS.map((key) => [key, true]));
    const checked = validateKeyScope(scope, ALL_PERMISSIONS);
    assert.equal(checked.error, null);
    assert.deepEqual(checked.scope, scope);

    // A key scoped to reading may not mint or re-key a login.
    const readOnly = { "transfer.view": true };
    assert.equal(scopeAllows(readOnly, "transfer.view"), true);
    assert.equal(scopeAllows(readOnly, "transfer.manage"), false);
    assert.equal(scopeAllows(readOnly, "transfer.settings"), false);
    // Unscoped keys stay unrestricted; a forgotten scope fails closed.
    assert.equal(scopeAllows(null, "transfer.manage"), true);
    assert.equal(scopeAllows(undefined, "transfer.view"), false);
  });
});

describe("default roles", () => {
  test("the administrator role holds every transfer permission", async () => {
    const { DEFAULT_ROLES } = await loadPermissions();
    const admin = DEFAULT_ROLES.find((role) => role.name === "admin");
    assert.ok(admin);
    for (const key of TRANSFER_KEYS) {
      assert.equal(admin.permissions[key], true, `admin is missing ${key}`);
    }
  });

  test("the moderator can run transfers but not re-key other people's logins or the listener", async () => {
    const { DEFAULT_ROLES } = await loadPermissions();
    const moderator = DEFAULT_ROLES.find((role) => role.name === "moderator");
    assert.ok(moderator);
    assert.equal(moderator.permissions["transfer.view"], true);
    assert.equal(moderator.permissions["transfer.manage"], true);
    assert.equal(moderator.permissions["transfer.disconnect"], true);
    assert.equal(moderator.permissions["transfer.any"], undefined);
    assert.equal(moderator.permissions["transfer.settings"], undefined);
  });

  test("the plain user role is not handed the transfer service by default", async () => {
    // Deliberate: the default `user` role has no `servers.files` either, so
    // files are staff-only until an operator grants them. Widening this default
    // would silently hand every signup an FTP credential path.
    const { DEFAULT_ROLES } = await loadPermissions();
    const user = DEFAULT_ROLES.find((role) => role.name === "user");
    assert.ok(user);
    for (const key of TRANSFER_KEYS) {
      assert.equal(user.permissions[key], undefined, `the user role gained ${key}`);
    }
  });

  test("no default role references a permission that does not exist", async () => {
    const { ALL_PERMISSIONS, DEFAULT_ROLES } = await loadPermissions();
    const known = new Set(ALL_PERMISSIONS);
    for (const role of DEFAULT_ROLES) {
      for (const key of Object.keys(role.permissions)) {
        assert.ok(known.has(key), `${role.name} references unknown permission ${key}`);
      }
    }
  });
});

describe("the feature's gates read the new keys", () => {
  const route = () => source("src/app/api/file-transfer/route.ts");
  const settingsRoute = () => source("src/app/api/settings/file-transfer/route.ts");
  const transferLib = () => source("src/lib/file-transfer.ts");
  const dashboard = () => source("src/components/Dashboard.tsx");

  test("the panel data route requires transfer.view and no longer borrows servers.files", () => {
    const text = route();
    assert.match(text, /hasPermission\(auth\.userId, "transfer\.view", auth\.keyScope\)/);
    assert.ok(!text.includes('"servers.files"'), "the transfer route should not gate on servers.files");
  });

  test("each account action is gated by its own key", () => {
    const text = route();
    for (const key of ["transfer.manage", "transfer.disconnect", "transfer.any", "transfer.settings"] as const) {
      assert.ok(
        text.includes(`hasPermission(auth.userId, "${key}", auth.keyScope)`),
        `${key} is not read by the transfer route`
      );
    }
    // …and the gate is applied per action, not once for the whole route.
    assert.match(text, /const requireManage = \(\) => canManage \|\| canAny;/);
    assert.match(text, /const requireDisconnect = \(\) => canDisconnect \|\| canAny;/);
    assert.match(text, /if \(!requireManage\(\)\) return NextResponse\.json\(\{ error: "Permission denied" \}, \{ status: 403 \}\);/);
  });

  test("owning another user's login needs transfer.any, not panel.settings", () => {
    const text = route();
    assert.match(text, /const canAny = await hasPermission\(auth\.userId, "transfer\.any", auth\.keyScope\);/);
    assert.match(text, /if \(canAny\) \{\n\s+const \{ listAllAccounts \}/);
    assert.ok(!text.includes('"panel.settings"'), "the transfer route should not gate on panel.settings");
  });

  test("the listener settings route is gated on transfer.settings", () => {
    const text = settingsRoute();
    assert.match(text, /hasPermission\(auth\.userId, "transfer\.settings", auth\.keyScope\)/);
    assert.ok(!text.includes('"panel.settings"'), "listener settings should not need panel.settings");
  });

  test("revoking the permission stops an existing FTP login", () => {
    // The login path has no API key, so the scope is `null` — but the key it
    // reads must be the transfer one, or "no FTP for this role" would not hold.
    assert.match(
      transferLib(),
      /if \(!\(await hasPermission\(owner\.id, "transfer\.view", null\)\)\) return null;/
    );
  });

  test("the navigation entry is gated on transfer.view", () => {
    assert.match(dashboard(), /key: "transfer", label: "File Transfer", permission: "transfer\.view"/);
  });

  test("every permission check in the feature threads the key scope explicitly", () => {
    for (const rel of ["src/app/api/file-transfer/route.ts", "src/app/api/settings/file-transfer/route.ts"]) {
      const text = source(rel);
      const calls = [...text.matchAll(/hasPermission\((auth(?:User)?)\.userId,\s*("[^"]*")/g)];
      assert.ok(calls.length > 0, `${rel} has no permission checks`);
      for (const call of calls) {
        const threaded = new RegExp(
          `hasPermission\\(${call[1]}\\.userId,\\s*${call[2]},\\s*${call[1]}\\.keyScope\\)`
        );
        assert.ok(threaded.test(text), `${rel}: ${call[0]}… is not threaded with ${call[1]}.keyScope`);
      }
    }
  });
});
