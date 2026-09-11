/**
 * Tests for the IP allowlist rule math.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseAllowList,
  isLoopback,
  ipMatchesRule,
  ipAllowed,
} from "../src/lib/ip-allowlist";

describe("parseAllowList", () => {
  test("splits commas and newlines, trims, drops empties", () => {
    assert.deepEqual(parseAllowList("1.2.3.4, 5.6.7.8\n9.9.9.9,, "), ["1.2.3.4", "5.6.7.8", "9.9.9.9"]);
    assert.deepEqual(parseAllowList(null), []);
    assert.deepEqual(parseAllowList("   "), []);
  });
});

describe("isLoopback", () => {
  test("v4 and v6 loopback pass", () => {
    assert.equal(isLoopback("127.0.0.1"), true);
    assert.equal(isLoopback("127.5.5.5"), true);
    assert.equal(isLoopback("::1"), true);
    assert.equal(isLoopback("[::1]"), true);
    assert.equal(isLoopback("8.8.8.8"), false);
    assert.equal(isLoopback(null), false);
  });
});

describe("ipMatchesRule", () => {
  test("exact, subnet glob and wildcard", () => {
    assert.equal(ipMatchesRule("1.2.3.4", "1.2.3.4"), true);
    assert.equal(ipMatchesRule("1.2.3.99", "1.2.3.*"), true);
    assert.equal(ipMatchesRule("1.2.4.1", "1.2.3.*"), false);
    assert.equal(ipMatchesRule("10.1.2.3", "10.*"), true);
    assert.equal(ipMatchesRule("192.168.1.1", "*"), true);
  });

  test("a glob never matches across the dot boundary accidentally", () => {
    assert.equal(ipMatchesRule("1.2.30.4", "1.2.3.*"), false);
  });
});

describe("ipAllowed", () => {
  test("empty list allows everything", () => {
    assert.equal(ipAllowed("203.0.113.9", []), true);
    assert.equal(ipAllowed(null, []), true);
  });

  test("loopback always passes, even with a list", () => {
    assert.equal(ipAllowed("127.0.0.1", ["203.0.113.9"]), true);
  });

  test("unknown IPs fail closed when a list exists", () => {
    assert.equal(ipAllowed(null, ["203.0.113.9"]), false);
    assert.equal(ipAllowed("unknown", ["203.0.113.9"]), false);
  });

  test("listed IPs pass, others don't", () => {
    assert.equal(ipAllowed("203.0.113.9", ["203.0.113.9", "10.*"]), true);
    assert.equal(ipAllowed("10.0.0.7", ["203.0.113.9", "10.*"]), true);
    assert.equal(ipAllowed("192.0.2.1", ["203.0.113.9", "10.*"]), false);
  });
});
