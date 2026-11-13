/**
 * Tests for Discord's error bodies.
 *
 * `{"message":"Unknown Webhook","code":10015}` is what a deleted webhook
 * answers on every send — the failure an operator reports as "the bot stopped
 * posting". The panel used to pass the raw body through, so nothing recognised
 * the webhook as *permanently* gone, nothing offered a fix, and the status board
 * could not tell "the message was deleted, re-post it" (10008) from "the webhook
 * was deleted, stop trying" (10015).
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDiscordFailure,
  parseDiscordError,
  DISCORD_ERROR_CODES,
} from "../src/lib/discord-errors";

describe("parseDiscordError", () => {
  test("reads code, message and retry_after from Discord's JSON", () => {
    assert.deepEqual(
      parseDiscordError(JSON.stringify({ message: "Unknown Webhook", code: 10015 })),
      { code: 10015, message: "Unknown Webhook" }
    );
    const rate = parseDiscordError(
      JSON.stringify({ message: "You are being rate limited.", retry_after: 1.5 })
    );
    assert.equal(rate.retryAfterMs, 1750, "seconds -> ms, padded so a retry is not early");
  });

  test("a non-JSON body (a proxy, an HTML error page) yields nothing rather than throwing", () => {
    assert.deepEqual(parseDiscordError("<html>502 Bad Gateway</html>"), {});
    assert.deepEqual(parseDiscordError(""), {});
    assert.deepEqual(parseDiscordError('{"code":"10015"}'), {}, "string codes are ignored");
  });
});

describe("classifyDiscordFailure — the deleted webhook", () => {
  test("10015 Unknown Webhook is permanent and explains the fix", () => {
    const f = classifyDiscordFailure(404, JSON.stringify({ message: "Unknown Webhook", code: 10015 }));
    assert.equal(f.kind, "webhook-gone");
    assert.equal(f.gone, true, "retrying can never succeed");
    assert.equal(f.code, DISCORD_ERROR_CODES.UNKNOWN_WEBHOOK);
    assert.match(f.error, /no longer exists/);
    assert.match(f.error, /deleted in Discord/);
    assert.match(f.error, /Create missing channels/, "the operator is told how to repair it");
  });

  test("the code is enough even when Discord answers a different status", () => {
    // Documented as 404, but Discord has returned it on other routes too; the
    // code, not the status, is what identifies the loss.
    const f = classifyDiscordFailure(400, JSON.stringify({ message: "Unknown Webhook", code: 10015 }));
    assert.equal(f.gone, true);
  });

  test("a deleted message is recoverable, not a dead webhook", () => {
    // 10008 is what a board gets when its message was deleted by hand. The
    // webhook is fine — post again. Calling this "gone" would disable a board
    // whose channel is healthy.
    const f = classifyDiscordFailure(404, JSON.stringify({ message: "Unknown Message", code: 10008 }));
    assert.equal(f.kind, "message-gone");
    assert.equal(f.gone, false);
    assert.match(f.error, /posted again/);
  });

  test("a deleted channel's webhook is the same story", () => {
    const f = classifyDiscordFailure(404, JSON.stringify({ message: "Unknown Channel", code: 10003 }));
    assert.equal(f.gone, true);
    assert.match(f.error, /whole channel/);
  });

  test("a rotated token says the URL is stale, not that the channel is gone", () => {
    const f = classifyDiscordFailure(401, JSON.stringify({ message: "Invalid Webhook Token", code: 50027 }));
    assert.equal(f.gone, true, "the stored URL can never work again");
    assert.match(f.error, /re-created in Discord/);
    assert.match(f.error, /stale/);
  });

  test("a 404 with no body at all is still treated as gone", () => {
    // A proxy can swallow Discord's JSON; a 404 on a webhook route cannot mean
    // anything else, and leaving it unclassified is how the panel stayed mute.
    const f = classifyDiscordFailure(404, "");
    assert.equal(f.gone, true);
    assert.equal(f.code, undefined);
  });
});

describe("classifyDiscordFailure — everything else", () => {
  test("401 and 403 are credential/permission problems, not losses", () => {
    const unauth = classifyDiscordFailure(401, JSON.stringify({ message: "401: Unauthorized", code: 0 }));
    assert.equal(unauth.kind, "unauthorized");
    assert.equal(unauth.gone, false, "a bad token must not get the webhook replaced");

    const forbidden = classifyDiscordFailure(403, JSON.stringify({ message: "Missing Permissions", code: 50013 }));
    assert.equal(forbidden.kind, "unauthorized");
    assert.match(forbidden.error, /Manage Webhooks/);
    assert.equal(forbidden.gone, false);
  });

  test("429 carries a retry-after from the body, falling back to the header", () => {
    const fromBody = classifyDiscordFailure(
      429,
      JSON.stringify({ message: "You are being rate limited.", retry_after: 2 })
    );
    assert.equal(fromBody.kind, "rate-limited");
    assert.equal(fromBody.retryAfterMs, 2250);
    assert.match(fromBody.error, /retry-after: 2s/);

    const fromHeader = classifyDiscordFailure(429, "", 5);
    assert.equal(fromHeader.retryAfterMs, 5250);
    assert.equal(fromHeader.gone, false);
  });

  test("a 5xx is Discord's problem and may succeed later", () => {
    const f = classifyDiscordFailure(503, "");
    assert.equal(f.kind, "server-error");
    assert.equal(f.gone, false, "never destroy a webhook because Discord was down");
  });

  test("400 means the payload was rejected", () => {
    const f = classifyDiscordFailure(400, JSON.stringify({ message: "Cannot send an empty message", code: 50006 }));
    assert.equal(f.kind, "bad-request");
    assert.match(f.error, /Cannot send an empty message/);
  });

  test("an unknown status still says what came back, briefly", () => {
    const f = classifyDiscordFailure(418, "I'm a teapot");
    assert.equal(f.kind, "other");
    assert.match(f.error, /418/);
    assert.match(f.error, /teapot/);
  });

  test("no classification ever claims 'gone' without evidence", () => {
    // A false "gone" is expensive: it makes the panel re-create webhooks and
    // disable live boards for a server that is perfectly fine.
    for (const status of [400, 401, 403, 429, 500, 502, 503, 504, 418]) {
      assert.equal(classifyDiscordFailure(status, "").gone, false, `status ${status}`);
    }
  });
});
