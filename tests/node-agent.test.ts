/**
 * Unit tests for the node agent's pure helpers and the panel's RPC client.
 *
 * The agent guards a remote machine, so its two security primitives —
 * constant-time key comparison and path containment — are pinned here, and
 * the client's error mapping is exercised against a mock transport.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — the agent is a standalone .mjs with no type declarations
import { constantTimeMatch, containedPath, tailLines, parseMeminfo } from "../agent/gsm-agent.mjs";
import { nodeRpc, rpcUrl, NodeRpcError, DEFAULT_RPC_TIMEOUT_MS } from "../src/lib/node-client";

describe("agent: constantTimeMatch", () => {
  test("matches identical secrets", () => {
    assert.equal(constantTimeMatch("abc123", "abc123"), true);
  });

  test("rejects different secrets, including length tricks", () => {
    assert.equal(constantTimeMatch("abc123", "abc124"), false);
    assert.equal(constantTimeMatch("abc123", "abc1234"), false);
    assert.equal(constantTimeMatch("", "abc123"), false);
    assert.equal(constantTimeMatch(undefined, "abc123"), false);
    assert.equal(constantTimeMatch(null, null), false);
  });
});

describe("agent: containedPath", () => {
  const root = "/opt/gameservers";

  test("accepts paths inside the root", () => {
    assert.equal(containedPath(root, "/opt/gameservers/tf2"), "/opt/gameservers/tf2");
    assert.equal(containedPath(root, "tf2"), "/opt/gameservers/tf2");
    assert.equal(containedPath(root, "."), "/opt/gameservers");
  });

  test("refuses every escape vector", () => {
    assert.equal(containedPath(root, "../etc/passwd"), null);
    assert.equal(containedPath(root, "/etc/passwd"), null);
    assert.equal(containedPath(root, "a/../../etc/passwd"), null);
    // A sibling directory sharing the root as a string prefix.
    assert.equal(containedPath(root, "/opt/gameservers-evil/x"), null);
    assert.equal(containedPath(root, ""), null);
    assert.equal(containedPath(root, null), null);
    assert.equal(containedPath("", "tf2"), null);
  });
});

describe("agent: tailLines / parseMeminfo", () => {
  test("tail keeps the last N lines", () => {
    assert.equal(tailLines("a\nb\nc\nd", 2), "c\nd");
    assert.equal(tailLines("only", 5), "only");
    assert.equal(tailLines("", 5), "");
  });

  test("meminfo parsing finds total and available", () => {
    const mi = "MemTotal:       16384000 kB\nMemFree:         1000 kB\nMemAvailable:    8192000 kB\n";
    const { totalMb, availableMb } = parseMeminfo(mi);
    assert.equal(totalMb, 16000);
    assert.equal(availableMb, 8000);
  });
});

describe("node-client: rpcUrl", () => {
  test("joins tolerating trailing slashes", () => {
    assert.equal(rpcUrl("http://h:8787", "/rpc/ping"), "http://h:8787/rpc/ping");
    assert.equal(rpcUrl("http://h:8787/", "/rpc/ping"), "http://h:8787/rpc/ping");
    assert.equal(rpcUrl("http://h:8787///", "/rpc/ping"), "http://h:8787/rpc/ping");
  });
});

describe("node-client: nodeRpc", () => {
  const node = { apiUrl: "http://agent:8787", apiKey: "sekrit" };

  test("sends the key header and JSON body, parses the answer", async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ ok: true, hostname: "box1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await nodeRpc(node, "/rpc/ping", { a: 1 }, { fetchImpl: fake });
    assert.equal(res.hostname, "box1");
    assert.equal(seen.url, "http://agent:8787/rpc/ping");
    const headers = seen.init?.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sekrit");
    assert.equal(seen.init?.body, JSON.stringify({ a: 1 }));
  });

  test("refuses to call a node without URL/key", async () => {
    await assert.rejects(
      () => nodeRpc({ apiUrl: "", apiKey: "" }, "/rpc/ping", {}),
      (e: unknown) => e instanceof NodeRpcError && /no API URL\/key/.test(e.message)
    );
  });

  test("surfaces the agent's error message on non-2xx", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: "installPath outside the allowed root" }), { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(
      () => nodeRpc(node, "/rpc/process", {}, { fetchImpl: fake }),
      (e: unknown) => e instanceof NodeRpcError && /outside the allowed root/.test(e.message) && e.status === 400
    );
  });

  test("maps timeouts and connection failures to readable errors", async () => {
    const timeoutFetch = (async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    await assert.rejects(
      () => nodeRpc(node, "/rpc/ping", {}, { fetchImpl: timeoutFetch }),
      (e: unknown) => e instanceof NodeRpcError && /did not answer within/.test(e.message)
    );

    const downFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await assert.rejects(
      () => nodeRpc(node, "/rpc/ping", {}, { fetchImpl: downFetch }),
      (e: unknown) => e instanceof NodeRpcError && /Cannot reach the node agent/.test(e.message)
    );
  });

  test("the default timeout is a sane number", () => {
    assert.ok(DEFAULT_RPC_TIMEOUT_MS >= 5_000 && DEFAULT_RPC_TIMEOUT_MS <= 60_000);
  });
});
