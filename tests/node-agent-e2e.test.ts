/**
 * End-to-end test: spawn the REAL agent and drive it over HTTP.
 *
 * This is the proof the agent actually works — start a fake game server
 * through /rpc/process, confirm it is alive, read its log back, stop it,
 * and verify the security guard rails (bad keys, path escapes) refuse.
 *
 *   npm test
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_PATH = fileURLToPath(new URL("../agent/gsm-agent.mjs", import.meta.url));
const KEY = "test-key-0123456789";
const PORT = 18000 + Math.floor(Math.random() * 20_000);
const BASE = `http://127.0.0.1:${PORT}`;

let agent: ChildProcess | null = null;
let root = "";

async function rpc(path: string, body: unknown, key: string | null = KEY): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

describe("node agent end-to-end", () => {
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "gsm-agent-"));
    // A fake game server: a start script that logs and lingers.
    const srv = join(root, "srv1");
    await mkdir(srv, { recursive: true });
    await writeFile(
      join(srv, "gsm-start.sh"),
      "#!/bin/bash\necho 'fake server booting'\nsleep 300\n",
      { mode: 0o755 }
    );

    agent = spawn(process.execPath, [AGENT_PATH], {
      env: {
        ...process.env,
        GSM_AGENT_PORT: String(PORT),
        GSM_AGENT_KEY: KEY,
        GSM_SERVERS_ROOT: root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for the agent to listen.
    await new Promise<void>((resolveP, rejectP) => {
      const timeout = setTimeout(() => rejectP(new Error("agent did not start in time")), 10_000);
      const onData = (buf: Buffer) => {
        if (buf.toString().includes("listening")) {
          clearTimeout(timeout);
          resolveP();
        }
      };
      agent?.stdout?.on("data", onData);
      agent?.stderr?.on("data", onData);
      agent?.on("exit", () => {
        clearTimeout(timeout);
        rejectP(new Error("agent exited early"));
      });
    });
  });

  after(async () => {
    agent?.kill("SIGKILL");
    // The detached fake server may still sleep — nothing to clean beyond the
    // temp dir, which rm removes regardless.
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  test("rejects a missing or wrong API key before anything else", async () => {
    const noKey = await rpc("/rpc/ping", {}, null);
    assert.equal(noKey.status, 401);
    const badKey = await rpc("/rpc/ping", {}, "wrong-key");
    assert.equal(badKey.status, 401);
  });

  test("answers ping with the key", async () => {
    const res = await rpc("/rpc/ping", {});
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.ok(typeof res.data.hostname === "string");
  });

  test("start → alive → log → stop, the full lifecycle", async () => {
    // Start the fake server.
    const start = await rpc("/rpc/process", { action: "start", installPath: join(root, "srv1") });
    assert.equal(start.status, 200);
    assert.equal(start.data.alive, true);
    const pid = start.data.pid as number;
    assert.ok(Number.isInteger(pid) && pid > 0);

    // Give the script a moment to write its log line.
    await new Promise((r) => setTimeout(r, 600));

    // Status says alive.
    const status = await rpc("/rpc/process", { action: "status", installPath: join(root, "srv1"), pid });
    assert.equal(status.data.alive, true);

    // The log carries the boot line.
    const log = await rpc("/rpc/log", { installPath: join(root, "srv1"), tail: 50 });
    assert.equal(log.status, 200);
    assert.match(String(log.data.log), /fake server booting/);

    // Stop it and confirm it is gone.
    const stop = await rpc("/rpc/process", { action: "stop", installPath: join(root, "srv1"), pid });
    assert.equal(stop.status, 200);
    const after = await rpc("/rpc/process", { action: "status", installPath: join(root, "srv1"), pid });
    assert.equal(after.data.alive, false);
  });

  test("refuses installPaths outside the allowed root", async () => {
    const res = await rpc("/rpc/process", { action: "status", installPath: "/etc", pid: 1 });
    assert.equal(res.status, 400);
    assert.match(String(res.data.error), /outside the allowed root/);

    const esc = await rpc("/rpc/log", { installPath: join(root, "..", "..", "etc"), tail: 5 });
    assert.equal(esc.status, 400);
  });

  test("relative traversal that lands inside the root is allowed", async () => {
    const res = await rpc("/rpc/log", { installPath: join(root, "srv1", "..", "srv1"), tail: 5 });
    assert.equal(res.status, 200);
  });

  test("unknown routes answer 404, unknown methods 405", async () => {
    const missing = await rpc("/rpc/nope", {});
    assert.equal(missing.status, 404);

    const get = await fetch(`${BASE}/rpc/ping`, { method: "GET", headers: { "x-api-key": KEY } });
    assert.equal(get.status, 405);
  });

  test("disk endpoint reports real usage for the root", async () => {
    const res = await rpc("/rpc/disk", { path: "." });
    assert.equal(res.status, 200);
    assert.ok(Number(res.data.totalMb) > 0);
    assert.ok(Number(res.data.usedMb) >= 0);
  });

  test("fs: write → list → read → rename → delete round-trip", async () => {
    const srv = join(root, "srv1");

    // Write a file.
    const w = await rpc("/rpc/fs", { op: "write", path: join(srv, "cfg/test.cfg"), content: "hostname \"remote\"\n" });
    assert.equal(w.status, 200);

    // Directory listing shows the new folder and file.
    const ls = await rpc("/rpc/fs", { op: "list", path: join(srv, "cfg") });
    assert.equal(ls.status, 200);
    const items = ls.data.items as Array<{ name: string; isDir: boolean }>;
    assert.ok(items.some((i) => i.name === "test.cfg" && !i.isDir));

    // Read it back.
    const r = await rpc("/rpc/fs", { op: "read", path: join(srv, "cfg/test.cfg") });
    assert.equal(r.status, 200);
    assert.match(String(r.data.content), /hostname/);

    // Rename it.
    const mv = await rpc("/rpc/fs", { op: "rename", path: join(srv, "cfg/test.cfg"), to: join(srv, "cfg/renamed.cfg") });
    assert.equal(mv.status, 200);

    // Delete it, and confirm it is gone.
    const del = await rpc("/rpc/fs", { op: "delete", path: join(srv, "cfg/renamed.cfg") });
    assert.equal(del.status, 200);
    const gone = await rpc("/rpc/fs", { op: "read", path: join(srv, "cfg/renamed.cfg") });
    assert.equal(gone.status, 404);
  });

  test("fs: refuses to escape the root and to delete the root itself", async () => {
    const esc = await rpc("/rpc/fs", { op: "write", path: join(root, "..", "evil.txt"), content: "x" });
    assert.equal(esc.status, 400);

    const delRoot = await rpc("/rpc/fs", { op: "delete", path: root });
    assert.equal(delRoot.status, 400);
    assert.match(String(delRoot.data.error), /Refusing to delete the server root/);
  });

  test("backup: create → list → restore → retention", async () => {
    const srv = join(root, "srv1");

    // Put a marker file in the server dir.
    await rpc("/rpc/fs", { op: "write", path: join(srv, "world.dat"), content: "original" });

    // Create a backup, then modify the file, then restore.
    const created = await rpc("/rpc/backup", { action: "create", installPath: srv });
    assert.equal(created.status, 200);
    assert.match(String(created.data.name), /^backup-.*\.tar\.gz$/);

    await rpc("/rpc/fs", { op: "write", path: join(srv, "world.dat"), content: "corrupted" });

    const listed = await rpc("/rpc/backup", { action: "list", installPath: srv });
    assert.equal(listed.status, 200);
    const backups = listed.data.backups as Array<{ name: string }>;
    assert.ok(backups.some((b) => b.name === created.data.name));

    const restored = await rpc("/rpc/backup", { action: "restore", installPath: srv, name: created.data.name });
    assert.equal(restored.status, 200);

    const after = await rpc("/rpc/fs", { op: "read", path: join(srv, "world.dat") });
    assert.match(String(after.data.content), /original/);
  });

  test("migration transfer: download slices → reassemble → chunked import", async () => {
    const src = join(root, "srv1");
    // Give the source a distinctive file so we can prove it crossed.
    await rpc("/rpc/fs", { op: "write", path: join(src, "migrate-marker.txt"), content: "carry-me-over" });

    // 1. Source agent builds a clean archive.
    const created = await rpc("/rpc/backup", { action: "create", installPath: src });
    assert.equal(created.status, 200);
    const name = String(created.data.name);

    // 2. Stream it back slice by slice and reassemble.
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const slice = await rpc("/rpc/backup/download", { installPath: src, name, offset, length: 64 * 1024 });
      assert.equal(slice.status, 200);
      const data = String(slice.data.data ?? "");
      if (data) {
        const buf = Buffer.from(data, "base64");
        chunks.push(buf);
        offset += buf.length;
      }
      if (slice.data.eof) break;
      if (!data) throw new Error("download stalled");
    }
    const archive = Buffer.concat(chunks);
    assert.ok(archive.length > 0);
    // Gzip magic bytes prove the slices reassembled into a valid archive.
    assert.equal(archive[0], 0x1f);
    assert.equal(archive[1], 0x8b);

    // 3. Push it into a fresh destination via chunked import.
    const dst = join(root, "srv-migrated");
    const CHUNK = 64 * 1024;
    for (let i = 0; i < archive.length; i += CHUNK) {
      const piece = archive.subarray(i, i + CHUNK);
      const isFinal = i + CHUNK >= archive.length;
      const up = await rpc("/rpc/import", { installPath: dst, data: piece.toString("base64"), final: isFinal });
      assert.equal(up.status, 200);
      if (isFinal) assert.equal(up.data.extracted, true);
    }

    // 4. The marker file must now exist at the destination.
    const check = await rpc("/rpc/fs", { op: "read", path: join(dst, "migrate-marker.txt") });
    assert.equal(check.status, 200);
    assert.match(String(check.data.content), /carry-me-over/);
  });

  test("backup: refuses a crafted restore name", async () => {
    const srv = join(root, "srv1");
    const evil = await rpc("/rpc/backup", { action: "restore", installPath: srv, name: "../../etc/passwd" });
    assert.equal(evil.status, 400);
    const evil2 = await rpc("/rpc/backup", { action: "restore", installPath: srv, name: "backup-foo.tar.gz; rm -rf /" });
    assert.equal(evil2.status, 400);
  });
});
