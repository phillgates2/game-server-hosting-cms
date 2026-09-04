/**
 * Tests for the roster role-color annotation.
 *
 * When a player has verified (GUID-linked) on Discord, the board can show
 * their role color next to their name — `• Rifleman [12ms] 🎨 Vivid Azurite`.
 * The matching is pure; the gateway lookup is tested by the embed tests.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  matchRoleColors,
  rosterKey,
  type RosterMember,
} from "../src/lib/discord-roster";

const MEMBERS: RosterMember[] = [
  { discordName: "Rifleman#1234", displayName: "Rifleman", colorHex: "#3b82f6" },
  { discordName: "Medic", colorHex: "#22c55e" },
  { discordName: "Sniper", colorHex: "#ef4444" },
];

describe("rosterKey", () => {
  test("normalises colour codes, case and whitespace", () => {
    assert.equal(rosterKey("^5Rifleman^7"), "rifleman");
    assert.equal(rosterKey("  Covert  Ops  "), "covert ops");
  });
});

describe("matchRoleColors", () => {
  test("exact cleaned match wins", () => {
    const out = matchRoleColors(["^5Rifleman^7", "Medic"], MEMBERS);
    assert.equal(out["rifleman"], "#3b82f6");
    assert.equal(out["medic"], "#22c55e");
    assert.ok(!out["sniper"], "only requested players are returned");
  });

  test("partial matches resolve an in-game name to a member", () => {
    const out = matchRoleColors(["rif"], MEMBERS);
    assert.equal(out["rif"], "#3b82f6", "rif is inside Rifleman");
  });

  test("members without a color are ignored", () => {
    const out = matchRoleColors(["Rifleman"], [{ discordName: "Rifleman", colorHex: null }]);
    assert.deepEqual(out, {});
  });

  test("bots never get a role color", () => {
    const out = matchRoleColors(["^o[BOT]^7Omni", "Rifleman"], MEMBERS);
    assert.ok(!out["omni"]);
    assert.equal(out["rifleman"], "#3b82f6");
  });

  test("unknown players and empty inputs return empty", () => {
    assert.deepEqual(matchRoleColors(["Nobody Here"], MEMBERS), {});
    assert.deepEqual(matchRoleColors([], MEMBERS), {});
    assert.deepEqual(matchRoleColors([], []), {});
  });

  test("the earliest member for a duplicate key wins", () => {
    const out = matchRoleColors(["Medic"], [
      { discordName: "Medic", colorHex: "#22c55e" },
      { discordName: "Medic", colorHex: "#ef4444" },
    ]);
    assert.equal(out["medic"], "#22c55e");
  });
});
