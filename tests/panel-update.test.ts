import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SELF_UPDATE_WRAPPER,
  DEFAULT_UPDATE_LAUNCH_DIR,
  DEFAULT_UPDATE_STATE_PATH,
  TOTAL_UPDATE_STEPS,
  UPDATE_LAUNCH_GRACE_MS,
  UPDATE_SILENT_LAUNCH_ERROR,
  UPDATE_STALE_MS,
  detachedUpdateCommand,
  formatDuration,
  formatWhen,
  launchFailureReason,
  launchFailureState,
  launchStartingState,
  parseUpdateLaunch,
  parseUpdateState,
  readInstallInfo,
  resolveUpdateStatus,
  selfUpdateCommand,
  shellQuote,
  stateIsFromLaunch,
  updateAvailability,
  updateIsRunning,
  updateProgress,
  updateStepLabel,
  updateSummary,
  type UpdateLaunch,
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

test("the detached command detaches from the panel and reports what it started", () => {
  const plan = detachedUpdateCommand({ file: "sudo", args: ["-n", "/usr/local/bin/gsm-self-update"] });
  assert.equal(plan.file, "/bin/bash");
  assert.equal(plan.args[0], "-c");
  const line = plan.args[1];
  assert.equal(
    line,
    `setsid nohup 'sudo' '-n' '/usr/local/bin/gsm-self-update' < /dev/null 3>&- & echo "$!" >&3`
  );
});

test("the detached command never redirects its output to a file", () => {
  // A shell opens a redirect target before it runs the command, and a target
  // it cannot open means the command is never run — while the shell that
  // backgrounded it still exits 0. The first version of the button wrote
  // `> /var/lib/gsm-panel-update/spawn.log` here: root's directory, which the
  // panel's user cannot write, so the button started nothing and said it had.
  for (const noBackup of [false, true]) {
    for (const isRoot of [false, true]) {
      const line = detachedUpdateCommand(
        selfUpdateCommand({ isRoot, updaterPath: "/opt/gsm-panel/public/update.sh", noBackup })
      ).args[1];
      assert.match(line, / echo "\$!" >&3$/, "the process id is reported on descriptor 3");
      // `3>&-` and `>&3` only close or duplicate a descriptor that is already
      // open. Any other `>` would name a file.
      assert.ok(!/>(?!&)/.test(line), `no output redirect to a file in: ${line}`);
      assert.ok(!line.includes("/var/lib/gsm-panel-update"), line);
    }
  }
});

