/**
 * Regression tests for two bugs found during the full-panel debug sweep.
 *
 * 1. Cloning a server copied the source's Discord webhook even when the panel
 *    had provisioned that channel for the source. The clone posted into a
 *    channel it did not own, and deleting the *original* destroyed the channel
 *    and left the clone's webhook silently 404ing.
 *
 * 2. `autoRestart` was shown as an on/off badge in the UI and copied on clone,
 *    but nothing anywhere ever restarted a crashed server.
 *
 * Both rules now live in src/lib/server-lifecycle.ts and are used directly by
 * the route handlers, so these tests exercise the shipping code path.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  inheritedWebhook,
  shouldProvisionForClone,
  hasCrashed,
  shouldAutoRestart,
  pickServerPatch,
  publicNode,
  pickNodePatch,
  publicUser,
  parsePort,
  occupiedPorts,
  findPortConflicts,
  validatePorts,
  withinServerQuota,
  nextFreePort,
} from "../src/lib/server-lifecycle";

const HOOK = "https://discord.com/api/webhooks/123456789/abcdefTOKEN";
const OTHER = "https://discord.com/api/webhooks/987654321/zyxwvuTOKEN";

describe("clone webhook inheritance", () => {
  test("does NOT inherit a webhook whose channel the panel provisioned", () => {
    // The bug: this returned HOOK, pointing the clone at the source's channel.
    assert.equal(
      inheritedWebhook({ discordWebhook: HOOK, discordChannelId: "555000111" }),
      null
    );
  });

  test("does inherit a hand-entered webhook, which nobody owns", () => {
    assert.equal(
      inheritedWebhook({ discordWebhook: HOOK, discordChannelId: null }),
      HOOK
    );
  });

  test("a source with no webhook gives the clone no webhook", () => {
    assert.equal(inheritedWebhook({ discordWebhook: null, discordChannelId: null }), null);
    assert.equal(inheritedWebhook({ discordWebhook: null, discordChannelId: "555" }), null);
  });

  test("deleting the source cannot orphan the clone", () => {
    // The scenario that made this a real outage rather than a cosmetic slip:
    // source owns channel 555, clone is created, source is deleted (which
    // deletes channel 555). The clone must not be left holding that webhook.
    const source = { discordWebhook: HOOK, discordChannelId: "555000111" };
    const cloneHook = inheritedWebhook(source);
    assert.notEqual(cloneHook, source.discordWebhook);
    assert.equal(cloneHook, null);
  });
});

describe("clone channel provisioning", () => {
  const on = { autoChannel: true, botToken: "tok", guildId: "42" };

  test("provisions when the clone was left without a webhook", () => {
    assert.equal(shouldProvisionForClone(null, on), true);
  });

  test("leaves an inherited hand-entered webhook alone", () => {
    assert.equal(shouldProvisionForClone(OTHER, on), false);
  });

  test("respects the auto-channel toggle and needs full bot config", () => {
    assert.equal(shouldProvisionForClone(null, { ...on, autoChannel: false }), false);
    assert.equal(shouldProvisionForClone(null, { ...on, botToken: null }), false);
    assert.equal(shouldProvisionForClone(null, { ...on, guildId: null }), false);
    // Empty strings are as unusable as nulls.
    assert.equal(shouldProvisionForClone(null, { ...on, botToken: "" }), false);
    assert.equal(shouldProvisionForClone(null, { ...on, guildId: "" }), false);
  });
});

describe("crash detection", () => {
  test("running in the database but no live process is a crash", () => {
    assert.equal(hasCrashed({ status: "running", alive: false }), true);
  });

  test("a deliberately stopped server is not a crash", () => {
    assert.equal(hasCrashed({ status: "stopped", alive: false }), false);
    assert.equal(hasCrashed({ status: "installing", alive: false }), false);
  });

  test("a healthy server is not a crash", () => {
    assert.equal(hasCrashed({ status: "running", alive: true }), false);
  });
});

describe("auto-restart", () => {
  const crashed = { status: "running", alive: false };

  test("restarts a crashed server that opted in", () => {
    // The bug: nothing ever evaluated this, so the answer was effectively
    // always false no matter how the toggle was set.
    assert.equal(shouldAutoRestart({ ...crashed, autoRestart: true }, false), true);
  });

  test("leaves a crashed server alone when the toggle is off", () => {
    assert.equal(shouldAutoRestart({ ...crashed, autoRestart: false }, false), false);
    assert.equal(shouldAutoRestart({ ...crashed, autoRestart: null }, false), false);
  });

  test("never restarts a server that did not crash", () => {
    assert.equal(
      shouldAutoRestart({ status: "running", alive: true, autoRestart: true }, false),
      false
    );
    assert.equal(
      shouldAutoRestart({ status: "stopped", alive: false, autoRestart: true }, false),
      false
    );
  });

  test("two concurrent polls only restart once", () => {
    // Two browser tabs both poll status every 15s. Without the in-flight
    // guard both observe the crash and each spawns a process, leaving an
    // orphan holding the port.
    const state = { ...crashed, autoRestart: true };
    assert.equal(shouldAutoRestart(state, false), true, "first poll acts");
    assert.equal(shouldAutoRestart(state, true), false, "second poll defers");
  });
});

describe("PATCH field allowlist", () => {
  test("accepts the fields the panel legitimately edits", () => {
    const { updates, rejected } = pickServerPatch({
      name: "New Name",
      port: 27016,
      autoRestart: true,
      autoStart: true,
      maxRamMb: 4096,
    });
    assert.deepEqual(rejected, []);
    assert.equal(updates.name, "New Name");
    assert.equal(updates.autoStart, true);
  });

  test("refuses installPath, which the process route feeds to a shell script", () => {
    // The bug: `.set({ ...body })` meant servers.edit was enough to point a
    // server at any path on disk and then press Start.
    const { updates, rejected } = pickServerPatch({
      name: "ok",
      installPath: "/tmp/evil",
    });
    assert.deepEqual(rejected, ["installPath"]);
    assert.equal("installPath" in updates, false);
  });

  test("refuses to reassign ownership or identity", () => {
    const { updates, rejected } = pickServerPatch({ id: 99, userId: 1, nodeId: 3, gameId: 7 });
    assert.deepEqual(rejected.sort(), ["gameId", "id", "nodeId", "userId"]);
    assert.deepEqual(updates, {});
  });

  test("refuses server-owned bookkeeping columns", () => {
    const { rejected } = pickServerPatch({
      pid: 1234,
      discordChannelId: "555",
      createdAt: "1970-01-01",
      lastStarted: "1970-01-01",
    });
    assert.deepEqual(rejected.sort(), ["createdAt", "discordChannelId", "lastStarted", "pid"]);
  });

  test("ignores undefined without reporting it as unknown", () => {
    const { updates, rejected } = pickServerPatch({ name: "x", port: undefined });
    assert.deepEqual(rejected, []);
    assert.deepEqual(updates, { name: "x" });
  });

  test("survives a non-object body instead of throwing", () => {
    for (const bad of [null, undefined, "string", 42, [1, 2]]) {
      const { updates, rejected } = pickServerPatch(bad);
      assert.deepEqual(updates, {});
      assert.deepEqual(rejected, []);
    }
  });

  test("a prototype-pollution attempt is rejected, not merged", () => {
    const { updates, rejected } = pickServerPatch(JSON.parse('{"__proto__":{"admin":true}}'));
    assert.deepEqual(updates, {});
    assert.deepEqual(rejected, ["__proto__"]);
  });
});

describe("node secret redaction", () => {
  const row = {
    id: 3,
    name: "edge-01",
    hostname: "edge01.example.com",
    sshPort: 22,
    sshUser: "root",
    sshKeyPath: "/root/.ssh/id_ed25519",
    sshPassword: "hunter2",
    apiUrl: "https://edge01.example.com",
    apiKey: "node-api-key-secret",
    status: "online",
    isLocal: false,
  };

  test("strips every credential from a node row", () => {
    // The bug: GET /api/nodes/[id] used db.select() with no projection and
    // returned the row as-is, so nodes.view — held by the built-in moderator
    // role — exposed the SSH root password for every machine.
    const out = publicNode(row) as Record<string, unknown>;
    for (const secret of ["sshPassword", "sshKeyPath", "apiKey", "sshUser"]) {
      assert.equal(secret in out, false, `${secret} must not be returned`);
    }
  });

  test("keeps the fields the panel actually displays", () => {
    const out = publicNode(row) as Record<string, unknown>;
    assert.equal(out.id, 3);
    assert.equal(out.name, "edge-01");
    assert.equal(out.hostname, "edge01.example.com");
    assert.equal(out.status, "online");
    assert.equal(out.sshPort, 22);
  });

  test("no serialised secret survives a round trip", () => {
    const json = JSON.stringify(publicNode(row));
    assert.equal(json.includes("hunter2"), false);
    assert.equal(json.includes("node-api-key-secret"), false);
    assert.equal(json.includes("id_ed25519"), false);
  });

  test("does not invent keys the row never had", () => {
    const out = publicNode({ id: 1, name: "x" }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(out).sort(), ["id", "name"]);
  });
});

describe("node PATCH allowlist", () => {
  test("an admin can still set credentials", () => {
    const { updates, rejected } = pickNodePatch({
      sshPassword: "new",
      sshKeyPath: "/root/.ssh/id",
      apiKey: "k",
    });
    assert.deepEqual(rejected, []);
    assert.equal(updates.sshPassword, "new");
  });

  test("refuses identity and panel-owned state", () => {
    const { updates, rejected } = pickNodePatch({
      id: 9,
      isLocal: true,
      status: "online",
      lastHeartbeat: "1970-01-01",
      createdAt: "1970-01-01",
    });
    assert.deepEqual(rejected.sort(), [
      "createdAt",
      "id",
      "isLocal",
      "lastHeartbeat",
      "status",
    ]);
    assert.deepEqual(updates, {});
  });

  test("isLocal cannot be flipped, which would redirect process control", () => {
    // isLocal decides whether the panel spawns processes on this machine.
    const { rejected } = pickNodePatch({ isLocal: true });
    assert.deepEqual(rejected, ["isLocal"]);
  });
});

describe("user secret redaction", () => {
  const row = {
    id: 7,
    username: "admin",
    email: "admin@example.com",
    passwordHash: "$2b$12$abcdefghijklmnopqrstuv",
    twoFactorEnabled: true,
    twoFactorSecret: "JBSWY3DPEHPK3PXP",
    role: "admin",
    status: "active",
  };

  test("strips the password hash and TOTP secret", () => {
    // The bug: the admin PATCH ended in .returning(), which yields every
    // column, so editing a user echoed their bcrypt hash and 2FA seed back.
    const out = publicUser(row) as Record<string, unknown>;
    assert.equal("passwordHash" in out, false);
    assert.equal("twoFactorSecret" in out, false);
  });

  test("keeps twoFactorEnabled, which the UI needs, without the seed", () => {
    const out = publicUser(row) as Record<string, unknown>;
    assert.equal(out.twoFactorEnabled, true);
    assert.equal("twoFactorSecret" in out, false);
  });

  test("no serialised secret survives a round trip", () => {
    const json = JSON.stringify(publicUser(row));
    assert.equal(json.includes("$2b$12$"), false);
    assert.equal(json.includes("JBSWY3DPEHPK3PXP"), false);
  });

  test("a TOTP seed is enough to mint valid codes, so this is not cosmetic", () => {
    // Leaking twoFactorSecret defeats 2FA entirely for that account: anyone
    // holding the seed can generate the same codes the user's app shows.
    const out = publicUser(row) as Record<string, unknown>;
    assert.equal(out.twoFactorSecret, undefined);
  });
});

describe("port parsing", () => {
  test("accepts a normal game port", () => {
    assert.equal(parsePort("27015"), 27015);
    assert.equal(parsePort(27015), 27015);
    assert.equal(parsePort("  27015  "), 27015);
  });

  test("rejects everything Number() used to let through", () => {
    // These all reached the database and the ufw command line unchecked.
    assert.equal(parsePort("abc"), null, "NaN");
    assert.equal(parsePort("-1"), null, "negative");
    assert.equal(parsePort("99999"), null, "above 65535");
    assert.equal(parsePort("1e5"), null, "exponent notation -> 100000");
    assert.equal(parsePort("1.5"), null, "decimal");
    assert.equal(parsePort("0"), null, "zero");
    assert.equal(parsePort(""), null, "empty string coerces to 0");
    assert.equal(parsePort(null), null);
    assert.equal(parsePort(undefined), null);
  });

  test("rejects privileged ports an unprivileged server could not bind", () => {
    // 22 is a valid integer and Number() was happy with it, so a user could
    // reserve SSH's port.
    assert.equal(parsePort("22"), null);
    assert.equal(parsePort("80"), null);
    assert.equal(parsePort("1023"), null);
    assert.equal(parsePort("1024"), 1024, "first allowed port");
    assert.equal(parsePort("65535"), 65535, "last allowed port");
  });

  test("rejects booleans, which Number() turns into 0 and 1", () => {
    assert.equal(parsePort(true), null);
    assert.equal(parsePort(false), null);
  });
});

describe("port conflicts", () => {
  test("lists the distinct ports a server occupies", () => {
    assert.deepEqual(occupiedPorts({ port: 27015, queryPort: 27016, rconPort: 27017 }), [27015, 27016, 27017]);
  });

  test("collapses duplicates rather than reporting a self-conflict", () => {
    assert.deepEqual(occupiedPorts({ port: 27015, queryPort: 27015, rconPort: null }), [27015]);
  });

  test("detects a clash with a server already on the node", () => {
    // Nothing checked this: the second server bound nothing and reported
    // itself crashed with no explanation.
    assert.deepEqual(findPortConflicts({ port: 27015 }, [27015, 28015]), [27015]);
    assert.deepEqual(findPortConflicts({ port: 27015, queryPort: 28015 }, [28015]), [28015]);
  });

  test("no clash when the node is free", () => {
    assert.deepEqual(findPortConflicts({ port: 27015, queryPort: 27016 }, [30000]), []);
    assert.deepEqual(findPortConflicts({ port: 27015 }, []), []);
  });
});

describe("validatePorts", () => {
  test("returns the parsed triple when everything is usable", () => {
    const r = validatePorts({ port: "27015", queryPort: "27016", rconPort: "27017" });
    assert.equal(r.error, null);
    assert.deepEqual(r.ports, { port: 27015, queryPort: 27016, rconPort: 27017 });
  });

  test("names which port was wrong", () => {
    assert.match(String(validatePorts({ port: "abc" }).error), /^Port must be/);
    assert.match(String(validatePorts({ port: "27015", queryPort: "-5" }).error), /^Query port must be/);
    assert.match(String(validatePorts({ port: "27015", rconPort: "99999" }).error), /^RCON port must be/);
  });

  test("optional ports may be omitted or blank", () => {
    const r = validatePorts({ port: "27015", queryPort: "", rconPort: null });
    assert.equal(r.error, null);
    assert.deepEqual(r.ports, { port: 27015, queryPort: null, rconPort: null });
  });

  test("reports a collision with an actionable message", () => {
    const r = validatePorts({ port: "27015" }, [27015]);
    assert.equal(r.ports, null);
    assert.match(String(r.error), /27015 already in use/);
  });
});

describe("server quota", () => {
  test("blocks creation once the limit is reached", () => {
    // maxServers was editable by admins and rendered as "5/5" in the UI, but
    // nothing enforced it, so any user could create servers without limit.
    assert.equal(withinServerQuota(5, 5), false);
    assert.equal(withinServerQuota(6, 5), false);
  });

  test("allows creation below the limit", () => {
    assert.equal(withinServerQuota(4, 5), true);
    assert.equal(withinServerQuota(0, 5), true);
  });

  test("treats null/undefined as unlimited rather than as zero", () => {
    // A null column must not lock every user out of creating anything.
    assert.equal(withinServerQuota(100, null), true);
    assert.equal(withinServerQuota(100, undefined), true);
  });

  test("treats 0 as unlimited, matching the retention convention", () => {
    assert.equal(withinServerQuota(100, 0), true);
  });
});

describe("nextFreePort", () => {
  test("returns the requested port when the block is free", () => {
    assert.equal(nextFreePort(27016, [], 2), 27016);
  });

  test("skips a block that overlaps a taken port", () => {
    // Cloning a server on 27015/27016 must not land on 27016.
    assert.equal(nextFreePort(27016, [27015, 27016], 2), 27017);
  });

  test("finds a gap large enough for the whole triple", () => {
    // 27017 is free but 27018 is not, so a 3-wide block cannot start there.
    assert.equal(nextFreePort(27016, [27016, 27018], 3), 27019);
  });

  test("never returns a privileged port", () => {
    assert.equal(nextFreePort(80, [], 2), 1024);
  });

  test("returns null when nothing fits", () => {
    assert.equal(nextFreePort(65535, [65535], 1), null);
    assert.equal(nextFreePort(65535, [], 2), null, "block would exceed 65535");
  });

  test("a clone of a two-port server lands clear of the source", () => {
    // Regression for the real scenario: source holds 27015 (game) and 27016
    // (query); the old code chose 27016 and collided.
    const taken = [27015, 27016];
    const chosen = nextFreePort(27016, taken, 2);
    assert.equal(chosen, 27017);
    assert.deepEqual(findPortConflicts({ port: chosen!, queryPort: chosen! + 1 }, taken), []);
  });
});
