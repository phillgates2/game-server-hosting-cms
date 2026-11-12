import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UPDATE_LAUNCH_LOG_NAME,
  UPDATE_LAUNCH_RECORD_NAME,
  parseUpdateState,
  resolveUpdateStatus,
  updateIsRunning,
} from "../src/lib/panel-update";
import {
  findLaunchDir,
  launchDetached,
  launchLogPath,
  launchRecordPath,
  openLaunchLog,
  plainOutput,
  processIsAlive,
  processStartTime,
  readLaunchAccount,
  readUpdateLaunch,
  readUpdateLogTail,
  startDetachedUpdate,
  updateLaunchDirCandidates,
  updatePaths,
  waitForLaunchToSettle,
} from "../src/lib/panel-update-fs";

/**
 * The update button starts a process and then loses sight of it on purpose, so
 * the launch is tested by doing it: a real detached process, a real log, a real
 * record — with a harmless command standing in for `sudo gsm-self-update`.
 *
 * The bug these exist for: the launch line used to redirect its output into the
 * updater's state directory. That directory is root's. The panel's user could
 * not create the file, a shell does not run a command whose redirect failed,
 * and the request still answered "started". Nothing in the launch may depend on
 * a file again.
 */

function hasTool(name: string): boolean {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_LAUNCH =
  process.platform !== "win32" && existsSync("/bin/bash") && hasTool("setsid") && hasTool("nohup");
const launchTest = { skip: CAN_LAUNCH ? false : "needs /bin/bash, setsid and nohup" };
const HAS_PROC = existsSync("/proc/self/stat");

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`condition not met within ${timeoutMs}ms`);
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "gsm-launch-test-"));
}

/** A directory that cannot exist for anyone, root included: its parent is a file. */
async function impossibleDir(root: string): Promise<string> {
  const file = join(root, "not-a-directory");
  await writeFile(file, "");
  return join(file, "logs");
}

function parentOf(pid: number): number {
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(raw.slice(raw.lastIndexOf(")") + 2).split(" ")[1]);
}

const sh = (script: string) => ({ file: "/bin/sh", args: ["-c", script] });

// This test must stay first: it needs the process to have no private fallback
// directory yet, which the later tests create.
test("the updater starts even when there is nowhere at all to keep its output", launchTest, async () => {
  const root = await scratch();
  const nowhere = await impossibleDir(root);
  const marker = join(root, "ran");
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = join(nowhere, "tmp");
  try {
    const started = await startDetachedUpdate({
      command: sh(`echo ran > '${marker}'`),
      cwd: root,
      env: process.env,
      noBackup: false,
      candidates: [nowhere],
    });

    assert.equal(started.launcherError, null);
    assert.equal(started.launch.error, null);
    assert.equal(started.launch.logged, false, "there was nowhere to log");
    assert.ok(started.launch.pid, "the launcher reported the process it started");
    await until(() => existsSync(marker));
    assert.equal(await readFile(marker, "utf8"), "ran\n");

    // With no record on disk the launch is still known to this process, so a
    // second click in the next few seconds is refused rather than doubled.
    const account = await readLaunchAccount({ candidates: [nowhere] });
    assert.deepEqual(account.launch, started.launch);
    assert.equal(account.launchLog, "");
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    await rm(root, { recursive: true, force: true });
  }
});

