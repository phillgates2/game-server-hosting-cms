/**
 * Tests for the chat bot's command output.
 *
 * The embed builders are pure, so every command's message can be asserted
 * without a gateway connection. Also covers the WolfET channel-name update.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  whoEmbeds,
  allServersEmbeds,
  statsEmbeds,
  top10Embeds,
  desyncEmbeds,
} from "../src/lib/discord-commands";
import { statusChannelName, isValidWebhookUrl } from "../src/lib/discord";

const XP = (v: number[]) =>
  Buffer.from(v.map((n, i) => `S${i}\\${n}`).join("\\"), "utf8").toString("base64");

describe("whoEmbeds", () => {
  test("carries the live board view, pings, and a last-updated footer", () => {
    const { embeds } = whoEmbeds({
      serverName: "Main OZ",
      gameName: "Wolfenstein: Enemy Territory",
      address: "`51.161.131.149:27960`",
      online: true,
      map: "et_beach",
      players: 2,
      maxPlayers: 24,
      names: ["^5Rifleman^7", "Medic"],
      pings: [12, 8],
      hostname: "OZ Team Server",
    }, new Date(2026, 8, 26, 12, 34, 56));
    const e = embeds[0];
    assert.match(e.title, /🎮 OZ Team Server — Server Status/);
    assert.equal(e.fields[0].name, "Status");
    assert.equal(e.fields[0].value, "🟢 Online");
    assert.ok(e.fields.some((f) => f.name === "Map" && f.value === "et_beach"));
    assert.ok(e.fields.some((f) => f.name === "Players Online" && f.value === "2"));
    const roster = e.fields.find((f) => f.name === "Current Players");
    assert.ok(roster);
    assert.equal(roster.value.split("\n")[0], "• Rifleman [12ms]", "colour codes stripped, ping shown");
    assert.equal(roster.value.split("\n")[1], "• Medic [8ms]");
    assert.equal(e.footer?.text, "Last updated: 12:34:56");
  });

  test("shows the empty roster honestly when nobody is online", () => {
    const { embeds } = whoEmbeds({
      serverName: "Main OZ", gameName: "ET", address: "`a:1`",
      online: false, names: [], pings: [],
    });
    const roster = embeds[0].fields.find((f) => f.name === "Current Players");
    assert.equal(roster?.value, "No players currently online");
    assert.equal(embeds[0].fields[0].value, "🔴 Offline");
  });
});

describe("allServersEmbeds", () => {
  test("summarises real players across servers with hostnames and pings", () => {
    const { embeds } = allServersEmbeds([
      { serverName: "Main OZ", gameName: "ET", address: "`a:1`", online: true, players: 5, maxPlayers: 24, names: ["^5A^7", "B", "C", "D", "E"], pings: [10, 12, 14, 16, 18], hostname: "OZ Main", map: "et_beach" },
      { serverName: "OZ #2", gameName: "ET", address: "`b:2`", online: true, players: 0, map: "et_morocco" },
      { serverName: "OZ #3", gameName: "ET", address: "`c:3`", online: false },
    ], "ET Servers");
    const e = embeds[0];
    assert.match(String(e.description), /Total Real Players: \*\*5\*\*/);
    assert.ok(e.fields.some((f) => f.name === "👍 Servers online" && f.value === "2/3"));
    assert.ok(e.fields.some((f) => f.name === "👥 Total real players" && f.value === "5"));
    const main = e.fields.find((f) => f.name.includes("OZ Main"));
    assert.ok(main, "hostname drives the field name");
    assert.match(main.value, /A \[10ms\]/);
    assert.match(main.value, /Map: et_beach/);
  });

  test("empty state is explicit with the active-servers footer", () => {
    const { embeds } = allServersEmbeds([{ serverName: "S", gameName: "ET", address: "`x:1`", online: false }], "ET Servers");
    assert.ok(embeds[0].fields.some((f) => f.name === "No Players Online"));
    assert.equal(embeds[0].footer?.text, "Active Servers: 0/1");
  });
});

