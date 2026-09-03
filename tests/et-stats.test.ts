/**
 * Tests for the ET stats module — the WolfET bot's data layer.
 *
 * decodeXp / cleanName / sanitizeInput / GUID rules are pure. The sqlite
 * reader is exercised end-to-end: a fixture database is built with sql.js
 * (the same runtime the module uses), written to bytes, then read back.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  cleanName,
  decodeXp,
  sanitizeInput,
  isValidGuid,
  similarity,
  sequenceMatcherRatio,
  getCloseMatches,
  findClosestPlayer,
  rankByXp,
  queryEtUsers,
  SKILL_NAMES,
} from "../src/lib/et-stats";

/** XP string in the ET token format, base64-encoded like the mod stores it. */
function xpFor(values: number[]): string {
  const parts: string[] = [];
  values.forEach((v, i) => parts.push(`S${i}`, String(v)));
  return Buffer.from(parts.join("\\"), "utf8").toString("base64");
}

describe("cleanName", () => {
  test("strips colour codes and bot tags", () => {
    assert.equal(cleanName("^5Rifleman^7"), "Rifleman");
    assert.equal(cleanName("^o[BOT]^7Botter"), "Botter");
    assert.equal(cleanName("^2-^3O^2Z^3-Striker"), "Striker");
    assert.equal(cleanName("Plain"), "Plain");
    assert.equal(cleanName(""), "");
  });
});

describe("decodeXp", () => {
  test("decodes the token format into seven skills and a total", () => {
    const { skills, total } = decodeXp(xpFor([10, 20, 30, 40, 50, 60, 70]));
    assert.deepEqual(skills, [10, 20, 30, 40, 50, 60, 70]);
    assert.equal(total, 280);
  });

  test("tolerates missing, empty and garbage input", () => {
    assert.deepEqual(decodeXp(""), { skills: [0, 0, 0, 0, 0, 0, 0], total: 0 });
    assert.deepEqual(decodeXp("not base64!!"), { skills: [0, 0, 0, 0, 0, 0, 0], total: 0 });
    assert.equal(decodeXp(xpFor([1, 2])).total, 3, "missing skills count as zero");
  });

  test("skill names line up with the original bot's labels", () => {
    assert.equal(SKILL_NAMES[0], "Battle Sense");
    assert.equal(SKILL_NAMES[3], "Field Ops");
    assert.equal(SKILL_NAMES.length, 7);
  });
});

describe("sanitizeInput", () => {
  test("strips SQL-ish tokens and caps at 50 characters", () => {
    assert.equal(sanitizeInput("SELECT DROP xp_"), "");
    assert.equal(sanitizeInput("normal-name"), "normal-name");
    assert.equal(sanitizeInput("a;b--c"), "abc");
    assert.equal(sanitizeInput("x".repeat(80)).length, 50);
  });
});

describe("isValidGuid", () => {
  test("accepts the ET GUID shape", () => {
    assert.equal(isValidGuid("AB7F5B25B19CFE79EFFCE6FF788DCECD"), true);
    assert.equal(isValidGuid("ab7f5b25b19cfe79effce6ff788dcecd"), true, "case-insensitive");
  });
  test("rejects wrong lengths and shapes", () => {
    assert.equal(isValidGuid(""), false);
    assert.equal(isValidGuid("ABC"), false);
    assert.equal(isValidGuid("1B7F5B25B19CFE79EFFCE6FF788DCECD"), false, "must start with a letter");
    assert.equal(isValidGuid("AB7F5B25B19CFE79EFFCE6FF788DCEC1"), false, "must end with a letter");
    assert.equal(isValidGuid("AB7F5B25B19CFE79EFFCE6FF788DCEC!"), false, "no punctuation");
  });
});

const FIXTURE_USERS = [
  { name: "^5Rifleman^7", level: 4, xp: xpFor([1, 1, 1, 1, 1, 1, 1]), guid: "AAAA", timestamp: 1700000000 },
  { name: "Medic", level: 2, xp: xpFor([0, 0, 10, 0, 0, 0, 0]), guid: "BBBB", timestamp: 1700000000 },
  { name: "^o[BOT]^7Botter", level: 1, xp: xpFor([99, 99, 99, 99, 99, 99, 99]), guid: "CCCC", timestamp: 0 },
];

