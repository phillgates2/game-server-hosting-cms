/**
 * Tests for the public status share link.
 *
 * The token IS the authorisation on an anonymous endpoint, so its shape and
 * entropy matter; and the payload is the only thing that endpoint may ever
 * return, so its whitelist is pinned here.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateStatusToken,
  isValidStatusToken,
  publicStatusPayload,
  STATUS_TOKEN_RE,
} from "../src/lib/status-share";

describe("token generation", () => {
  test("produces 64 hex characters (256 bits)", () => {
    const token = generateStatusToken();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.ok(STATUS_TOKEN_RE.test(token));
  });

  test("tokens are unique across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateStatusToken());
    assert.equal(seen.size, 500);
  });
});

describe("token validation", () => {
  test("accepts exactly the stored shape", () => {
    assert.equal(isValidStatusToken(generateStatusToken()), true);
  });

  test("rejects anything a probe or typo could produce", () => {
    assert.equal(isValidStatusToken(""), false);
    assert.equal(isValidStatusToken("abc"), false);
    assert.equal(isValidStatusToken("g".repeat(64)), false, "non-hex");
    assert.equal(isValidStatusToken("a".repeat(63)), false, "too short");
    assert.equal(isValidStatusToken("a".repeat(65)), false, "too long");
    assert.equal(isValidStatusToken("A".repeat(64)), false, "uppercase is not the stored shape");
    assert.equal(isValidStatusToken(null), false);
    assert.equal(isValidStatusToken(undefined), false);
    assert.equal(isValidStatusToken(12345), false);
    assert.equal(isValidStatusToken("a".repeat(64) + "../"), false);
  });
});

describe("public payload", () => {
  const base = {
    name: "My TF2 Server",
    gameName: "Team Fortress 2",
    now: new Date("2026-09-10T12:00:00Z"),
  };

  test("an online server with players", () => {
    const p = publicStatusPayload({
      ...base,
      running: true,
      probe: { ok: true, players: 12, maxPlayers: 24, map: "cp_badlands" },
    });
    assert.equal(p.online, true);
    assert.equal(p.players, 12);
    assert.equal(p.maxPlayers, 24);
    assert.equal(p.map, "cp_badlands");
    assert.equal(p.checkedAt, "2026-09-10T12:00:00.000Z");
  });

  test("running but unprobeable reads as offline, never half-true", () => {
    const p = publicStatusPayload({ ...base, running: true, probe: { ok: false } });
    assert.equal(p.online, false);
    assert.equal(p.players, null);
    assert.equal(p.map, null);
  });

  test("a stopped server is offline even if an old probe answers", () => {
    const p = publicStatusPayload({
      ...base,
      running: false,
      probe: { ok: true, players: 3 },
    });
    assert.equal(p.online, false);
  });

  test("the payload carries NO internal fields", () => {
    const p = publicStatusPayload({ ...base, running: true, probe: { ok: true } });
    const keys = Object.keys(p).sort();
    assert.deepEqual(keys, ["checkedAt", "game", "map", "maxPlayers", "name", "online", "players"]);
    const serialized = JSON.stringify(p);
    for (const forbidden of ["installPath", "config", "webhook", "userId", "port", "pid", "token"]) {
      assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `payload leaks "${forbidden}"`);
    }
  });

  test("a missing game name falls back gracefully", () => {
    const p = publicStatusPayload({ name: "x", gameName: null, running: true, probe: { ok: true } });
    assert.equal(p.game, "Game server");
  });
});
