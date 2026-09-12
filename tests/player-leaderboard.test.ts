/**
 * Tests for the player leaderboard (pure layer).
 *
 * The contract: aggregation is exact (peak/avg/count/lastSeen), garbage
 * samples are ignored, ranking is stable with tie-breaks, and the day
 * window is clamped.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateLeaderboard,
  rankLeaderboard,
  clampLeaderboardDays,
  LEADERBOARD_DEFAULT_DAYS,
  LEADERBOARD_MAX_DAYS,
} from "../src/lib/player-leaderboard";

const s = (serverId: number, players: number, recordedAtMs = 1000) => ({ serverId, players, recordedAtMs });

describe("aggregateLeaderboard", () => {
  test("peak, average, count and lastSeen per server", () => {
    const stats = aggregateLeaderboard([s(1, 5, 10), s(1, 24, 20), s(1, 10, 30), s(2, 3, 40)]);
    const one = stats.find((x) => x.serverId === 1);
    assert.equal(one?.peakPlayers, 24);
    assert.equal(one?.avgPlayers, 13); // (5+24+10)/3 = 13
    assert.equal(one?.sampleCount, 3);
    assert.equal(one?.lastSeenMs, 30);
    const two = stats.find((x) => x.serverId === 2);
    assert.equal(two?.peakPlayers, 3);
  });

  test("averages keep one decimal", () => {
    const stats = aggregateLeaderboard([s(1, 1), s(1, 2)]);
    assert.equal(stats[0].avgPlayers, 1.5);
  });

  test("garbage samples are ignored", () => {
    const stats = aggregateLeaderboard([
      s(1, -5),
      s(1, Number.NaN),
      s(1, 7),
    ]);
    assert.equal(stats.length, 1);
    assert.equal(stats[0].sampleCount, 1);
    assert.equal(stats[0].peakPlayers, 7);
  });

  test("empty input yields empty output", () => {
    assert.deepEqual(aggregateLeaderboard([]), []);
  });
});

describe("rankLeaderboard", () => {
  const stats = aggregateLeaderboard([
    s(1, 20), s(2, 30), s(2, 30), s(3, 30),
  ]);

  test("peak sort with tie broken by average", () => {
    // server 2: peak 30 avg 30; server 3: peak 30 avg 30... give distinct avgs:
    const st = aggregateLeaderboard([s(1, 20), s(2, 30), s(2, 30), s(3, 30), s(3, 10)]);
    const ranked = rankLeaderboard(st, "peak", 10);
    assert.equal(ranked[0].serverId, 2); // peak tie, higher average wins
    assert.equal(ranked[1].serverId, 3);
    assert.equal(ranked[2].serverId, 1);
  });

  test("average sort with peak tie-break", () => {
    // server 1: avg 20 peak 20 — server 2: avg 20 peak 30
    const st = aggregateLeaderboard([s(1, 20), s(1, 20), s(2, 30), s(2, 10)]);
    const ranked = rankLeaderboard(st, "average", 10);
    assert.equal(ranked[0].serverId, 2); // same average, higher peak wins
    assert.equal(ranked[1].serverId, 1);
  });

  test("topN caps the list; negative topN yields none", () => {
    assert.equal(rankLeaderboard(stats, "peak", 2).length, 2);
    assert.equal(rankLeaderboard(stats, "peak", -3).length, 0);
  });
});

describe("clampLeaderboardDays", () => {
  test("defaults, floors and caps", () => {
    assert.equal(clampLeaderboardDays(null), LEADERBOARD_DEFAULT_DAYS);
    assert.equal(clampLeaderboardDays("abc"), LEADERBOARD_DEFAULT_DAYS);
    assert.equal(clampLeaderboardDays(0), LEADERBOARD_DEFAULT_DAYS);
    assert.equal(clampLeaderboardDays(3), 3);
    assert.equal(clampLeaderboardDays(999), LEADERBOARD_MAX_DAYS);
    assert.equal(clampLeaderboardDays(2.9), 2);
  });
});