test("the launch log lives where the panel's user can write, not in root's state directory", () => {
  assert.equal(DEFAULT_UPDATE_LAUNCH_DIR, "/var/log/gsm-panel");
  assert.ok(!DEFAULT_UPDATE_LAUNCH_DIR.startsWith("/var/lib/gsm-panel-update"));
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

test("a launch failure is explained in the updater's own words", () => {
  // What the updater prints when a tracked file was edited on the server: the
  // problem, the detail, then the advice. The advice alone explains nothing.
  const localChanges = [
    "[GSM] Checking for updates...",
    "[✗] Local tracked code changes would be overwritten:",
    " M README.md",
    "[✗] Commit or back up those changes, then run the updater again.",
    "",
  ].join("\n");
  assert.equal(
    launchFailureReason(localChanges),
    "Local tracked code changes would be overwritten: Commit or back up those changes, then run the updater again."
  );

  assert.equal(
    launchFailureReason(
      "[!] Fetching origin/main failed — checking the configured remote...\n[✗] Cannot fetch origin/main. Check the branch and your internet connection, then try again.\n"
    ),
    "Cannot fetch origin/main. Check the branch and your internet connection, then try again."
  );

  // Output that is not the updater's has no marks: the last line is the message.
  assert.equal(launchFailureReason("sudo: a password is required\n"), "sudo: a password is required");
  assert.equal(
    launchFailureReason("gsm-self-update: refusing unknown argument: --branch\n"),
    "gsm-self-update: refusing unknown argument: --branch"
  );
  // …without the updater's own prefix when it is one of its ordinary lines.
  assert.equal(launchFailureReason("[GSM] Checking for updates...\n━━━━━━\n"), "Checking for updates...");
  assert.equal(launchFailureReason("[!] Could not create /var/lib/gsm-panel-update\n"), "Could not create /var/lib/gsm-panel-update");

  // Rules and box edges from the updater's banner are decoration, not a reason.
  assert.equal(launchFailureReason("one\ntwo\n━━━━━━\n"), "two");
  assert.equal(launchFailureReason("why\n╚══════════════╝\n"), "why");
  assert.equal(launchFailureReason(""), "");
  assert.equal(launchFailureReason("\n ━━━ \n"), "");
  assert.equal(launchFailureReason(`[✗] ${"x".repeat(500)}`).length, 300);
  // A long run of errors is cut to the last few, which are the ones that stopped it.
  assert.equal(launchFailureReason("[✗] one\n[✗] two\n[✗] three\n[✗] four\n"), "two three four");
});

// ── the panel's own launch record ───────────────────────────────────────────

const LAUNCHED_AT = "2026-11-06T09:59:40.250Z";

function launch(overrides: Partial<UpdateLaunch> = {}): UpdateLaunch {
  return {
    launchedAt: LAUNCHED_AT,
    pid: 4321,
    startTime: "987654",
    noBackup: false,
    logged: true,
    error: null,
    ...overrides,
  };
}

/** A state the updater published, as the route would have parsed it. */
function published(overrides: Record<string, unknown> = {}) {
  const parsed = parseUpdateState(state(overrides));
  assert.ok(parsed);
  return parsed;
}

const PREVIOUS_SUCCESS = {
  status: "success",
  phase: "done",
  step: 7,
  startedAt: "2026-11-01T08:00:00Z",
  updatedAt: "2026-11-01T08:03:00Z",
  finishedAt: "2026-11-01T08:03:00Z",
  toCommit: "def5678",
};

test("parseUpdateLaunch accepts what the panel writes", () => {
  assert.deepEqual(parseUpdateLaunch(JSON.parse(JSON.stringify(launch()))), launch());
});

test("parseUpdateLaunch rejects a record it cannot trust", () => {
  for (const bad of [null, undefined, 42, "x", [], {}, { launchedAt: "soon" }, { pid: 12 }]) {
    assert.equal(parseUpdateLaunch(bad), null);
  }
});

test("parseUpdateLaunch never yields a process id that means something else to kill(2)", () => {
  for (const pid of [0, 1, -1, -4321, 1.5, 4_194_305, "4321", null]) {
    const parsed = parseUpdateLaunch({ ...launch(), pid });
    assert.ok(parsed);
    assert.equal(parsed.pid, null, `pid ${String(pid)}`);
  }
  assert.equal(parseUpdateLaunch({ ...launch(), startTime: "12; rm -rf /" })?.startTime, null);
  assert.equal(parseUpdateLaunch({ ...launch(), logged: "yes" })?.logged, false);
});

test("a state belongs to a launch when the updater wrote it afterwards", () => {
  const at = (startedAt: string | null, updatedAt: string | null = startedAt) =>
    stateIsFromLaunch(published({ startedAt, updatedAt }), launch());

  assert.equal(at("2026-11-06T09:59:41Z"), true, "the second after the launch");
  assert.equal(at("2026-11-06T09:59:55Z", "2026-11-06T09:59:58Z"), true);
  // Started before the launch by the clock, but still reporting after it.
  assert.equal(at("2026-11-06T09:59:30Z", "2026-11-06T09:59:45Z"), true);

  assert.equal(stateIsFromLaunch(published(PREVIOUS_SUCCESS), launch()), false);
  assert.equal(at("2026-11-06T09:59:39Z"), false, "the second before the launch");
  assert.equal(stateIsFromLaunch(null, launch()), false);
  assert.equal(at(null), false);
});

test("a stamp in the launch's own second proves nothing", () => {
  // The updater stamps whole seconds, so 09:59:40Z covers both 09:59:40.100 —
  // the previous run finishing — and 09:59:40.900, after this launch at .250.
  assert.equal(
    stateIsFromLaunch(published({ startedAt: "2026-11-06T09:59:40Z", updatedAt: "2026-11-06T09:59:40Z" }), launch()),
    false
  );
  // Launched exactly on the second, nothing earlier can carry that stamp.
  assert.equal(
    stateIsFromLaunch(
      published({ startedAt: "2026-11-06T09:59:40Z", updatedAt: "2026-11-06T09:59:40Z" }),
      launch({ launchedAt: "2026-11-06T09:59:40.000Z" })
    ),
    true
  );

  // The dangerous reading: the previous run failed at 09:59:40, a retry is
  // launched in the same second and is still starting. Taking the old failure
  // for the retry's would report "not running" and let a third click start a
  // second updater beside it.
  const previousFailure = published({
    status: "failed",
    phase: "step-3",
    step: 3,
    startedAt: "2026-11-06T09:59:38Z",
    updatedAt: "2026-11-06T09:59:40Z",
    finishedAt: "2026-11-06T09:59:40Z",
    exitCode: 1,
  });
  const retry = resolveUpdateStatus({
    stored: previousFailure,
    launch: launch(),
    launchAlive: true,
    updaterLog: "the failed run",
    launchLog: "",
    nowMs: Date.parse(LAUNCHED_AT) + 400,
  });
  assert.equal(retry.source, "launch");
  assert.equal(retry.state?.phase, "starting");
  assert.equal(updateIsRunning(retry.state, Date.parse(LAUNCHED_AT) + 400), true);
});

test("a run that publishes within its first second is still shown while it runs", () => {
  // Not provably this launch's yet — but it is running, and that is enough.
  const first = published({ startedAt: "2026-11-06T09:59:40Z", updatedAt: "2026-11-06T09:59:40Z" });
  const base = {
    stored: first,
    launch: launch(),
    launchAlive: true,
    launchLog: "[GSM] Checking for updates...\n",
    nowMs: Date.parse(LAUNCHED_AT) + 600,
  };
  const resolved = resolveUpdateStatus({
    ...base,
    updaterLog: "━━━ Step 1/7: Backing up current installation ━━━\n",
  });
  assert.equal(resolved.source, "updater");
  assert.equal(resolved.state, first);
  assert.equal(resolved.logTail, "━━━ Step 1/7: Backing up current installation ━━━\n");

  // Its own log is still empty at that point: what it printed while starting
  // is shown rather than an empty box — the request is answered right here,
  // and this is what stays on screen while the panel restarts.
  assert.equal(resolveUpdateStatus({ ...base, updaterLog: "" }).logTail, "[GSM] Checking for updates...\n");
});

test("a run started some other way never borrows a launch's output", () => {
  // Running, but stamped before the launch: a run from a shell that a failed
  // click happened to land on. The launch log describes the click, not the run.
  const shellRun = published({ startedAt: "2026-11-06T09:58:00Z", updatedAt: "2026-11-06T09:59:30Z" });
  const resolved = resolveUpdateStatus({
    stored: shellRun,
    launch: launch(),
    launchAlive: false,
    updaterLog: "",
    launchLog: "sudo: a password is required\n",
    nowMs: NOW,
  });
  assert.equal(resolved.state, shellRun);
  assert.equal(resolved.logTail, "");
});

test("without a launch record the updater's state is shown as it is", () => {
  const stored = published(PREVIOUS_SUCCESS);
  const resolved = resolveUpdateStatus({
    stored,
    launch: null,
    launchAlive: null,
    updaterLog: "previous run",
    launchLog: "",
    nowMs: NOW,
  });
  assert.deepEqual(resolved, { state: stored, logTail: "previous run", source: "updater" });
  assert.equal(
    resolveUpdateStatus({ stored: null, launch: null, launchAlive: null, updaterLog: "", launchLog: "", nowMs: NOW }).state,
    null
  );
});

test("a fresh launch shows as starting until the updater publishes its first step", () => {
  // The previous run's success and log are still on disk; neither may be shown
  // as if it described this attempt.
  const resolved = resolveUpdateStatus({
    stored: published(PREVIOUS_SUCCESS),
    launch: launch(),
    launchAlive: true,
    updaterLog: "previous run",
    launchLog: "[GSM] Checking for updates...\n",
    nowMs: NOW,
  });
  assert.equal(resolved.source, "launch");
  assert.equal(resolved.state?.status, "running");
  assert.equal(resolved.state?.phase, "starting");
  assert.equal(resolved.state?.startedAt, LAUNCHED_AT);
  assert.equal(resolved.logTail, "[GSM] Checking for updates...\n");
  assert.equal(updateIsRunning(resolved.state, NOW), true, "a second click is refused");

  const summary = updateSummary(resolved.state, NOW);
  assert.equal(summary.tone, "running");
  assert.equal(summary.title, "Starting the update…");
  // No step has been reported, so none is claimed: "Step 0/7" reads as stuck.
  assert.ok(!/step 0/i.test(summary.detail), summary.detail);
  assert.match(summary.detail, /^Fetching the latest code and checking the installation\. /);
});

test("a step is only numbered once the updater has reported one", () => {
  const preflight = published({ phase: "preflight", step: 0, message: "Checking the installation" });
  assert.equal(updateStepLabel(preflight), "Checking the installation");
  assert.equal(updateStepLabel(published()), "Step 2/7: Stopping panel");
  assert.equal(updateStepLabel(published({ message: "" })), "Step 2/7: step-2");
  assert.match(updateSummary(published(), NOW).detail, /^Step 2\/7: Stopping panel\. /);
});

test("a launch that ended before the first step is a failure, with what it printed", () => {
  for (const stored of [null, published(PREVIOUS_SUCCESS)]) {
    const resolved = resolveUpdateStatus({
      stored,
      launch: launch(),
      launchAlive: false,
      updaterLog: stored ? "previous run" : "",
      launchLog: "sudo: a password is required\n",
      nowMs: NOW,
    });
    assert.equal(resolved.source, "launch");
    assert.equal(resolved.state?.status, "failed");
    assert.equal(resolved.state?.phase, "launch");
    assert.equal(resolved.state?.error, "sudo: a password is required");
    assert.equal(resolved.logTail, "sudo: a password is required\n");
    assert.equal(updateIsRunning(resolved.state, NOW), false, "the button is usable again");

    const summary = updateSummary(resolved.state, NOW);
    assert.equal(summary.tone, "failed");
    assert.equal(summary.title, "The update did not start");
    assert.match(summary.detail, /sudo: a password is required/);
  }
});

test("a launch that printed nothing still fails out loud", () => {
  const failed = launchFailureState(launch({ logged: false }), "   \n\n");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, UPDATE_SILENT_LAUNCH_ERROR);
  // The panel's own reason wins over whatever happens to be in the log.
  assert.equal(
    launchFailureState(launch({ error: "The panel could not run the update launcher." }), "noise").error,
    "The panel could not run the update launcher."
  );
});

test("a launcher that could not be run is a failure whatever the process probe says", () => {
  const resolved = resolveUpdateStatus({
    stored: null,
    launch: launch({ pid: null, startTime: null, error: "The panel could not run the update launcher." }),
    launchAlive: null,
    updaterLog: "",
    launchLog: "",
    nowMs: NOW,
  });
  assert.equal(resolved.state?.status, "failed");
  assert.equal(resolved.state?.phase, "launch");
});

test("once the updater publishes, its state is the authority", () => {
  const stored = published({ startedAt: "2026-11-06T09:59:41Z", updatedAt: "2026-11-06T09:59:55Z" });
  for (const launchAlive of [true, false, null]) {
    const resolved = resolveUpdateStatus({
      stored,
      launch: launch(),
      launchAlive,
      updaterLog: "━━━ Step 2/7: Stopping panel ━━━\n",
      launchLog: "[GSM] Checking for updates...\n━━━ Step 2/7: Stopping panel ━━━\n",
      nowMs: NOW,
    });
    assert.deepEqual(resolved, {
      state: stored,
      logTail: "━━━ Step 2/7: Stopping panel ━━━\n",
      source: "updater",
    });
  }
});

test("the launch output stands in when the updater's own log cannot be read", () => {
  const current = published({ startedAt: "2026-11-06T09:59:41Z", updatedAt: "2026-11-06T09:59:55Z" });
  const base = { launch: launch(), launchAlive: true, updaterLog: "  ", launchLog: "this run\n", nowMs: NOW };
  assert.equal(resolveUpdateStatus({ ...base, stored: current }).logTail, "this run\n");
  // …but never for a run this launch did not start.
  assert.equal(resolveUpdateStatus({ ...base, stored: null, launch: null }).logTail, "");
});

test("a failed launch never hides an update that is demonstrably running", () => {
  // Its timestamps predate the launch (a clock step, or a run started from a
  // shell), but it reported seconds ago. Calling that "not running" is how a
  // second updater gets started on top of the first.
  const live = published({ startedAt: "2026-11-06T09:58:00Z", updatedAt: "2026-11-06T09:59:30Z" });
  const resolved = resolveUpdateStatus({
    stored: live,
    launch: launch(),
    launchAlive: false,
    updaterLog: "live run",
    launchLog: "sudo: a password is required\n",
    nowMs: NOW,
  });
  assert.equal(resolved.state, live);
  assert.equal(resolved.source, "updater");
  assert.equal(resolved.logTail, "live run");
});

test("a later run from a shell replaces an old failed launch", () => {
  const shellRun = published({
    status: "success",
    phase: "done",
    step: 7,
    startedAt: "2026-11-06T09:59:50Z",
    updatedAt: "2026-11-06T09:59:59Z",
    finishedAt: "2026-11-06T09:59:59Z",
  });
  const resolved = resolveUpdateStatus({
    stored: shellRun,
    launch: launch(),
    launchAlive: false,
    updaterLog: "shell run",
    launchLog: "sudo: a password is required\n",
    nowMs: NOW,
  });
  assert.equal(resolved.state, shellRun);
  assert.equal(resolved.logTail, "shell run");
});

test("when the process cannot be checked, a launch gets a grace period and no more", () => {
  const unknown = launch({ pid: null, startTime: null });
  const base = { stored: null, launch: unknown, launchAlive: null, updaterLog: "", launchLog: "", nowMs: 0 };
  const launchedMs = Date.parse(LAUNCHED_AT);

  const early = resolveUpdateStatus({ ...base, nowMs: launchedMs + 5_000 });
  assert.equal(early.state?.phase, "starting");

  const late = resolveUpdateStatus({ ...base, nowMs: launchedMs + UPDATE_LAUNCH_GRACE_MS + 1 });
  assert.equal(late.state?.status, "failed");
  assert.equal(late.state?.phase, "launch");
  assert.equal(late.state?.error, UPDATE_SILENT_LAUNCH_ERROR);
});

test("a launch that hangs before its first step goes stale like any other run", () => {
  const starting = launchStartingState(launch());
  const launchedMs = Date.parse(LAUNCHED_AT);
  assert.equal(updateIsRunning(starting, launchedMs + UPDATE_STALE_MS), true);
  assert.equal(updateIsRunning(starting, launchedMs + UPDATE_STALE_MS + 1), false);
  assert.equal(updateSummary(starting, launchedMs + UPDATE_STALE_MS + 1).tone, "stale");
});

test("the state path is the one the updater writes", () => {
  assert.equal(DEFAULT_UPDATE_STATE_PATH, "/var/lib/gsm-panel-update/state.json");
});
