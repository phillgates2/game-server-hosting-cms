/**
 * Tests for the extra (non-panel) ET servers used by `!etallofoz`.
 *
 * Parsing is pure; the master UDP query is injected, so no test touches the
 * network. The real socket (queryMasterServer) is a thin wrapper over these
 * parsers plus a timeout.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseExtraServerList,
  parseExtraServerEntry,
  parseMasterUrlList,
  parseMasterChunk,
  loadExternalEtServers,
  extraKey,
  DEFAULT_MASTER_URLS,
  MAX_DISCOVERED_SERVERS,
} from "../src/lib/et-extra-servers";

describe("parseExtraServerList", () => {
  test("accepts host:port, host:port:queryPort, comments and blanks", () => {
    const r = parseExtraServerList([
      "# my friends' servers",
      "203.44.23.44:27960",
      " 198.51.100.7:27960:27961 ",
      "",
      "# trailing comment line",
    ].join("\n"));
    assert.equal(r.errors.length, 0);
    assert.deepEqual(r.servers.map((s) => `${s.host}:${s.port}:${s.queryPort}`), [
      "203.44.23.44:27960:27960",
      "198.51.100.7:27960:27961",
    ]);
    assert.ok(r.servers.every((s) => s.discovered === false));
  });

  test("reports malformed lines instead of silently dropping them", () => {
    const r = parseExtraServerList("nope\n203.44.23.44:27960\nhost:99999\n:27960\n");
    assert.equal(r.servers.length, 1, "only the valid line survives");
    assert.equal(r.errors.length, 3, "each bad line is named");
    assert.match(r.errors[0], /nope/);
  });

  test("deduplicates repeated entries (first wins)", () => {
    const r = parseExtraServerList("a.example:1\na.example:1\nb.example:2\n");
    assert.equal(r.servers.length, 2);
    assert.equal(r.servers[0].port, 1);
  });

  test("rejects bad host characters and out-of-range ports", () => {
    assert.equal(parseExtraServerList("ho st:1").servers.length, 0);
    assert.equal(parseExtraServerList("host:0").servers.length, 0);
    assert.equal(parseExtraServerList("host:65536").servers.length, 0);
    assert.equal(parseExtraServerList("host:1:2:3").servers.length, 0);
  });
});

describe("parseMasterUrlList", () => {
  test("host defaults to port 27950; explicit ports and separators work", () => {
    const r = parseMasterUrlList("master0.etmaster.net, master.anime.net:27951 etmaster.idsoftware.com:27950");
    assert.deepEqual(r.masters, [
      { host: "master0.etmaster.net", port: 27950 },
      { host: "master.anime.net", port: 27951 },
      { host: "etmaster.idsoftware.com", port: 27950 },
    ]);
    assert.equal(r.errors.length, 0);
  });
});

describe("DEFAULT_MASTER_URLS", () => {
  test("is the classic community list in sv_master order, 27900 preserved", () => {
    const r = parseMasterUrlList(DEFAULT_MASTER_URLS);
    assert.equal(r.errors.length, 0);
    assert.deepEqual(r.masters, [
      { host: "etmaster.idsoftware.com", port: 27950 },
      { host: "master0.etmaster.net", port: 27950 },
      { host: "master3.idsoftware.com", port: 27950 },
      { host: "wolfmaster.idsoftware.com", port: 27950 },
      { host: "master3.idsoftware.com", port: 27900 },
      { host: "master.etlegacy.com", port: 27950 },
    ]);
  });

  test("each master host passes the list-entry validator", () => {
    for (const m of parseMasterUrlList(DEFAULT_MASTER_URLS).masters) {
      assert.ok(parseExtraServerEntry(`${m.host}:${m.port}`), m.host);
    }
  });
});

describe("parseMasterChunk", () => {
  test("parses the classic ASCII CSV reply and stops at EOT", () => {
    const chunk = Buffer.from("\\getserversResponse\\203.44.23.44:27960,198.51.100.7:27961\\EOT", "latin1");
    const r = parseMasterChunk(chunk);
    assert.deepEqual(r.servers.map((s) => extraKey(s.host, s.port)), [
      "203.44.23.44:27960",
      "198.51.100.7:27961",
    ]);
    assert.equal(r.done, true);
  });

  test("parses the ET binary 6-byte records (IPv4 + BE port)", () => {
    // 1.2.3.4:27960 and 5.6.7.8:27961
    const rec1 = Buffer.from([1, 2, 3, 4, 0x6d, 0x38]); // 27960 = 0x6D38
    const rec2 = Buffer.from([5, 6, 7, 8, 0x6d, 0x39]); // 27961 = 0x6D39
    const chunk = Buffer.concat([
      Buffer.from("\\getserversResponse\\", "latin1"), rec1, rec2, Buffer.from("\\EOT", "latin1"),
    ]);
    const r = parseMasterChunk(chunk);
    assert.deepEqual(r.servers.map((s) => `${s.host}:${s.port}`), ["1.2.3.4:27960", "5.6.7.8:27961"]);
    assert.equal(r.done, true);
  });

  test("a continuation chunk still yields records without a marker", () => {
    const rec = Buffer.from([9, 9, 9, 9, 0x6d, 0x38]);
    const r = parseMasterChunk(rec);
    assert.deepEqual(r.servers.map((s) => `${s.host}:${s.port}`), ["9.9.9.9:27960"]);
    assert.equal(r.done, false);
  });

  test("garbage chunks parse to nothing without throwing", () => {
    const r = parseMasterChunk(Buffer.from("hello world", "latin1"));
    assert.deepEqual(r.servers, []);
    assert.equal(r.done, false);
  });
});

describe("loadExternalEtServers", () => {
  test("configured list alone (no mastery) works", async () => {
    const r = await loadExternalEtServers({ configText: "a.example:1\nb.example:2", mastersText: "", panelServers: [] });
    assert.equal(r.servers.length, 2);
    assert.ok(r.servers.every((s) => !s.discovered));
    assert.equal(r.errors.length, 0);
  });

  test("master discovery adds servers, capped and deduped against panel + config", async () => {
    const r = await loadExternalEtServers({
      configText: "a.example:1",
      mastersText: "master0.etmaster.net",
      panelServers: [{ host: "1.2.3.4", port: 27960 }],
      queryMaster: async () => [
        { host: "1.2.3.4", port: 27960 }, // panel server — excluded
        { host: "a.example", port: 1 },   // already configured — excluded
        { host: "5.6.7.8", port: 27960 },
        { host: "9.9.9.9", port: 27960 },
      ],
    });
    const discovered = r.servers.filter((s) => s.discovered);
    assert.equal(discovered.length, 2);
    assert.deepEqual(discovered.map((s) => `${s.host}:${s.port}`), ["5.6.7.8:27960", "9.9.9.9:27960"]);
    assert.equal(r.usedMaster, "master0.etmaster.net:27950");
  });

  test("cap bounds discovery", async () => {
    const r = await loadExternalEtServers({
      configText: "",
      mastersText: "m:1",
      panelServers: [],
      maxDiscovered: 2,
      queryMaster: async () =>
        Array.from({ length: 10 }, (_, i) => ({ host: `10.0.0.${i}`, port: 27960 })),
    });
    assert.equal(r.servers.length, 2);
  });

  test("a dead master yields errors but never throws", async () => {
    const r = await loadExternalEtServers({
      configText: "a.example:1",
      mastersText: "m:1",
      panelServers: [],
      queryMaster: async () => {
        throw new Error("udp failed");
      },
    });
    assert.equal(r.servers.length, 1, "config list survives");
    assert.equal(r.usedMaster, undefined);
    assert.ok(r.errors.some((e) => /no master server answered/.test(e)));
  });

  test("defaults to the real socket and the documented cap", () => {
    assert.equal(MAX_DISCOVERED_SERVERS, 25);
  });
});
