/**
 * Boot decisions for the app shell.
 *
 * The regression these guard: `/api/install` failing used to be indistinguishable
 * from "not installed", so a dropped request or a database outage put the
 * operator in the install wizard on a panel that already had servers. Only an
 * explicit `installed: false` may open the wizard.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BOOT_TIMEOUT_MS,
  classifyBootFailure,
  classifyInstallResponse,
  isTimeoutError,
} from "../src/lib/app-boot";

describe("install probe classification", () => {
  test("an installed panel goes to the site", () => {
    assert.deepEqual(classifyInstallResponse(200, { installed: true, logs: [] }), {
      kind: "ready",
    });
  });

  test("an explicit 'not installed' opens the wizard", () => {
    assert.deepEqual(classifyInstallResponse(200, { installed: false, logs: [] }), {
      kind: "install",
    });
  });

  test("a database outage is unreachable, never the wizard", () => {
    // The old GET answered `{installed:false}` with a 200 when the query
    // failed; the route now answers 503 and the shell must respect it.
    const outcome = classifyInstallResponse(503, {
      installed: null,
      error: "database unavailable",
    });
    assert.equal(outcome.kind, "unreachable");
    assert.match((outcome as { message: string }).message, /503/);
  });

  test("server errors are unreachable", () => {
    for (const status of [500, 502, 504]) {
      assert.equal(classifyInstallResponse(status, null).kind, "unreachable");
    }
  });

  test("a missing install route is unreachable, not an install", () => {
    const outcome = classifyInstallResponse(404, null);
    assert.equal(outcome.kind, "unreachable");
    assert.match((outcome as { message: string }).message, /404/);
  });

  test("a refused request is unreachable", () => {
    assert.equal(classifyInstallResponse(403, { installed: false }).kind, "unreachable");
    assert.equal(classifyInstallResponse(401, { installed: false }).kind, "unreachable");
  });

  test("a 200 that says nothing about the install state is a fault", () => {
    for (const body of [{}, null, [], "ok", { installed: "yes" }, { installed: 1 }]) {
      assert.equal(
        classifyInstallResponse(200, body).kind,
        "unreachable",
        `${JSON.stringify(body)} must not be read as an answer`
      );
    }
  });

  test("network failure (status 0) is unreachable", () => {
    const outcome = classifyInstallResponse(0, null);
    assert.equal(outcome.kind, "unreachable");
    assert.match((outcome as { message: string }).message, /could not be reached/i);
  });

  test("no failure path can ever produce 'install'", () => {
    const statuses = [0, 400, 401, 403, 404, 409, 429, 500, 502, 503, 504];
    for (const status of statuses) {
      assert.notEqual(classifyInstallResponse(status, { installed: false }).kind, "install");
      assert.notEqual(classifyInstallResponse(status, null).kind, "install");
    }
  });
});

describe("boot failure classification", () => {
  test("offline says so and promises nothing changed", () => {
    const outcome = classifyBootFailure({ online: false });
    assert.equal(outcome.kind, "unreachable");
    assert.match((outcome as { message: string }).message, /offline/i);
    assert.match((outcome as { message: string }).message, /nothing on the panel has changed/i);
  });

  test("a timeout explains the panel may be restarting", () => {
    const outcome = classifyBootFailure({ online: true, timedOut: true });
    assert.equal(outcome.kind, "unreachable");
    assert.match((outcome as { message: string }).message, /did not answer in time/i);
  });

  test("offline wins over timeout — the cause matters to the user", () => {
    const outcome = classifyBootFailure({ online: false, timedOut: true });
    assert.match((outcome as { message: string }).message, /offline/i);
  });

  test("a supplied detail is used verbatim, blank details are ignored", () => {
    assert.equal(
      classifyBootFailure({ online: true, detail: "Proxy refused the connection" }).kind ===
        "unreachable"
        ? (classifyBootFailure({ online: true, detail: "Proxy refused the connection" }) as {
            message: string;
          }).message
        : null,
      "Proxy refused the connection"
    );
    assert.match(
      (classifyBootFailure({ online: true, detail: "   " }) as { message: string }).message,
      /could not be reached/i
    );
  });
});

describe("timeout detection", () => {
  test("recognises the abort reason fetch produces", () => {
    assert.equal(isTimeoutError(new DOMException("late", "TimeoutError")), true);
    assert.equal(isTimeoutError(new DOMException("stop", "AbortError")), true);
  });

  test("anything else is not a timeout", () => {
    assert.equal(isTimeoutError(new Error("boom")), false);
    assert.equal(isTimeoutError(null), false);
    assert.equal(isTimeoutError("TimeoutError"), false);
    assert.equal(isTimeoutError({ name: "TypeError" }), false);
  });

  test("the probe budget is long enough for a cold start but not a hang", () => {
    assert.ok(BOOT_TIMEOUT_MS >= 5_000);
    assert.ok(BOOT_TIMEOUT_MS <= 30_000);
  });
});
