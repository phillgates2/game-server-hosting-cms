import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  attachRemoteSource,
  beginProgress,
  collapseCarriageReturns,
  feedProgress,
  finishProgress,
  getProgress,
  parseProgressLine,
  pollRemoteProgress,
  PROGRESS_SHIM,
  resetProgressStore,
  setProgressStage,
  withProgressHelpers,
} from "../src/lib/install-progress";
import { formatBytes, formatDuration, formatRate } from "../src/lib/install-progress-format";
import { runUpdateScript } from "../src/lib/server-update-runner";
import { remoteInstallOutput } from "../src/lib/node-client";
// @ts-ignore — the agent is a standalone .mjs with no type declarations
import { installOutputSince } from "../agent/gsm-agent.mjs";

test("SteamCMD download lines yield phase, percent and bytes", () => {
  const sig = parseProgressLine(" Update state (0x61) downloading, progress: 42.10 (1234567 / 2932345)");
  assert.equal(sig?.phase, "downloading");
  assert.equal(sig?.percent, 42.1);
  assert.equal(sig?.bytesDone, 1234567);
  assert.equal(sig?.bytesTotal, 2932345);
  assert.equal(sig?.transient, true);

  assert.equal(parseProgressLine("Update state (0x5) verifying install, progress: 7.5 (1 / 2)")?.phase, "verifying");
  assert.equal(parseProgressLine("Update state (0x11) preallocating, progress: 0.00 (0 / 9)")?.label, "Reserving disk space");
  assert.equal(parseProgressLine("Update state (0x101) committing, progress: 99.0 (9 / 9)")?.phase, "installing");
});

test("SteamCMD self-update and success lines are understood", () => {
  const sig = parseProgressLine("[ 45%] Downloading update (1,024 of 2,048 KB)...");
  assert.equal(sig?.percent, 45);
  assert.equal(sig?.item, "SteamCMD");
  assert.equal(sig?.bytesDone, 1024 * 1024);
  assert.equal(sig?.bytesTotal, 2048 * 1024);

  const ok = parseProgressLine("Success! App '896660' fully installed.");
  assert.equal(ok?.percent, 100);
  assert.equal(ok?.phase, "finalizing");
  assert.equal(parseProgressLine("Success! App '740' already up to date.")?.label, "Already up to date");
});

test("curl and wget meters, apt, and template announcements", () => {
  assert.equal(parseProgressLine("######################                    45.3%")?.percent, 45.3);
  assert.equal(parseProgressLine("100.0%")?.percent, 100);
  // curl's unknown-size spinner keeps the phase without inventing a percent.
  const spin = parseProgressLine("##O#- #");
  assert.equal(spin?.phase, "downloading");
  assert.equal(spin?.percent, undefined);
  assert.equal(parseProgressLine("  1050K .......... .......... 12% 1.2M 3s")?.percent, 12);
  assert.equal(parseProgressLine("paper.jar   45%[=====>     ] 12.3M  1.2MB/s")?.item, "paper.jar");

  assert.equal(parseProgressLine("Get:3 http://deb.debian.org/debian bookworm/main amd64 lib32gcc-s1 amd64 12.2 [49 kB]")?.item, "lib32gcc-s1");
  assert.equal(parseProgressLine("Setting up openjdk-21-jre-headless (21.0.1) ...")?.phase, "installing");

  const dl = parseProgressLine("Downloading etlegacy-v2.83.1-x86_64.tar.gz...");
  assert.equal(dl?.phase, "downloading");
  assert.equal(dl?.item, "etlegacy-v2.83.1-x86_64.tar.gz");
  assert.equal(dl?.percent, null);

  const inst = parseProgressLine("Installing Valheim (AppID: 896660)...");
  assert.equal(inst?.phase, "installing");
  assert.equal(inst?.item, "Valheim (AppID: 896660)");

  assert.equal(parseProgressLine("═══ Installing mod: legacy ═══")?.label, "Installing mod: legacy");
  assert.equal(parseProgressLine("→ Using x86_64 (64-bit) ET:Legacy for the legacy mod")?.phase, "installing");
  assert.equal(parseProgressLine("Verifying sha256 (abc123)...")?.phase, "verifying");

  // Ordinary chatter is not progress.
  assert.equal(parseProgressLine("Working directory: /home/gsm/valheim"), null);
  assert.equal(parseProgressLine("=========="), null);
  assert.equal(parseProgressLine(""), null);
});