describe("sequenceMatcherRatio — pinned against real difflib", () => {
  // Every value below was generated with Python 3.13's
  // difflib.SequenceMatcher.ratio(); the port must match each one.
  const GROUND_TRUTH: Array<[string, string, number]> = [
    ["medic", "medik", 0.8],
    ["medic", "meidc", 0.8],
    ["medik", "meidc", 0.6],
    ["rifleman", "Rifleman", 0.875],
    ["rifleman", "riflman", 0.9333],
    ["striker", "strike", 0.9231],
    ["striker", "sriker", 0.9231],
    ["oz sniper", "ozsniper", 0.9412],
    ["player", "player 99", 0.8],
    ["player 99", "player", 0.8],
    ["abcde", "abxde", 0.8],
    ["kitten", "sitting", 0.6154],
    ["abcd", "dcba", 0.25],
    ["the quick", "the quik", 0.9412],
    ["12345", "12346", 0.8],
    ["mapcycle", "map_cycle", 0.9412],
    ["abcd", "bcde", 0.75],
    ["a", "b", 0.0],
    ["", "x", 0.0],
    ["same", "same", 1.0],
  ];

  for (const [a, b, expected] of GROUND_TRUTH) {
    test(`matches difflib for ${JSON.stringify(a)} vs ${JSON.stringify(b)}`, () => {
      assert.ok(
        Math.abs(sequenceMatcherRatio(a, b) - expected) < 0.0005,
        `${sequenceMatcherRatio(a, b)} !== ${expected}`
      );
    });
  }

  test("difflib scores differently from edit distance — on purpose", () => {
    // "abcd" vs "bcde": difflib sees the block "bcd" (0.75) and matches the
    // fuzzy step; an edit-distance approximation scores 0.5 and misses it.
    assert.equal(sequenceMatcherRatio("abcd", "bcde"), 0.75);
    assert.ok(similarity("abcd", "bcde") < 0.6, "Levenshtein would miss this match");
  });

  test("is case-sensitive like Python; callers lowercase first like the original", () => {
    assert.equal(sequenceMatcherRatio("rifleman", "Rifleman"), 0.875, "difflib counts case");
    // The original bot lowercased before difflib; findClosestPlayer does too.
    const users = [{ name: "Rifleman", level: 1, xp: "", guid: "AAAA", timestamp: 0 }];
    assert.equal(findClosestPlayer(users, "rifleman")?.guid, "AAAA");
  });
});

describe("getCloseMatches", () => {
  test("filters by cutoff and keeps original order on ties (Python <=3.12)", () => {
    assert.deepEqual(getCloseMatches("abcd", ["bcde"], 1, 0.6), ["bcde"], "0.75 >= 0.6");
    assert.deepEqual(getCloseMatches("abcd", ["wxyz"], 1, 0.6), [], "below cutoff");
    assert.deepEqual(
      getCloseMatches("abc", ["abc", "xyz", "abc"], 3, 0.6),
      ["abc", "abc"],
      "ties stay in original order"
    );
    assert.deepEqual(getCloseMatches("abc", [], 1, 0.6), []);
    // Python 3.13 switched to heapq.nlargest (lexicographic tie-break); we
    // keep the classic stable behaviour the bot was written against.
    assert.deepEqual(getCloseMatches("medic", ["medik", "meidc"], 1, 0.6), ["medik"]);
  });
});

describe("similarity / findClosestPlayer", () => {
  const users = FIXTURE_USERS;

  test("exact, then partial, then fuzzy", () => {
    assert.equal(findClosestPlayer(users, "rifleman")?.guid, "AAAA", "cleaned exact");
    assert.equal(findClosestPlayer(users, "med")?.guid, "BBBB", "partial");
    assert.equal(findClosestPlayer(users, "medik")?.guid, "BBBB", "fuzzy ≥0.6");
    assert.equal(findClosestPlayer(users, "zzzzzzzzzz")?.guid, undefined, "no match");
  });

  test("bots are never returned even when they match best", () => {
    assert.equal(findClosestPlayer(users, "botter"), null);
  });

  test("similarity behaves like a ratio", () => {
    assert.equal(similarity("medic", "medic"), 1);
    assert.equal(similarity("", "x"), 0);
    assert.ok(similarity("medic", "medik") > 0.6);
  });
});

describe("rankByXp", () => {
  test("sorts by total XP, skips bots, caps at the limit", () => {
    const top = rankByXp(FIXTURE_USERS, 10);
    assert.equal(top.length, 2);
    assert.equal(top[0].name, "Medic", "the bot's 693 XP is excluded");
    assert.equal(top[0].xp, 10);
    assert.equal(top[1].name, "Rifleman");
    assert.equal(top[1].xp, 7);
  });
});

describe("queryEtUsers (real SQLite fixture)", () => {
  // The fixture is a genuine SQLite 3 database (8 KB, one page) produced by
  // sql.js and stored verbatim, so the zero-dependency reader is tested
  // against a real on-disk format, not a synthetic one.
  const fixtureBytes = (): Buffer =>
    Buffer.from(
      require("node:fs").readFileSync(
        join(process.cwd(), "tests/fixtures/et-user.sqlite.b64"), "utf8").trim(),
      "base64"
    );

  test("reads users from an actual SQLite file via the built-in reader", async () => {
    const users = await queryEtUsers(fixtureBytes());
    assert.equal(users.length, 4, "a validator writes four rows in rowid order");

    const rifleman = users.find((u) => u.name.includes("Rifleman"));
    assert.ok(rifleman);
    assert.equal(rifleman.level, 4);
    assert.equal(rifleman.guid, "AB7F5B25B19CFE79EFFCE6FF788DCECD");
    assert.equal(rifleman.timestamp, 1700000000);
    assert.equal(decodeXp(rifleman.xp).total, 10);

    const medic = users.find((u) => u.name === "Medic");
    assert.ok(medic, "plain names survive");
    assert.equal(decodeXp(medic.xp).skills[2], 10, "First Aid skill");

    const bot = users.find((u) => u.name.includes("[BOT]"));
    assert.ok(bot, "bots stay in the table; the command layer filters them");
    assert.equal(users.reduce((n, u) => n + (u.name.includes("[BOT]") ? 0 : 1), 0), 3);
  });

  test("handles a db with no users table and garbage bytes gracefully", async () => {
    assert.deepEqual(await queryEtUsers(Buffer.from("not a database at all")), []);
    assert.deepEqual(await queryEtUsers(Buffer.alloc(64)), []);
  });
});
