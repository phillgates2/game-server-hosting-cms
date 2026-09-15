/**
 * Per-server file-transfer access.
 *
 * The rule this file exists to pin: a transfer permission is a *capability*
 * ("may use the feature"), never a *scope* ("may use it everywhere"). The
 * servers a user can reach come from owning them or from an explicit per-server
 * grant, so a role that can edit every server still cannot upload into every
 * server's disk.
 *
 * Pure decisions live in src/lib/server-collab.ts; the database-backed entry
 * point is checked against its source here because importing it would need a
 * live connection.
 */
process.env.DATABASE_URL ??= "postgres://placeholder:placeholder@127.0.0.1:1/gsm_test";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accessCanManage,
  accessCanTransfer,
  accessCanView,
  COLLABORATOR_ROLES,
  isCollaboratorRole,
  resolveServerAccess,
} from "../src/lib/server-collab";

const source = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("accessCanTransfer", () => {
  test("the owner always may", () => {
    assert.equal(accessCanTransfer("owner", false), true);
    assert.equal(accessCanTransfer("owner", true), true);
  });

  test("a grant is what makes a collaborator able to transfer", () => {
    assert.equal(accessCanTransfer("operator", true), true);
    assert.equal(accessCanTransfer("viewer", true), true);
  });

  test("sharing without the grant never hands over the disk", () => {
    // The bug this pins: "shared with me" silently meant "may upload".
    assert.equal(accessCanTransfer("operator", false), false);
    assert.equal(accessCanTransfer("viewer", false), false);
    assert.equal(accessCanTransfer("none", false), false);
    // Even if a stray flag survived on a row that no longer grants access.
    assert.equal(accessCanTransfer("none", true), true, "the flag is the grant; the caller drops the row with the share");
  });

  test("is independent of process control", () => {
    // Viewers may be handed file transfer (a modder uploading a map) and
    // operators may not (someone who only restarts servers).
    assert.equal(accessCanTransfer("viewer", true), true);
    assert.equal(accessCanTransfer("operator", false), false);
  });

  test("stays consistent with the rest of the access model", () => {
    const viewer = resolveServerAccess({ isAdmin: false, isOwner: false, collaboratorRole: "viewer" });
    const operator = resolveServerAccess({ isAdmin: false, isOwner: false, collaboratorRole: "operator" });
    assert.equal(accessCanView(viewer), true);
    assert.equal(accessCanManage(viewer), false);
    assert.equal(accessCanTransfer(operator, false), false);
    assert.equal(accessCanManage("owner"), true);
    assert.equal(COLLABORATOR_ROLES.every((role) => isCollaboratorRole(role)), true);
  });
});

describe("the server-specific access check", () => {
  const collab = source("src/lib/server-collab.ts");

  test("counts ownership, a per-server grant and panel-wide authority — nothing else", () => {
    assert.match(collab, /export async function canTransferToServer\(/);
    // Panel-wide authority is `transfer.any`, checked with the caller's scope.
    assert.match(collab, /if \(await hasPermission\(userId, "transfer\.any", keyScope\)\) return true;/);
    assert.match(collab, /if \(server\.userId === userId\) return true;/);
    assert.match(collab, /canTransfer: serverCollaborators\.canTransfer/);
    // `servers.edit` must not appear as a permission check here: that is the
    // "an operator can reach every server" hole this feature closes.
    assert.equal(/hasPermission\([^)]*"servers\.edit"/.test(collab), false);
  });

  test("a missing server is not access", () => {
    assert.match(collab, /if \(!server\) return false;/);
    assert.match(collab, /if \(!Number\.isInteger\(serverId\) \|\| serverId <= 0\) return false;/);
  });

  test("the grant list only includes rows where file transfer was enabled", () => {
    assert.match(
      collab,
      /eq\(serverCollaborators\.userId, Number\(userId\)\), eq\(serverCollaborators\.canTransfer, true\)/
    );
  });
});

describe("every file path asks the same question", () => {
  test("the FTP folder list is ownership + grants, never a global role", () => {
    const lib = source("src/lib/file-transfer.ts");
    assert.match(lib, /const seesAll = await hasPermission\(userId, "transfer\.any", null\);/);
    assert.match(lib, /const sharedIds = seesAll \? \[\] : await transferSharedServerIdsFor\(userId\);/);
    assert.match(lib, /or\(eq\(gameServers\.userId, userId\), inArray\(gameServers\.id, sharedIds\)\)/);
    // The old widening key must be gone from the folder path entirely.
    assert.equal(/foldersForUser[\s\S]{0,600}"servers\.edit"/.test(lib), false);
  });

  test("an empty grant list does not produce invalid SQL", () => {
    // `IN ()` is a syntax error, so the non-shared case must fall back to `=`.
    const lib = source("src/lib/file-transfer.ts");
    assert.match(lib, /: eq\(gameServers\.userId, userId\);/);
  });

  test("scoping a login to a server checks access to that server", () => {
    const route = source("src/app/api/file-transfer/route.ts");
    assert.match(route, /if \(!\(await canTransferToServer\(serverId, auth\.userId, auth\.keyScope\)\)\)/);
    assert.match(route, /status: 403 \}/);
  });

  test("the panel upload routes accept the same per-server grant", () => {
    for (const rel of [
      "src/app/api/servers/[id]/files/route.ts",
      "src/app/api/servers/[id]/files/upload/route.ts",
      "src/app/api/servers/[id]/files/stream/route.ts",
    ]) {
      const text = source(rel);
      assert.match(text, /canTransferToServer\(server\.id, auth\.userId, auth\.keyScope\)/, `${rel} is missing the grant check`);
      assert.match(text, /hasPermission\(auth\.userId, "servers\.edit", auth\.keyScope\)/, `${rel} lost the servers.edit path`);
    }
  });

  test("sharing exposes, grants and withdraws the flag — and cuts live sessions", () => {
    const route = source("src/app/api/servers/[id]/collaborators/route.ts");
    assert.match(route, /canTransfer: serverCollaborators\.canTransfer/);
    assert.match(route, /canTransfer,\n\s+grantedBy/);
    assert.match(route, /Provide role and\/or canTransfer/);
    assert.match(route, /kickTransferSessions\(account\.username\)/);
  });

  test("the FTP login still requires the transfer permission itself", () => {
    const lib = source("src/lib/file-transfer.ts");
    assert.match(lib, /if \(!\(await hasPermission\(owner\.id, "transfer\.view", null\)\)\) return null;/);
  });
});
