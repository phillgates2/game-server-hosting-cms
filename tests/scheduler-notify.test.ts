/**
 * Tests for the scheduled-task Discord notification wording.
 *
 * The message travels straight into a community Discord channel, so the
 * success/failure shapes are pinned here rather than eyeballed in a server.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildScheduledTaskMessage } from "../src/lib/discord";

describe("scheduled task messages", () => {
  test("a successful restart names the task, server and outcome", () => {
    const msg = buildScheduledTaskMessage("restart", "My TF2", true, "back online (pid 4242)");
    assert.match(msg, /^⏰/);
    assert.match(msg, /\*\*restart\*\*/);
    assert.match(msg, /\*\*My TF2\*\*/);
    assert.match(msg, /completed/);
    assert.match(msg, /pid 4242/);
  });

  test("a successful backup names the archive", () => {
    const msg = buildScheduledTaskMessage("backup", "ET Server", true, "archive backup-2026-09-10.tar.gz");
    assert.match(msg, /completed/);
    assert.match(msg, /backup-2026-09-10\.tar\.gz/);
  });

  test("a failure is flagged with the reason", () => {
    const msg = buildScheduledTaskMessage("update", "CS:S #1", false, "the server must be stopped to update");
    assert.match(msg, /^⚠️/);
    assert.match(msg, /failed/);
    assert.match(msg, /must be stopped/);
    assert.ok(!/completed/.test(msg), "a failure must not also claim completion");
  });

  test("a failure without a detail still reads sanely", () => {
    const msg = buildScheduledTaskMessage("command", "Box", false);
    assert.match(msg, /Scheduled \*\*command\*\* of \*\*Box\*\* failed$/);
  });

  test("success without detail omits the separator", () => {
    const msg = buildScheduledTaskMessage("restart", "Box", true);
    assert.match(msg, /completed$/);
  });
});
