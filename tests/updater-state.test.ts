import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readFile as readFileAsync, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The updater publishes its progress as JSON that the panel parses strictly:
 * a stray quote or newline in a step label would make the button show "no
 * update has been run" during a real update. These tests extract the state
 * functions from public/update.sh and run them for real.
 */

async function loadStateFunctions(): Promise<string> {
  const updater = await readFile(new URL("../public/update.sh", import.meta.url), "utf8");

  const escape = /json_escape\(\) \{\n[\s\S]*?\n\}\n/.exec(updater);
  assert.ok(escape, "json_escape must exist in update.sh");

  const start = updater.indexOf("state_write() {");
  const end = updater.indexOf("#  The helper that lets the panel update itself");
  assert.ok(start > 0 && end > start, "state functions must exist in update.sh");

  return `${escape[0]}\n${updater.slice(start, end)}`;
}

/** The updater's real EXIT trap, as one line of shell. */
async function loadExitTrap(): Promise<string> {
  const updater = await readFile(new URL("../public/update.sh", import.meta.url), "utf8");
  const trap = /^trap '[^'\n]*' EXIT$/m.exec(updater);
  assert.ok(trap, "the EXIT trap must exist in update.sh");
  return trap[0];
}

async function runStateScript(
  body: string,
  inspect?: (dir: string) => void
): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), "gsm-update-state-"));
  const statePath = join(dir, "state.json");
  const functions = await loadStateFunctions();

  const script = [
    "set -euo pipefail",
    `STATE_FILE=${JSON.stringify(statePath)}`,
    `STABLE_LOG=${JSON.stringify(join(dir, "update.log"))}`,
    "GSM_USER=gsm",
    "BRANCH=main",
    "CURRENT_COMMIT=abc1234",
    "NEW_COMMIT=",
    "TOTAL_STEPS=7",
    'STATE_STATUS="running"',
    'STATE_PHASE="preflight"',
    'STATE_MESSAGE="Starting"',
    "STATE_STEP=0",
    'STATE_STARTED=""',
    'STATE_FINISHED_AT=""',
    'STATE_EXIT_CODE=""',
    'STATE_ERROR=""',
    "STATE_DONE=false",
    functions,
    body,
  ].join("\n");

  try {
    // A failing run exits non-zero by design; the state file is the result.
    await execFileAsync("/bin/bash", ["-c", script], { timeout: 10_000 }).catch(() => null);
    const raw = await readFileAsync(statePath, "utf8");
    inspect?.(dir);
    return JSON.parse(raw) as Record<string, unknown>;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the updater writes state the panel can parse, even with quotes and newlines", async () => {
  const state = await runStateScript(
    [
      "STATE_PHASE=step-3",
      "STATE_STEP=3",
      "STATE_MESSAGE='Pulling \"main\" \\ code'",
      "STATE_STARTED=2026-11-06T09:58:00Z",
      "state_write",
    ].join("\n")
  );

  assert.equal(state.status, "running");
  assert.equal(state.phase, "step-3");
  assert.equal(state.step, 3);
  assert.equal(state.totalSteps, 7);
  assert.equal(state.message, 'Pulling "main" \\ code');
  assert.equal(state.branch, "main");
  assert.equal(state.fromCommit, "abc1234");
  assert.equal(state.finishedAt, null);
  assert.equal(state.exitCode, null);
  assert.match(String(state.updatedAt), /^\d{4}-\d{2}-\d{2}T/);
});

test("a failed exit publishes a failed state with an explanation", async () => {
  const state = await runStateScript(
    ["state_begin", "STATE_PHASE=step-4", "STATE_STEP=4", "false || state_finish"].join("\n")
  );

  assert.equal(state.status, "failed");
  assert.equal(state.exitCode, 1);
  assert.equal(state.message, "Update failed");
  assert.match(String(state.error), /step 4\/7/);
  assert.ok(state.finishedAt, "a failed run is timestamped");
});

test("a healthy run publishes success even without an explicit message", async () => {
  const state = await runStateScript(
    ["state_begin", "STATE_STEP=7", "PANEL_OK=true", "true", "state_finish"].join("\n")
  );

  assert.equal(state.status, "success");
  assert.equal(state.phase, "done");
  assert.equal(state.step, 7);
  assert.equal(state.exitCode, 0);
  assert.match(String(state.message), /complete/i);
});

test("state_finish does nothing before an update starts", async () => {
  // A bad flag or a rollback exits before state_begin; it must not leave a
  // "running" state behind that the panel would show forever.
  const state = await runStateScript(["false || state_finish", "state_write"].join("\n"));
  assert.equal(state.status, "running");
  assert.equal(state.finishedAt, null);
  assert.equal(state.error, "");
});

// The trap tidies up before it records the outcome, and `$?` after a successful
// `rm` is 0. Read there, every failed update was published with exit code 0 —
// so the panel said "exit code 0" about a run that had just failed.
for (const exit of [
  { how: "an explicit exit", line: "exit 3", code: 3 },
  { how: "a command failing under set -e", line: "/bin/bash -c 'exit 42'", code: 42 },
]) {
  test(`the EXIT trap publishes the real exit code after ${exit.how}`, async () => {
    const trap = await loadExitTrap();
    const state = await runStateScript(
      [
        'WORK_DIR="$(dirname "$STATE_FILE")/work"',
        'mkdir -p "$WORK_DIR"',
        'DRIZZLE_UPDATE_CONFIG="$(dirname "$STATE_FILE")/drizzle.update.json"',
        ': > "$DRIZZLE_UPDATE_CONFIG"',
        trap,
        "state_begin",
        "STATE_PHASE=step-5",
        "STATE_STEP=5",
        exit.line,
        "echo 'not reached'",
      ].join("\n"),
      (dir) => {
        // Recording the code first must not cost the cleanup.
        assert.equal(existsSync(join(dir, "work")), false, "the scratch directory is removed");
        assert.equal(existsSync(join(dir, "drizzle.update.json")), false, "the drizzle config is removed");
      }
    );

    assert.equal(state.status, "failed");
    assert.equal(state.exitCode, exit.code);
    assert.equal(state.error, `The updater stopped on step 5/7 (step-5), exit code ${exit.code}.`);
  });
}

test("the EXIT trap publishes success for a run that ends cleanly", async () => {
  const trap = await loadExitTrap();
  const state = await runStateScript(
    [
      'WORK_DIR="$(dirname "$STATE_FILE")/work"',
      'DRIZZLE_UPDATE_CONFIG="$(dirname "$STATE_FILE")/drizzle.update.json"',
      trap,
      "state_begin",
      "STATE_STEP=7",
      "PANEL_OK=true",
    ].join("\n")
  );

  assert.equal(state.status, "success");
  assert.equal(state.exitCode, 0);
  assert.equal(state.error, "");
});
