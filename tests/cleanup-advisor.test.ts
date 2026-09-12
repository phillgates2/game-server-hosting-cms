/**
 * Tests for the fleet cleanup advisor (pure layer).
 *
 * The contract: advice is conservative — running/installing/ephemeral and
 * recently-played servers are never flagged, unknown stop times assume the
 * best, and only long-stopped+unplayed servers become candidates.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assessServerForCleanup,
  CLEANUP_CANDIDATE_STOPPED_DAYS,
  CLEANUP_REVIEW_STOPPED_DAYS,
  CLEANUP_SAMPLE_WINDOW_DAYS,
} from "../src/lib/cleanup-advisor";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe("assessServerForCleanup", () => {
  test("running and installing servers are always healthy", () => {
    assert.equal(assessServerForCleanup({ status: "running", lastStoppedMs: NOW - 999 * DAY, lastSampleMs: null, isEphemeral: false }, NOW).level, "healthy");
    assert.equal(assessServerForCleanup({ status: "installing", lastStoppedMs: null, lastSampleMs: null, isEphemeral: false }, NOW).level, "healthy");
  });

  test("ephemeral servers are exempt", () => {
    assert.equal(assessServerForCleanup({ status: "stopped", lastStoppedMs: NOW - 100 * DAY, lastSampleMs: null, isEphemeral: true }, NOW).level, "healthy");
  });

  test("recent players keep a stopped server healthy", () => {
    const a = assessServerForCleanup({ status: "stopped", lastStoppedMs: NOW - 30 * DAY, lastSampleMs: NOW - 1 * DAY, isEphemeral: false }, NOW);
    assert.equal(a.level, "healthy");
    assert.match(a.reason, /players sampled/);
  });

  test("long-stopped with no players becomes a candidate", () => {
    const a = assessServerForCleanup({ status: "stopped", lastStoppedMs: NOW - CLEANUP_CANDIDATE_STOPPED_DAYS * DAY, lastSampleMs: NOW - 60 * DAY, isEphemeral: false }, NOW);
    assert.equal(a.level, "candidate");
    assert.match(a.reason, /no players/);
  });

  test("mid-stopped servers are only up for review", () => {
    const a = assessServerForCleanup({ status: "stopped", lastStoppedMs: NOW - CLEANUP_REVIEW_STOPPED_DAYS * DAY, lastSampleMs: null, isEphemeral: false }, NOW);
    assert.equal(a.level, "review");
  });

  test("freshly stopped servers are healthy", () => {
    const a = assessServerForCleanup({ status: "stopped", lastStoppedMs: NOW - 2 * DAY, lastSampleMs: null, isEphemeral: false }, NOW);
    assert.equal(a.level, "healthy");
  });

  test("unknown stop time is treated conservatively (recent)", () => {
    const a = assessServerForCleanup({ status: "stopped", lastStoppedMs: null, lastSampleMs: null, isEphemeral: false }, NOW);
    assert.equal(a.level, "healthy");
  });

  test("sample window boundary: a sample exactly at the window edge still counts", () => {
    const a = assessServerForCleanup({ status: "stopped", lastStoppedMs: NOW - 30 * DAY, lastSampleMs: NOW - CLEANUP_SAMPLE_WINDOW_DAYS * DAY, isEphemeral: false }, NOW);
    assert.equal(a.level, "healthy");
  });
});
