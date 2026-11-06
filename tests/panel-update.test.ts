import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SELF_UPDATE_WRAPPER,
  DEFAULT_UPDATE_STATE_PATH,
  TOTAL_UPDATE_STEPS,
  UPDATE_STALE_MS,
  detachedUpdateCommand,
  formatDuration,
  formatWhen,
  lastMeaningfulLine,
  parseUpdateState,
  readInstallInfo,
  selfUpdateCommand,
  shellQuote,
  stateFromLaunchFailure,
  updateAvailability,
  updateIsRunning,
  updateProgress,
  updateSummary,
} from "../src/lib/panel-update";

const NOW = Date.parse("2026-11-06T10:00:00Z");

function state(overrides: Record<string, unknown> = {}) {
  return {
    status: "running",
    phase: "step-2",
    step: 2,
    totalSteps: TOTAL_UPDATE_STEPS,
    message: "Stopping panel",
    startedAt: "2026-11-06T09:58:00Z",
    updatedAt: "2026-11-06T09:59:30Z",
    finishedAt: null,
    branch: "main",
    fromCommit: "abc1234",
    toCommit: null,
    exitCode: null,
    error: null,
    ...overrides,
  };
}

// ── parseUpdateState ─────────────────────────────────────────────────────────

test("parseUpdateState accepts what the updater writes", () => {
  const parsed = parseUpdateState(state());
  assert.ok(parsed);
  assert.equal(parsed.status, "running");
  assert.equal(parsed.phase, "step-2");
  assert.equal(parsed.step, 2);
  assert.equal(parsed.totalSteps, TOTAL_UPDATE_STEPS);
  assert.equal(parsed.branch, "main");
});

test("parseUpdateState rejects anything it cannot trust", () => {
  for (const bad of [null, undefined, 42, "running", [], {}, { status: "yes" }]) {
    assert.equal(parseUpdateState(bad), null);
  }
});

test("parseUpdateState clamps numbers and strips control characters", () => {
  const parsed = parseUpdateState(
    state({ step: 99, totalSteps: 7, message: "Stopping\u0000 panel\u001b", exitCode: 1.7 })
  );
  assert.ok(parsed);
  assert.equal(parsed.step, 7, "step never exceeds the total");
  assert.equal(parsed.exitCode, 1);
  assert.ok(!parsed.message.includes("\u0000"));
  assert.ok(!parsed.message.includes("\u001b"));
});

test("parseUpdateState tolerates missing optional fields", () => {
  const parsed = parseUpdateState({ status: "success" });
  assert.ok(parsed);
  assert.equal(parsed.step, 0);
  assert.equal(parsed.totalSteps, TOTAL_UPDATE_STEPS);
  assert.equal(parsed.startedAt, null);
  assert.equal(parsed.branch, null);
  assert.equal(parsed.phase, "unknown");
});

test("parseUpdateState drops timestamps that are not dates", () => {
  const parsed = parseUpdateState(state({ updatedAt: "not a date", startedAt: 12 }));
  assert.ok(parsed);
  assert.equal(parsed.updatedAt, null);
  assert.equal(parsed.startedAt, null);
});

// ── running / stale / progress ───────────────────────────────────────────────

test("a recent running state counts as running", () => {
  const parsed = parseUpdateState(state());
  assert.equal(updateIsRunning(parsed, NOW), true);
});

test("a running state that went quiet is stale, not running", () => {
  const parsed = parseUpdateState(state({ updatedAt: "2026-11-06T09:00:00Z" }));
  assert.equal(updateIsRunning(parsed, NOW), false);
  assert.equal(updateIsRunning(parsed, NOW + UPDATE_STALE_MS), false);
});

test("finished states are never running", () => {
  for (const status of ["success", "failed"] as const) {
    const parsed = parseUpdateState(state({ status, finishedAt: "2026-11-06T09:59:00Z" }));
    assert.equal(updateIsRunning(parsed, NOW), false);
  }
  assert.equal(updateIsRunning(null, NOW), false);
});

test("a running state with no timestamp is assumed live, not restarted", () => {
  // Starting a second updater on top of a live one is the worse failure.
  const parsed = parseUpdateState(state({ updatedAt: null, startedAt: null }));
  assert.equal(updateIsRunning(parsed, NOW), true);
});

