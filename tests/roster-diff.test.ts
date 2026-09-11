/**
 * Tests for the player join/leave roster diff.
 *
 * These decide what lands in a community Discord channel every 15 seconds,
 * so the boundary cases are pinned: the first sighting must NOT announce an
 * entire server as "joined", a failed probe must never read as a mass-leave,
 * and long rosters must not overflow a message.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffRosters, describeRosterChange, MAX_LISTED_NAMES } from "../src/lib/roster-diff";

describe("diffRosters", () => {
  test("the first sighting sets a silent baseline — nobody 'joined'", () => {
    const change = diffRosters(undefined, ["Alice", "Bob"]);
    assert.deepEqual(change, { joined: [], left: [] });
  });

  test("detects joins against the baseline", () => {
    const change = diffRosters(["Alice"], ["Alice", "Bob"]);
    assert.deepEqual(change, { joined: ["Bob"], left: [] });
  });

  test("detects leaves against the baseline", () => {
    const change = diffRosters(["Alice", "Bob"], ["Alice"]);
    assert.deepEqual(change, { joined: [], left: ["Bob"] });
  });

  test("detects a mid-poll swap", () => {
    const change = diffRosters(["Alice"], ["Bob"]);
    assert.deepEqual(change, { joined: ["Bob"], left: ["Alice"] });
  });

  test("no change means no notification", () => {
    const change = diffRosters(["Alice", "Bob"], ["Alice", "Bob"]);
    assert.deepEqual(change, { joined: [], left: [] });
  });

  test("empty current roster after a real baseline is a mass-leave", () => {
    // This is the LEGITIMATE mass-leave (previous poll had players, this one
    // succeeded and found none). The failed-probe case never reaches here.
    const change = diffRosters(["Alice", "Bob"], []);
    assert.deepEqual(change, { joined: [], left: ["Alice", "Bob"] });
  });

  test("names are trimmed, blanked out and de-duplicated", () => {
    const change = diffRosters(["Alice"], ["  Alice  ", "Bob", "Bob", "  "]);
    assert.deepEqual(change, { joined: ["Bob"], left: [] });
  });
});

describe("describeRosterChange", () => {
  test("nothing changed means nothing to post", () => {
    assert.equal(describeRosterChange("S", { joined: [], left: [] }), null);
  });

  test("a single join names the player and the server", () => {
    const post = describeRosterChange("My TF2", { joined: ["Alice"], left: [] });
    assert.ok(post);
    assert.equal(post.event, "player_joined");
    assert.match(post.message, /\*\*Alice\*\* joined \*\*My TF2\*\*/);
  });

  test("a single leave uses the left verb", () => {
    const post = describeRosterChange("My TF2", { joined: [], left: ["Bob"] });
    assert.ok(post);
    assert.equal(post.event, "player_left");
    assert.match(post.message, /\*\*Bob\*\* left \*\*My TF2\*\*/);
  });

  test("multiple joins are counted and listed", () => {
    const post = describeRosterChange("S", { joined: ["A", "B", "C"], left: [] });
    assert.ok(post);
    assert.match(post.message, /3 players joined/);
    assert.match(post.message, /\*\*A\*\*, \*\*B\*\*, \*\*C\*\*/);
  });

  test("joins win the event type when both sides change", () => {
    const post = describeRosterChange("S", { joined: ["A"], left: ["B"] });
    assert.ok(post);
    assert.equal(post.event, "player_joined");
    assert.match(post.message, /joined/);
    assert.match(post.message, /left/);
  });

  test("very long rosters are truncated with a count", () => {
    const names = Array.from({ length: MAX_LISTED_NAMES + 5 }, (_, i) => `P${i}`);
    const post = describeRosterChange("S", { joined: names, left: [] });
    assert.ok(post);
    assert.match(post.message, new RegExp(`${MAX_LISTED_NAMES + 5} players joined`));
    assert.match(post.message, /and 5 more/);
    assert.ok(!post.message.includes(`**P${MAX_LISTED_NAMES}**`), "names past the cap stay out");
  });
});
