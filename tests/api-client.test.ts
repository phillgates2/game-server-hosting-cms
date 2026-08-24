/**
 * Tests for the panel's mutation helper.
 *
 * Several panels performed a POST/PATCH/DELETE and then reloaded the list
 * without inspecting the response. A refusal — a 403 because the role lacks
 * the permission, or a 400 from a validation guard — produced no message at
 * all: the list simply redisplayed unchanged, which is indistinguishable from
 * the action having no effect.
 *
 * The important behaviour here is that a failure is always reported, and that
 * the server's own wording wins when it has some, because those messages are
 * already written for a human.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { messageForStatus, mutate } from "../src/lib/api-client";
import { intParam } from "../src/lib/pagination";

describe("status messages", () => {
  test("prefers the server's own message", () => {
    // The API writes things like "This user owns 3 server(s). Delete or
    // reassign them first." — far better than anything generic.
    assert.equal(
      messageForStatus(400, "This user owns 3 server(s)."),
      "This user owns 3 server(s)."
    );
  });

  test("falls back to a readable sentence per status", () => {
    assert.match(messageForStatus(403), /permission/i);
    assert.match(messageForStatus(401), /session/i);
    assert.match(messageForStatus(404), /no longer exists/i);
    assert.match(messageForStatus(409), /conflicts/i);
    assert.match(messageForStatus(429), /Too many/i);
    assert.match(messageForStatus(500), /server ran into a problem/i);
  });

  test("ignores a blank server message rather than showing an empty toast", () => {
    assert.match(messageForStatus(403, ""), /permission/i);
    assert.match(messageForStatus(403, "   "), /permission/i);
  });

  test("never returns a bare status code for a common failure", () => {
    for (const s of [400, 401, 403, 404, 409, 429, 500, 503]) {
      assert.doesNotMatch(
        messageForStatus(s),
        /^Request failed/,
        `${s} should have a written message`
      );
    }
  });
});

describe("mutate", () => {
  const originalFetch = globalThis.fetch;

  function stubFetch(res: {
    ok: boolean;
    status: number;
    body?: unknown;
    throws?: boolean;
  }) {
    globalThis.fetch = (async () => {
      if (res.throws) throw new Error("network down");
      return {
        ok: res.ok,
        status: res.status,
        text: async () => (res.body === undefined ? "" : JSON.stringify(res.body)),
      } as unknown as Response;
    }) as typeof fetch;
  }

  test("reports success with the parsed body", async () => {
    stubFetch({ ok: true, status: 200, body: { ok: true, id: 7 } });
    const r = await mutate<{ id: number }>("/api/x", { method: "POST" });
    globalThis.fetch = originalFetch;
    assert.equal(r.ok, true);
    assert.equal(r.data?.id, 7);
    assert.equal(r.error, undefined);
  });

  test("surfaces a 403 with the permission wording", async () => {
    stubFetch({ ok: false, status: 403, body: { error: "Permission denied" } });
    const r = await mutate("/api/x", { method: "DELETE" });
    globalThis.fetch = originalFetch;
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.error, "Permission denied");
  });

  test("a network failure is a result, not a thrown error", async () => {
    // Callers use `if (!res.ok)`; an exception here would skip that branch and
    // leave the UI in a half-updated state.
    stubFetch({ ok: false, status: 0, throws: true });
    const r = await mutate("/api/x", { method: "POST" });
    globalThis.fetch = originalFetch;
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.match(String(r.error), /Could not reach the server/);
  });

  test("an empty body on success is fine", async () => {
    stubFetch({ ok: true, status: 204 });
    const r = await mutate("/api/x", { method: "DELETE" });
    globalThis.fetch = originalFetch;
    assert.equal(r.ok, true);
    assert.equal(r.data, null);
  });

  test("a non-JSON error body still yields a usable message", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 502,
        text: async () => "<html>Bad Gateway</html>",
      }) as unknown as Response) as typeof fetch;
    const r = await mutate("/api/x", { method: "POST" });
    globalThis.fetch = originalFetch;
    assert.equal(r.ok, false);
    assert.match(String(r.error), /server ran into a problem/i);
  });

  test("sets a JSON content type only when there is a body", async () => {
    let seen: Record<string, string> = {};
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      seen = (init.headers ?? {}) as Record<string, string>;
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;

    await mutate("/api/x", { method: "DELETE" });
    assert.equal("Content-Type" in seen, false, "no body, no content type");

    await mutate("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    assert.equal(seen["Content-Type"], "application/json");

    globalThis.fetch = originalFetch;
  });
});

describe("log tail clamping", () => {
  // The log endpoint used raw parseInt, which produced two wrong answers that
  // both looked like real output rather than bad input.
  const tail = (v: string | null) => intParam(v, 200, 1, 5000);

  test("a negative tail no longer empties the log", () => {
    // slice(-(-5)) === slice(5) === [] on a 5-line file: the UI showed an
    // empty console, indistinguishable from a server that printed nothing.
    assert.equal(tail("-5"), 1);
  });

  test("exponent notation no longer collapses to one line", () => {
    // parseInt("1e9") is 1, so asking for a million lines returned exactly one.
    assert.equal(tail("1e9"), 1);
  });

  test("junk falls back to the default", () => {
    assert.equal(tail("abc"), 200);
    assert.equal(tail(null), 200);
    assert.equal(tail(""), 200);
  });

  test("sane values pass through, large ones are capped", () => {
    assert.equal(tail("500"), 500);
    assert.equal(tail("5000"), 5000);
    assert.equal(tail("99999"), 5000);
  });
});
