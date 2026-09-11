/**
 * Tests for ephemeral (TTL) test servers.
 *
 * The sweeper recursively deletes install paths, so the path-safety rules
 * are the security core of this feature and are pinned hard.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampTtlHours,
  isExpired,
  describeTimeLeft,
  isSafeInstallPath,
  TTL_MAX_HOURS,
} from "../src/lib/ephemeral";

const NOW = 1_700_000_000_000;

describe("clampTtlHours", () => {
  test("clamps into 1..168", () => {
    assert.equal(clampTtlHours(24), 24);
    assert.equal(clampTtlHours(0.5), null);
    assert.equal(clampTtlHours(0), null);
    assert.equal(clampTtlHours(-5), null);
    assert.equal(clampTtlHours("abc"), null);
    assert.equal(clampTtlHours(9999), TTL_MAX_HOURS);
    assert.equal(clampTtlHours(48.9), 48);
  });
});

describe("isExpired", () => {
  test("past stamps expire, future and null don't", () => {
    assert.equal(isExpired(NOW - 1000, NOW), true);
    assert.equal(isExpired(NOW, NOW), true);
    assert.equal(isExpired(NOW + 1000, NOW), false);
    assert.equal(isExpired(null, NOW), false);
    assert.equal(isExpired(undefined, NOW), false);
  });

  test("garbage stamps never auto-delete", () => {
    assert.equal(isExpired("not-a-date", NOW), false);
  });
});

describe("describeTimeLeft", () => {
  test("bands", () => {
    assert.equal(describeTimeLeft(40 * 60_000), "40m");
    assert.equal(describeTimeLeft(5 * 3_600_000 + 12 * 60_000), "5h 12m");
    assert.equal(describeTimeLeft(2 * 86_400_000 + 3 * 3_600_000), "2d 3h");
    assert.equal(describeTimeLeft(1), "1m");
  });
});

describe("isSafeInstallPath", () => {
  test("normal install paths pass", () => {
    assert.equal(isSafeInstallPath("/opt/gameservers/tf2/my-server"), true);
    assert.equal(isSafeInstallPath("/home/gameservers/mc/lobby"), true);
    assert.equal(isSafeInstallPath("/opt/gameservers/tf2/my-server/"), true);
  });

  test("system roots and shallow paths are refused", () => {
    for (const bad of ["/", "/opt", "/home", "/root", "/opt/gameservers", "/a/b", "", null, undefined]) {
      assert.equal(isSafeInstallPath(bad as string), false, String(bad));
    }
  });

  test("traversal and non-absolute paths are refused", () => {
    assert.equal(isSafeInstallPath("/opt/gameservers/../../etc"), false);
    assert.equal(isSafeInstallPath("relative/path/here"), false);
    assert.equal(isSafeInstallPath("/opt/gameservers/tf2/.."), false);
  });
});