test("progress tracks the step count and completes only on success", () => {
  assert.equal(updateProgress(null), 0);
  assert.equal(updateProgress(parseUpdateState(state({ step: 0 }))), 0);
  assert.equal(updateProgress(parseUpdateState(state({ step: 7, totalSteps: 7 }))), 100);
  const half = updateProgress(parseUpdateState(state({ step: 3, totalSteps: 6 })));
  assert.equal(half, 50);
  const failed = parseUpdateState(state({ status: "failed", step: 7, totalSteps: 7 }));
  assert.equal(updateProgress(failed), 100);
});

// ── summary ─────────────────────────────────────────────────────────────────

test("summary explains what happened in each state", () => {
  assert.equal(updateSummary(null, NOW).tone, "none");
  assert.equal(updateSummary(parseUpdateState(state()), NOW).tone, "running");
  assert.equal(
    updateSummary(parseUpdateState(state({ status: "success", step: 7, finishedAt: "2026-11-06T09:59:00Z", toCommit: "def5678" })), NOW).tone,
    "ok"
  );
  assert.equal(
    updateSummary(parseUpdateState(state({ status: "failed", error: "npm ci failed" })), NOW).tone,
    "failed"
  );
  assert.equal(
    updateSummary(parseUpdateState(state({ updatedAt: "2026-11-06T09:00:00Z" })), NOW).tone,
    "stale"
  );
});

test("a successful summary names both commits when it knows them", () => {
  const summary = updateSummary(
    parseUpdateState(
      state({
        status: "success",
        step: 7,
        startedAt: "2026-11-06T09:50:00Z",
        finishedAt: "2026-11-06T09:54:00Z",
        toCommit: "def5678",
      })
    ),
    NOW
  );
  assert.match(summary.detail, /abc1234 → def5678/);
  assert.match(summary.detail, /4m 00s/);
});

test("a failed summary never hides the error", () => {
  const summary = updateSummary(
    parseUpdateState(state({ status: "failed", error: "npm ci failed", exitCode: 1 })),
    NOW
  );
  assert.match(summary.detail, /npm ci failed/);
  assert.match(summary.detail, /exit code 1/);
});

// ── time helpers ────────────────────────────────────────────────────────────

test("formatWhen is human, never a raw timestamp", () => {
  assert.equal(formatWhen("2026-11-06T09:59:50Z", NOW), "just now");
  assert.equal(formatWhen("2026-11-06T09:50:00Z", NOW), "10 minutes ago");
  assert.equal(formatWhen("2026-11-06T06:00:00Z", NOW), "4 hours ago");
  assert.equal(formatWhen(null, NOW), "an unknown time");
  assert.equal(formatWhen("nonsense", NOW), "an unknown time");
});

test("formatDuration handles minutes and seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(80_000), "1m 20s");
  assert.equal(formatDuration(-1), "—");
});

// ── command construction ────────────────────────────────────────────────────

