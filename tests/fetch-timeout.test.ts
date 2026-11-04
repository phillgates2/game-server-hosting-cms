/**
 * `fetchWithTimeout` — the deadline every boot request now carries.
 *
 * Without it a request to a wedged panel process never settles, so the screen
 * waits on a spinner forever with no way to tell "slow" from "never". These
 * tests stub `fetch` so they need no server.
 *
 *   npm test
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout } from "../src/lib/api-client";
import { isTimeoutError } from "../src/lib/app-boot";

const realFetch = globalThis.fetch;

function hangUntilAborted(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // would hang forever; the deadline must supply one
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchWithTimeout", () => {
  test("returns a successful response and passes its own signal to fetch", async () => {
    let seenSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithTimeout("/api/install", {}, 500);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.ok(seenSignal instanceof AbortSignal, "fetch must receive an abort signal");
    assert.equal(seenSignal?.aborted, false);
  });

  test("aborts a request that never answers", async () => {
    globalThis.fetch = hangUntilAborted();

    await assert.rejects(
      () => fetchWithTimeout("/api/install", {}, 20),
      (error: unknown) => isTimeoutError(error)
    );
  });

  test("the timeout reason names the deadline", async () => {
    globalThis.fetch = hangUntilAborted();
    let reason: unknown = null;
    try {
      await fetchWithTimeout("/api/install", {}, 10);
    } catch (error) {
      reason = error;
    }
    assert.ok(reason instanceof DOMException);
    assert.equal((reason as DOMException).name, "TimeoutError");
    assert.match((reason as DOMException).message, /timed out/i);
  });

  test("a caller-supplied signal still cancels the request", async () => {
    globalThis.fetch = hangUntilAborted();
    const controller = new AbortController();
    const promise = fetchWithTimeout("/api/install", { signal: controller.signal }, 60_000);
    controller.abort(new DOMException("navigated away", "AbortError"));

    await assert.rejects(promise, (error: unknown) => isTimeoutError(error));
  });

  test("an already-aborted signal does not reach the network", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const controller = new AbortController();
    controller.abort(new DOMException("already gone", "AbortError"));

    await assert.rejects(
      () => fetchWithTimeout("/api/install", { signal: controller.signal }, 500),
      (error: unknown) => isTimeoutError(error)
    );
    assert.equal(called, false, "an aborted request must not be sent");
  });

  test("the default deadline is a real budget", () => {
    assert.ok(DEFAULT_TIMEOUT_MS >= 5_000);
    assert.ok(DEFAULT_TIMEOUT_MS <= 60_000);
  });
});