test("the updater starts when the usual log directory cannot be written", launchTest, async () => {
  const root = await scratch();
  const unusable = await impossibleDir(root);
  const marker = join(root, "ran");
  let fallback: string | null = null;
  try {
    const started = await startDetachedUpdate({
      command: sh(`echo from the updater; echo ran > '${marker}'`),
      cwd: root,
      env: process.env,
      noBackup: false,
      candidates: [unusable],
    });
    await until(() => existsSync(marker));
    assert.equal(started.launch.error, null);

    // The output went to a private directory instead, and is still found.
    fallback = await findLaunchDir({ candidates: [unusable] });
    assert.ok(fallback, "a private directory took over");
    assert.ok(!fallback.startsWith(root));
    assert.equal((await stat(fallback)).mode & 0o077, 0, "private to the panel's user");
    assert.equal(started.launch.logged, true);

    await until(async () => (await readLaunchAccount({ candidates: [unusable] })).launchAlive === false);
    const account = await readLaunchAccount({ candidates: [unusable] });
    assert.deepEqual(account.launch, started.launch);
    assert.equal(account.launchLog, "from the updater\n");
  } finally {
    if (fallback) await rm(fallback, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("a launched updater is detached, logged and recorded", launchTest, async () => {
  const dir = await scratch();
  const marker = join(dir, "finished");
  try {
    const started = await startDetachedUpdate({
      command: sh(`echo to stdout; echo to stderr >&2; sleep 0.5; echo finished > '${marker}'`),
      cwd: dir,
      env: process.env,
      noBackup: true,
      candidates: [dir],
    });
    const { launch } = started;
    assert.equal(started.launcherError, null);
    assert.ok(launch.pid && launch.pid > 1);
    assert.equal(launch.noBackup, true);
    assert.equal(launch.logged, true);
    assert.ok(Math.abs(Date.parse(launch.launchedAt) - Date.now()) < 10_000);

    // Still working: this is what "starting" and the 409 on a second click rest on.
    assert.equal(await processIsAlive(launch.pid, launch.startTime), true);
    if (HAS_PROC) {
      assert.ok(launch.startTime, "the start time identifies the process");
      // PM2 stops the panel by killing its process tree. The updater must not
      // be in it — it stops the panel half-way through its own run.
      assert.notEqual(parentOf(launch.pid), process.pid, "reparented away from the launcher");
    }

    assert.deepEqual(await readUpdateLaunch(dir), launch, "the record survives a panel restart");
    assert.equal((await stat(launchRecordPath(dir))).mode & 0o007, 0, "not world-readable");
    assert.equal((await stat(launchLogPath(dir))).mode & 0o007, 0, "not world-readable");

    const during = await readLaunchAccount({ candidates: [dir] });
    assert.deepEqual(during.launch, launch);
    assert.equal(during.launchAlive, true);

    await until(async () => !(await processIsAlive(launch.pid as number, launch.startTime)));
    assert.equal(await readFile(marker, "utf8"), "finished\n", "it ran to the end on its own");

    const after = await readLaunchAccount({ candidates: [dir] });
    assert.equal(after.launchAlive, false);
    assert.equal(after.launchLog, "to stdout\nto stderr\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an updater that stops at once is reported as a failure with its reason", launchTest, async () => {
  const dir = await scratch();
  try {
    const { launch } = await startDetachedUpdate({
      command: sh("echo 'sudo: a password is required' >&2; exit 1"),
      cwd: dir,
      env: process.env,
      noBackup: false,
      candidates: [dir],
    });
    assert.equal(launch.error, null, "the launcher itself ran");

    const waitedFrom = Date.now();
    assert.equal(await waitForLaunchToSettle(launch, 5_000, { pollMs: 20 }), "gone");
    assert.ok(Date.now() - waitedFrom < 4_000, "returns as soon as the process is gone");

    const account = await readLaunchAccount({ candidates: [dir] });
    assert.equal(account.launchAlive, false);

    // The previous run's success is still in the state file. It must not be
    // what the operator is shown for this attempt.
    const previous = parseUpdateState({
      status: "success",
      phase: "done",
      step: 7,
      totalSteps: 7,
      startedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:02:00Z",
      finishedAt: "2026-01-01T00:02:00Z",
    });
    const resolved = resolveUpdateStatus({
      stored: previous,
      launch: account.launch,
      launchAlive: account.launchAlive,
      updaterLog: "output of the previous run",
      launchLog: account.launchLog,
      nowMs: Date.now(),
    });
    assert.equal(resolved.state?.status, "failed");
    assert.equal(resolved.state?.phase, "launch");
    assert.equal(resolved.state?.error, "sudo: a password is required");
    assert.equal(resolved.logTail, "sudo: a password is required\n");
    assert.equal(updateIsRunning(resolved.state, Date.now()), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a command that does not exist fails out loud instead of silently", launchTest, async () => {
  const dir = await scratch();
  try {
    const { launch } = await startDetachedUpdate({
      command: { file: "/no/such/gsm-self-update", args: [] },
      cwd: dir,
      env: process.env,
      noBackup: false,
      candidates: [dir],
    });
    await waitForLaunchToSettle(launch, 5_000, { pollMs: 20 });
    const account = await readLaunchAccount({ candidates: [dir] });
    assert.equal(account.launchAlive, false);
    assert.match(account.launchLog, /no\/such\/gsm-self-update/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("watching a launch ends the moment the updater reports its first step", launchTest, async () => {
  // A few steps after its first report the updater stops the panel — the very
  // process answering the request. Waiting out a fixed window would have the
  // request cut off, and the operator told "could not reach the server" about
  // an update that is running.
  const dir = await scratch();
  const reported = join(dir, "first-step");
  let pid: number | null = null;
  try {
    const { launch } = await startDetachedUpdate({
      command: sh(`sleep 0.3; : > '${reported}'; exec sleep 30`),
      cwd: dir,
      env: process.env,
      noBackup: false,
      candidates: [dir],
    });
    pid = launch.pid;
    assert.ok(pid);

    let probes = 0;
    const from = Date.now();
    const outcome = await waitForLaunchToSettle(launch, 10_000, {
      pollMs: 20,
      published: async () => {
        probes += 1;
        // A probe that fails is "not yet", never a crash.
        if (probes === 1) throw new Error("state file unreadable");
        return existsSync(reported);
      },
    });
    assert.equal(outcome, "published");
    assert.ok(Date.now() - from < 5_000, "did not wait out the whole window");
    assert.ok(probes > 1);
    assert.equal(await processIsAlive(pid, launch.startTime), true, "the updater carries on");
  } finally {
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("a launch that is still starting when the watch ends is neither failed nor reported", launchTest, async () => {
  const dir = await scratch();
  let pid: number | null = null;
  try {
    const { launch } = await startDetachedUpdate({
      command: sh("exec sleep 30"),
      cwd: dir,
      env: process.env,
      noBackup: false,
      candidates: [dir],
    });
    pid = launch.pid;
    assert.ok(pid);

    const from = Date.now();
    const outcome = await waitForLaunchToSettle(launch, 300, { pollMs: 20, published: async () => false });
    assert.equal(outcome, "timeout");
    assert.ok(Date.now() - from >= 290, "watched for the whole window");
    assert.ok(Date.now() - from < 5_000);

    // …and the status says so: starting, and a second click is refused.
    const account = await readLaunchAccount({ candidates: [dir] });
    const resolved = resolveUpdateStatus({
      stored: null,
      launch: account.launch,
      launchAlive: account.launchAlive,
      updaterLog: "",
      launchLog: account.launchLog,
      nowMs: Date.now(),
    });
    assert.equal(resolved.state?.phase, "starting");
    assert.equal(updateIsRunning(resolved.state, Date.now()), true);
  } finally {
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("a launcher that could not be run needs no watching", async () => {
  const from = Date.now();
  const outcome = await waitForLaunchToSettle(
    { launchedAt: new Date().toISOString(), pid: null, startTime: null, noBackup: false, logged: false, error: "no launcher" },
    10_000,
    { published: async () => false }
  );
  assert.equal(outcome, "gone");
  assert.ok(Date.now() - from < 2_000);
});

test("each launch starts its log afresh", launchTest, async () => {
  const dir = await scratch();
  try {
    for (const word of ["first", "second"]) {
      const { launch } = await startDetachedUpdate({
        command: sh(`echo ${word}`),
        cwd: dir,
        env: process.env,
        noBackup: false,
        candidates: [dir],
      });
      await waitForLaunchToSettle(launch, 5_000, { pollMs: 20 });
      assert.equal(await readFile(launchLogPath(dir), "utf8"), `${word}\n`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a launcher that cannot be run is a result, never a crash", async () => {
  const dir = await scratch();
  try {
    const missing = await launchDetached(
      { file: join(dir, "no-such-launcher"), args: [] },
      { cwd: dir, env: process.env, logFd: null }
    );
    assert.equal(missing.pid, null);
    assert.match(missing.error ?? "", /ENOENT/);

    if (!CAN_LAUNCH) return;
    // A working directory that has gone away fails the same way, and the
    // operator is told without being shown the path.
    const started = await startDetachedUpdate({
      command: sh("true"),
      cwd: join(dir, "gone"),
      env: process.env,
      noBackup: false,
      candidates: [dir],
    });
    assert.match(started.launcherError ?? "", /ENOENT/);
    assert.equal(started.launch.pid, null);
    assert.match(started.launch.error ?? "", /could not run the update launcher/);
    assert.ok(!(started.launch.error ?? "").includes(dir), "no filesystem path in the message");

    const account = await readLaunchAccount({ candidates: [dir] });
    const resolved = resolveUpdateStatus({
      stored: null,
      launch: account.launch,
      launchAlive: account.launchAlive,
      updaterLog: "",
      launchLog: account.launchLog,
      nowMs: Date.now(),
    });
    assert.equal(resolved.state?.status, "failed");
    assert.equal(resolved.state?.phase, "launch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a launcher that never exits does not hang the request", launchTest, async () => {
  const dir = await scratch();
  try {
    const startedAt = Date.now();
    const result = await launchDetached(
      // Reports a process id, then lingers with descriptor 3 still open.
      { file: "/bin/bash", args: ["-c", 'echo "$$" >&3; sleep 5'] },
      { cwd: dir, env: process.env, logFd: null, timeoutMs: 300 }
    );
    assert.ok(Date.now() - startedAt < 3_000);
    assert.equal(result.error, null);
    assert.ok(result.pid && result.pid > 1);
    process.kill(result.pid, "SIGKILL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the process probe tells this process, a finished one and a stranger apart", async () => {
  const mine = await processStartTime(process.pid);
  assert.equal(await processIsAlive(process.pid, mine), true);
  assert.equal(await processIsAlive(process.pid, null), true);

  // 0, 1 and negative ids address a process group or init, never the updater.
  for (const pid of [0, 1, -1, -process.pid, 1.5, Number.NaN]) {
    assert.equal(await processIsAlive(pid, null), false, `pid ${pid}`);
  }

  if (HAS_PROC) {
    assert.match(mine ?? "", /^\d+$/);
    // Same id, different start time: the id was reused by someone else.
    assert.equal(await processIsAlive(process.pid, String(Number(mine) + 1)), false);
  }
});

test("the launch directory is the first candidate that can actually be written", async () => {
  const root = await scratch();
  try {
    const unusable = await impossibleDir(root);
    const usable = join(root, "panel-logs");
    await mkdir(usable);
    const missing = join(root, "not-created-yet");

    assert.equal(await findLaunchDir({ candidates: [unusable, usable] }), usable);
    assert.equal(await findLaunchDir({ candidates: [usable, missing] }), usable);

    // A status read creates nothing; a launch may.
    assert.equal(await findLaunchDir({ candidates: [missing, usable] }), usable);
    assert.equal(existsSync(missing), false);
    assert.equal(await findLaunchDir({ create: true, candidates: [missing, usable] }), missing);
    assert.equal((await stat(missing)).isDirectory(), true);

    // A file where the directory should be is not a directory.
    assert.equal(await findLaunchDir({ candidates: [join(root, "not-a-directory"), usable] }), usable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the launch log is never written through a planted symlink", async () => {
  const dir = await scratch();
  try {
    const victim = join(dir, "victim.txt");
    await writeFile(victim, "do not truncate me");
    await symlink(victim, launchLogPath(dir));

    assert.equal(await openLaunchLog(dir), null);
    assert.equal(await readFile(victim, "utf8"), "do not truncate me");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a damaged launch record reads as no record", async () => {
  const dir = await scratch();
  try {
    assert.equal(await readUpdateLaunch(dir), null);
    assert.equal(await readUpdateLaunch(null), null);
    await writeFile(launchRecordPath(dir), "{ not json");
    assert.equal(await readUpdateLaunch(dir), null);
    await writeFile(launchRecordPath(dir), JSON.stringify({ launchedAt: "never" }));
    assert.equal(await readUpdateLaunch(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the output shown in the browser carries no terminal sequences", async () => {
  const dir = await scratch();
  try {
    const log = launchLogPath(dir);
    await writeFile(
      log,
      [
        "\u001b[0;36m[GSM]\u001b[0m Checking for updates...",
        // drizzle-kit and npm redraw a spinner with "erase line, go to column 1".
        "\u001b[2K\u001b[1G[⣷] Pulling schema from database...",
        "\u001b[2K\u001b[1G[✓] Pulling schema from database...",
        "Receiving objects:  50%\rReceiving objects: 100%",
        "\u001b[0;31m[✗]\u001b[0m Cannot fetch origin/main.",
        "",
      ].join("\n")
    );
    const shown = await readUpdateLogTail(log);
    assert.equal(
      shown,
      [
        "[GSM] Checking for updates...",
        "[⣷] Pulling schema from database...",
        "[✓] Pulling schema from database...",
        "Receiving objects:  50%",
        "Receiving objects: 100%",
        "[✗] Cannot fetch origin/main.",
        "",
      ].join("\n")
    );
    assert.equal(plainOutput("windows\r\nline endings\r\n"), "windows\r\nline endings\r\n");

    // Only the tail is sent, and a missing log is an empty one.
    assert.equal(await readUpdateLogTail(log, 10), "gin/main.\n");
    assert.equal(await readUpdateLogTail(join(dir, "absent.log")), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the panel's launch files stay out of the updater's state directory", () => {
  // A bare environment: only the variables named here, none of this machine's.
  const env = (values: Record<string, string> = {}) => values as NodeJS.ProcessEnv;

  const { statePath, logPath } = updatePaths(env());
  assert.equal(statePath, "/var/lib/gsm-panel-update/state.json");
  assert.equal(logPath, "/var/lib/gsm-panel-update/update.log");

  assert.deepEqual(updateLaunchDirCandidates(env()), ["/var/log/gsm-panel"]);
  assert.deepEqual(updateLaunchDirCandidates(env({ GSM_UPDATE_LAUNCH_DIR: " /srv/panel/logs " })), [
    "/srv/panel/logs",
    "/var/log/gsm-panel",
  ]);
  for (const dir of updateLaunchDirCandidates(env())) {
    assert.ok(!launchLogPath(dir).startsWith("/var/lib/gsm-panel-update/"));
    assert.ok(!launchRecordPath(dir).startsWith("/var/lib/gsm-panel-update/"));
  }
  assert.equal(launchLogPath("/var/log/gsm-panel"), `/var/log/gsm-panel/${UPDATE_LAUNCH_LOG_NAME}`);
  assert.equal(launchRecordPath("/var/log/gsm-panel"), `/var/log/gsm-panel/${UPDATE_LAUNCH_RECORD_NAME}`);
});