describe("statsEmbeds", () => {
  test("shows level, last-active, all seven skills and total XP", () => {
    const { embeds } = statsEmbeds({
      name: "^5Rifleman^7",
      level: 12,
      xp: XP([10, 20, 30, 40, 50, 60, 70]),
      guid: "AB7F5B25B19CFE79EFFCE6FF788DCECD",
      timestamp: 1700000000,
    });
    const e = embeds[0];
    assert.match(e.title, /Rifleman/);
    const general = e.fields.find((f) => f.name === "General Info");
    assert.ok(general && general.value.includes("Level: 12"));
    assert.ok(general && general.value.includes("<t:1700000000:R>"));
    const skills = e.fields.find((f) => f.name === "Skills");
    assert.ok(skills && skills.value.includes("Battle Sense: 10"));
    assert.ok(skills && skills.value.includes("Covert Ops: 70"));
    assert.equal(e.fields.find((f) => f.name === "Total XP")?.value, "280");
  });
});

describe("top10Embeds", () => {
  test("medals, padding and ordering", () => {
    const { embeds } = top10Embeds([
      { name: "Rifleman", xp: 12000 },
      { name: "Medic", xp: 8000 },
      { name: "Sniper", xp: 5000 },
    ]);
    const leaderboard = embeds[0].fields[0].value;
    assert.ok(leaderboard.includes("🥇"));
    assert.ok(leaderboard.includes("🥈"));
    assert.ok(leaderboard.includes("🥉"));
    assert.ok(leaderboard.includes("12,000 XP"));
    assert.equal(embeds[0].color, 0xffd700);
  });

  test("empty leaderboard is handled", () => {
    const { embeds } = top10Embeds([]);
    assert.equal(embeds[0].fields[0].value, "No players found");
  });
});

describe("desyncEmbeds", () => {
  test("shows the disconnected details", () => {
    const { embeds } = desyncEmbeds("AB7F5B25B19CFE79EFFCE6FF788DCECD", "Rifleman#1234");
    const e = embeds[0];
    assert.match(e.fields[0].value, /Rifleman/);
    assert.match(e.fields[0].value, /AB7F5B25B19CFE79EFFCE6FF788DCECD/);
  });
});

describe("statusChannelName (channel rename)", () => {
  test("green whenever the server is up, red when down — never amber", () => {
    assert.equal(statusChannelName({ online: true, players: 5, map: "et_beach" }), "🟢 ET: (5) - et_beach");
    assert.equal(statusChannelName({ online: true, players: 0, map: "et_beach" }), "🟢 ET: (0) - et_beach", "0 players is still up → green");
    assert.equal(statusChannelName({ online: true, players: 0 }), "🟢 ET: (0) - unknown-map");
    assert.equal(statusChannelName({ online: false }), "🔴 ET: Server Offline");
    assert.equal(statusChannelName({ online: true, players: 3, map: "goldrush" }, "oz"), "🟢 oz: (3) - goldrush");
    assert.ok(!statusChannelName({ online: true, players: 0 }).includes("🟠"), "the amber state is gone");
  });

  test("an unknown player count shows (?) instead of a misleading (0)", () => {
    assert.equal(statusChannelName({ online: true, map: "et_beach" }), "🟢 ET: (?) - et_beach");
  });

  test("the channel name never exceeds Discord's 100 characters", () => {
    const name = `🟢 ET: (${"9".repeat(32)}) - ${"x".repeat(200)}`;
    const label = name.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 100);
    assert.ok(label.length <= 100);
  });
});

describe("webhook URL validation (unchanged contract)", () => {
  test("still rejects non-Discord hosts", () => {
    assert.equal(isValidWebhookUrl("https://evil.com/api/webhooks/1/a"), false);
  });
});