test("the store tracks a Steam download end to end with speed and ETA", () => {
  resetProgressStore();
  const t0 = 1_000_000;
  const token = beginProgress({ serverId: 7, kind: "install", title: "Valheim", now: t0 });
  feedProgress(7, token, "Installing Valheim (AppID: 896660)...\n", t0);
  let p = getProgress(7, t0)!;
  assert.equal(p.phase, "installing");
  assert.equal(p.item, "Valheim (AppID: 896660)");
  assert.equal(p.percent, null);

  // Chunks split mid-line must still parse.
  feedProgress(7, token, " Update state (0x61) downloading, progr", t0 + 100);
  feedProgress(7, token, "ess: 10.00 (100000000 / 1000000000)\n", t0 + 100);
  feedProgress(7, token, " Update state (0x61) downloading, progress: 20.00 (200000000 / 1000000000)\n", t0 + 2100);
  p = getProgress(7, t0 + 2100)!;
  assert.equal(p.phase, "downloading");
  assert.equal(p.percent, 20);
  assert.equal(p.bytesDone, 200_000_000);
  assert.equal(p.bytesPerSec, 50_000_000);
  assert.equal(p.etaSeconds, 16);
  // The game being installed stays visible while SteamCMD reports numbers.
  assert.equal(p.item, "Valheim (AppID: 896660)");
  // Meter lines overwrite each other in the log tail instead of flooding it.
  assert.equal(p.log.filter((l) => l.includes("Update state")).length, 1);
  assert.deepEqual(p.steps, ["Installing Valheim (AppID: 896660)", "Downloading game files"]);

  setProgressStage(7, token, "configuring", "Writing server config and start scripts", t0 + 3000);
  p = getProgress(7, t0 + 3000)!;
  assert.equal(p.percent, null);
  assert.equal(p.bytesTotal, null);
  assert.equal(p.item, null);

  finishProgress(7, token, { ok: true }, t0 + 4000);
  p = getProgress(7, t0 + 4000)!;
  assert.equal(p.phase, "done");
  assert.equal(p.percent, 100);
  assert.equal(p.ok, true);
  assert.equal(p.finishedAt, t0 + 4000);

  // Finished runs are frozen and eventually swept.
  feedProgress(7, token, "late line\n", t0 + 5000);
  assert.equal(getProgress(7, t0 + 5000)!.log.includes("late line"), false);
  assert.equal(getProgress(7, t0 + 4000 + 11 * 60_000), null);
});

test("a stale token cannot touch a newer run; failures keep their reason", () => {
  resetProgressStore();
  const old = beginProgress({ serverId: 3, kind: "update", title: "Rust" });
  const current = beginProgress({ serverId: 3, kind: "update", title: "Rust" });
  finishProgress(3, old, { ok: false, error: "rejected duplicate" });
  assert.equal(getProgress(3)!.finishedAt, null);

  feedProgress(3, current, "curl: (22) The requested URL returned error: 404\r\n");
  finishProgress(3, current, { ok: false, error: "Update failed (exit 22)" });
  const p = getProgress(3)!;
  assert.equal(p.phase, "failed");
  assert.equal(p.error, "Update failed (exit 22)");
  assert.equal(p.label, "Update failed");
  assert.ok(p.log.some((l) => l.includes("404")));
});

test("carriage-return progress redraws are collapsed out of saved logs", () => {
  assert.equal(collapseCarriageReturns("Downloading a.zip...\n#  10%\r##  50%\r### 100%\nDone\r\n"), "Downloading a.zip...\n### 100%\nDone\r\n");
  assert.equal(collapseCarriageReturns("plain\ntext\n"), "plain\ntext\n");
});

test("withProgressHelpers keeps the shebang first and is idempotent", () => {
  const out = withProgressHelpers("#!/usr/bin/env bash\nset -e\necho hi\n");
  assert.ok(out.startsWith("#!/usr/bin/env bash\n# --- GSM progress helpers"));
  assert.ok(out.endsWith("set -e\necho hi\n"));
  assert.equal(withProgressHelpers(out), out);
  assert.ok(withProgressHelpers("echo hi\n").startsWith("# --- GSM progress helpers"));
});