test("shellQuote survives single quotes and spaces", () => {
  assert.equal(shellQuote("plain"), "'plain'");
  assert.equal(shellQuote("with space"), "'with space'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("as root, the panel runs the updater directly with fixed flags", () => {
  const root = selfUpdateCommand({ isRoot: true, updaterPath: "/opt/gsm-panel/public/update.sh" });
  assert.equal(root.file, "/bin/bash");
  assert.deepEqual(root.args, ["/opt/gsm-panel/public/update.sh", "--force"]);

  const noBackup = selfUpdateCommand({
    isRoot: true,
    updaterPath: "/opt/gsm-panel/public/update.sh",
    noBackup: true,
  });
  assert.deepEqual(noBackup.args, ["/opt/gsm-panel/public/update.sh", "--force", "--no-backup"]);
});

test("as the panel user, only the sudo wrapper is used", () => {
  const cmd = selfUpdateCommand({ isRoot: false, updaterPath: "/opt/gsm-panel/public/update.sh" });
  assert.equal(cmd.file, "sudo");
  assert.deepEqual(cmd.args, ["-n", DEFAULT_SELF_UPDATE_WRAPPER]);
  assert.ok(!cmd.args.some((arg) => arg.includes("update.sh")), "never sudo the script itself");
});

test("the panel can never pass an operator-chosen path or branch", () => {
  // Whatever the request body contains, the command is one of these two.
  const commands = [false, true].flatMap((noBackup) => [
    selfUpdateCommand({ isRoot: true, updaterPath: "/opt/gsm-panel/public/update.sh", noBackup }),
    selfUpdateCommand({ isRoot: false, updaterPath: "/opt/gsm-panel/public/update.sh", noBackup }),
  ]);
  for (const cmd of commands) {
    const joined = [cmd.file, ...cmd.args].join(" ");
    assert.ok(!joined.includes("--install-dir"), joined);
    assert.ok(!joined.includes("--branch"), joined);
    assert.ok(!joined.includes("--rollback"), joined);
    assert.ok(!/[;&|`$]/.test(joined), joined);
  }
});

test("the detached command detaches from the panel and logs where we can read it", () => {
  const plan = detachedUpdateCommand(
    { file: "sudo", args: ["-n", "/usr/local/bin/gsm-self-update"] },
    "/var/lib/gsm-panel-update/spawn.log"
  );
  assert.equal(plan.file, "/bin/bash");
  assert.equal(plan.args[0], "-c");
  const line = plan.args[1];
  assert.match(line, /^setsid nohup /);
  assert.match(line, /'\/usr\/local\/bin\/gsm-self-update'/);
  assert.match(line, /'\/var\/lib\/gsm-panel-update\/spawn\.log'/);
  assert.match(line, /< \/dev\/null &$/);
  // Truncate the spawn log: it describes one attempt only.
  assert.match(line, /> /);
  assert.ok(!line.includes(">>"), line);
});

// ── availability ────────────────────────────────────────────────────────────

test("availability explains every way the button can be unusable", () => {
  const base = { updaterPresent: true, isRoot: false, wrapperPresent: true, sudoAllowed: true };
  assert.deepEqual(updateAvailability({ ...base, isRoot: true }), { canUpdate: true, reason: null });
  assert.deepEqual(updateAvailability(base), { canUpdate: true, reason: null });

  const missingUpdater = updateAvailability({ ...base, updaterPresent: false });
  assert.equal(missingUpdater.canUpdate, false);
  assert.match(missingUpdater.reason ?? "", /update\.sh/);

  const noWrapper = updateAvailability({ ...base, wrapperPresent: false, sudoAllowed: false });
  assert.equal(noWrapper.canUpdate, false);
  assert.match(noWrapper.reason ?? "", /sudo bash public\/update\.sh/);

  const noSudo = updateAvailability({ ...base, sudoAllowed: false });
  assert.equal(noSudo.canUpdate, false);
  assert.match(noSudo.reason ?? "", /sudo rule/);
});

// ── install info and launch failures ────────────────────────────────────────

test("install info is parsed as data, never executed", () => {
  const info = readInstallInfo(
    ["PANEL_VERSION=abc1234", "LAST_UPDATE=2026-11-06 09:54:00 UTC", "PANEL_PORT=3000", "$(rm -rf /)"].join("\n")
  );
  assert.deepEqual(info, {
    version: "abc1234",
    lastUpdate: "2026-11-06 09:54:00 UTC",
    port: "3000",
  });
  assert.deepEqual(readInstallInfo(null), { version: null, lastUpdate: null, port: null });
});

test("a launch failure becomes an honest failed state", () => {
  const failed = stateFromLaunchFailure(
    "━━━━━━━━━━━━━━━━━━━━━━━━\nsudo: a password is required\n"
  );
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.equal(failed.phase, "launch");
  assert.equal(failed.error, "sudo: a password is required");
  assert.equal(stateFromLaunchFailure("   \n\n"), null);
});

test("lastMeaningfulLine skips decorative rules", () => {
  assert.equal(lastMeaningfulLine("one\ntwo\n━━━━━━\n"), "two");
  assert.equal(lastMeaningfulLine(""), "");
});

test("the state path is the one the updater writes", () => {
  assert.equal(DEFAULT_UPDATE_STATE_PATH, "/var/lib/gsm-panel-update/state.json");
});
