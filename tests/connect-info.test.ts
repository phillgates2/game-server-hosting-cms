/**
 * Tests for game-specific connection strings.
 *
 * The shapes are what players actually paste: Source-family console
 * commands, bare Minecraft addresses with default-port elision, and sane
 * fallbacks for everything else.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  connectInfoFor,
  pickHost,
  CONNECT_CONSOLE_SLUGS,
  MINECRAFT_JAVA_SLUGS,
} from "../src/lib/connect-info";

describe("pickHost", () => {
  test("prefers a usable IPv4", () => {
    assert.equal(pickHost("203.0.113.9", "2001:db8::1"), "203.0.113.9");
  });

  test("0.0.0.0 (bind-all) is not a public address", () => {
    assert.equal(pickHost("0.0.0.0", "203.0.113.9"), "203.0.113.9");
    assert.equal(pickHost("0.0.0.0", null), null);
  });

  test("IPv6 gets brackets for host:port forms", () => {
    assert.equal(pickHost(null, "2001:db8::7"), "[2001:db8::7]");
  });

  test("nothing usable yields null", () => {
    assert.equal(pickHost(null, null), null);
    assert.equal(pickHost("", "   "), null);
  });
});

describe("connectInfoFor — Source-family games", () => {
  test("emits a console connect command", () => {
    const info = connectInfoFor("tf2", "203.0.113.9", null, 27015);
    assert.equal(info.connect, "connect 203.0.113.9:27015");
    assert.match(info.hint, /console/i);
  });

  test("all console-family slugs get the connect shape", () => {
    for (const slug of CONNECT_CONSOLE_SLUGS) {
      const info = connectInfoFor(slug, "1.2.3.4", null, 27015);
      assert.equal(info.connect, "connect 1.2.3.4:27015", slug);
    }
  });

  test("IPv6 addresses are bracketed inside the command", () => {
    const info = connectInfoFor("tf2", "0.0.0.0", "2001:db8::7", 27015);
    assert.equal(info.connect, "connect [2001:db8::7]:27015");
  });
});

describe("connectInfoFor — Minecraft", () => {
  test("Java editions elide the default port", () => {
    for (const slug of MINECRAFT_JAVA_SLUGS) {
      const info = connectInfoFor(slug, "mc.example.com", null, 25565);
      assert.equal(info.connect, "mc.example.com", slug);
      assert.match(info.hint, /Multiplayer/i);
    }
  });

  test("non-default Java ports are kept", () => {
    const info = connectInfoFor("minecraft-paper", "203.0.113.9", null, 25577);
    assert.equal(info.connect, "203.0.113.9:25577");
  });

  test("Bedrock elides its own default port", () => {
    assert.equal(connectInfoFor("minecraft-bedrock", "203.0.113.9", null, 19132).connect, "203.0.113.9");
    assert.equal(connectInfoFor("minecraft-bedrock", "203.0.113.9", null, 19133).connect, "203.0.113.9:19133");
  });
});

describe("connectInfoFor — fallbacks", () => {
  test("unknown games get plain host:port", () => {
    const info = connectInfoFor("valheim", "203.0.113.9", null, 2456);
    assert.equal(info.connect, "203.0.113.9:2456");
    assert.equal(info.address, "203.0.113.9:2456");
  });

  test("null slug still yields host:port", () => {
    assert.equal(connectInfoFor(null, "203.0.113.9", null, 7777).connect, "203.0.113.9:7777");
  });

  test("no usable address → no connect string, helpful hint", () => {
    const info = connectInfoFor("tf2", "0.0.0.0", null, 27015);
    assert.equal(info.connect, null);
    assert.equal(info.address, null);
    assert.match(info.hint, /no public address/i);
  });
});