test("the curl shim announces file downloads and leaves metadata calls alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gsm-shim-"));
  try {
    // A fake curl on PATH that just prints its arguments.
    await writeFile(join(dir, "curl"), '#!/bin/bash\necho "ARGS:$*"\n', { mode: 0o755 });
    const script = `set -eu\n${PROGRESS_SHIM}
curl -fsSL -o out.zip "https://example.com/files/game-server.zip?token=abc"
V=$(curl -fsSL https://api.example.com/releases/latest 2>&1); echo "captured=$V"
curl -fsIL https://example.com/probe.zip
curl -fsSL https://example.com/pkg/server.tar.gz
`;
    const out = execFileSync("bash", ["-c", `${script}`], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = out.trim().split("\n");
    // File download: progress re-enabled.
    assert.equal(lines[0], "ARGS:-fsSL -o out.zip https://example.com/files/game-server.zip?token=abc --no-silent --progress-bar");
    // Captured API call: untouched, and nothing extra leaked into the capture.
    assert.equal(lines[1], "captured=ARGS:-fsSL https://api.example.com/releases/latest");
    // HEAD probe: untouched even though the URL looks like an archive.
    assert.equal(lines[2], "ARGS:-fsIL https://example.com/probe.zip");
    // Archive streamed to stdout (curl | tar): still a download.
    assert.equal(lines[3], "ARGS:-fsSL https://example.com/pkg/server.tar.gz --no-silent --progress-bar");

    const err = execFileSync("bash", ["-c", `{ ${script}\n} 2>&1 >/dev/null`], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.deepEqual(err.trim().split("\n"), ["Downloading game-server.zip...", "Downloading server.tar.gz..."]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runUpdateScript streams live output into the meter", async () => {
  resetProgressStore();
  const dir = await mkdtemp(join(tmpdir(), "gsm-progress-run-"));
  try {
    const token = beginProgress({ serverId: 11, kind: "update", title: "Test Game" });
    const seen: number[] = [];
    const result = await runUpdateScript({
      installPath: dir,
      script: `#!/usr/bin/env bash
set -e
echo "Updating Test Game (AppID: 1)..."
echo " Update state (0x61) downloading, progress: 25.00 (25 / 100)"
sleep 0.3
printf '#####   50.0%%\\r######## 100.0%%\\n' >&2
echo " Update state (0x61) downloading, progress: 75.00 (75 / 100)"
echo "Success! App '1' fully installed."
`,
      onOutput: (chunk) => {
        feedProgress(11, token, chunk);
        const pct = getProgress(11)?.percent;
        if (typeof pct === "number") seen.push(pct);
      },
    });
    assert.ok(seen.includes(25) || seen.includes(75), `saw live percentages: ${seen.join(",")}`);
    const p = getProgress(11)!;
    assert.equal(p.percent, 100);
    assert.equal(p.label, "Game files installed");
    // The saved log keeps the final bar state only.
    assert.equal(result.stderr, "######## 100.0%\n");
    assert.ok(result.stdout.includes("Success! App '1' fully installed."));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote runs pull output from the agent and degrade for old agents", async () => {
  resetProgressStore();
  const token = beginProgress({ serverId: 21, kind: "install", title: "Remote Game", remote: true });
  const offsets: number[] = [];
  attachRemoteSource(21, token, async (offset) => {
    offsets.push(offset);
    return { output: " Update state (0x61) downloading, progress: 33.00 (33 / 100)\n", offset: offset + 60 };
  });
  await pollRemoteProgress(21, 10_000);
  await pollRemoteProgress(21, 10_200); // rate-limited: no second fetch
  await pollRemoteProgress(21, 11_500);
  assert.deepEqual(offsets, [0, 60]);
  assert.equal(getProgress(21)!.percent, 33);
  assert.equal(getProgress(21)!.remote, true);

  const old = beginProgress({ serverId: 22, kind: "install", title: "Old Agent", remote: true });
  let calls = 0;
  attachRemoteSource(22, old, async () => { calls++; return null; });
  await pollRemoteProgress(22, 10_000);
  await pollRemoteProgress(22, 20_000);
  assert.equal(calls, 1);
  assert.equal(getProgress(22)!.liveOutput, false);
});

test("remoteInstallOutput maps an agent 404 to null and passes offsets through", async () => {
  const node = { apiUrl: "http://agent:8443", apiKey: "k" };
  const notFound = (async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })) as typeof fetch;
  assert.equal(await remoteInstallOutput(node, "/srv/a", 0, { fetchImpl: notFound }), null);

  let body: unknown;
  const ok = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ running: true, offset: 42, output: "hello" }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await remoteInstallOutput(node, "/srv/a", 37, { fetchImpl: ok }), { output: "hello", offset: 42, running: true });
  assert.deepEqual(body, { installPath: "/srv/a", offset: 37 });

  const boom = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  await assert.rejects(remoteInstallOutput(node, "/srv/a", 0, { fetchImpl: boom }));
});

test("agent slices buffered install output by absolute offset", () => {
  assert.deepEqual(installOutputSince(undefined, 5), { running: false, offset: 0, output: "" });
  const job = { output: "0123456789", total: 10, running: true };
  assert.deepEqual(installOutputSince(job, 0), { running: true, offset: 10, output: "0123456789" });
  assert.deepEqual(installOutputSince(job, 7), { running: true, offset: 10, output: "789" });
  assert.deepEqual(installOutputSince(job, 10), { running: true, offset: 10, output: "" });
  assert.deepEqual(installOutputSince(job, 999), { running: true, offset: 10, output: "" });
  // The buffer was trimmed: 100 chars produced, only the last 10 kept.
  const trimmed = { output: "abcdefghij", total: 100, running: false };
  assert.deepEqual(installOutputSince(trimmed, 20), { running: false, offset: 100, output: "abcdefghij" });
  assert.deepEqual(installOutputSince(trimmed, 95), { running: false, offset: 100, output: "fghij" });
});

test("meter formatting helpers", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(3.2 * 1024 ** 3), "3.20 GB");
  assert.equal(formatRate(12 * 1024 * 1024), "12.0 MB/s");
  assert.equal(formatDuration(42), "42s");
  assert.equal(formatDuration(125), "2m 05s");
  assert.equal(formatDuration(3725), "1h 02m");
});
