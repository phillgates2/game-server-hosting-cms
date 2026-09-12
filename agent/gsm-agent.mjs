#!/usr/bin/env node
/**
 * GSM Node Agent — runs on a REMOTE game-server machine.
 *
 * Zero dependencies (Node 18+ only): a tiny HTTP server that executes the
 * panel's process-control commands on this box and reports heartbeats back.
 * The panel talks to it through the node's stored API URL + API key
 * (Nodes panel), so nothing here needs the panel's database.
 *
 *   GSM_AGENT_PORT        listen port (default 8787)
 *   GSM_AGENT_KEY         shared secret — must equal the node's API key
 *   GSM_SERVERS_ROOT      every installPath must live inside this directory
 *   GSM_PANEL_URL         panel origin for heartbeats (e.g. https://panel.example.com)
 *   GSM_NODE_ID           this node's id in the panel
 *   GSM_HEARTBEAT_SECONDS heartbeat cadence (default 15)
 *
 * Endpoints (all POST, JSON, x-api-key header):
 *   /rpc/ping      → { ok, hostname, version }
 *   /rpc/process   → { action: status|start|stop, installPath, pid }
 *   /rpc/log       → { installPath, tail }
 *   /rpc/install   → { installPath, script, timeoutMs? }  (Stage 48: remote
 *                     game installs — the panel ships the rendered install
 *                     script, the agent runs it contained in SERVERS_ROOT)
 *   /rpc/disk      → { path }
 *
 * Threat model: the network between panel and agent is not trusted. The key
 * is compared constant-time, bodies are size-capped, and every path is
 * re-rooted against GSM_SERVERS_ROOT so a forged request cannot touch
 * anything outside the game-server tree.
 */

import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, openSync } from "node:fs";
import {
  statfs,
  stat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rm,
  rename,
} from "node:fs/promises";
import { resolve, sep, join, relative, basename, extname } from "node:path";
import { hostname, loadavg, cpus } from "node:os";

export const AGENT_VERSION = "1.0.0";
const MAX_BODY_BYTES = 32 * 1024 * 1024; // migration chunks ride through JSON
const STOP_GRACE_MS = 5_000;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** Constant-time compare so the key cannot be recovered by timing. */
export function constantTimeMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Re-root a candidate path against the allowed root. Returns the resolved
 * absolute path, or null when it escapes the root — ".." segments, absolute
 * paths elsewhere and symlink-free traversal are all refused by resolve().
 */
export function containedPath(root, candidate) {
  if (typeof root !== "string" || !root) return null;
  if (typeof candidate !== "string" || !candidate) return null;
  const base = resolve(root);
  const full = resolve(base, candidate);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

/** Last `n` lines of a log string, joined. */
export function tailLines(text, n) {
  if (typeof text !== "string" || text.length === 0) return "";
  const lines = text.split("\n");
  return lines.slice(-Math.max(1, n)).join("\n");
}

/** Parse a meminfo-style string into { totalMb, availableMb }. */
export function parseMeminfo(meminfo) {
  const kb = (key) => {
    const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
    return m ? Number.parseInt(m[1], 10) : 0;
  };
  return { totalMb: kb("MemTotal") / 1024, availableMb: kb("MemAvailable") / 1024 };
}

// ── Process control ─────────────────────────────────────────────────────────

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startServer(installPath) {
  const script = `${installPath}/gsm-start.sh`;
  const logPath = `${installPath}/gsm-server.log`;
  // Detach exactly like the panel does locally: new session, output into the
  // server's own log, no pipes back to the agent.
  const out = openSync(logPath, "a");
  const child = spawn("/bin/bash", [script], {
    cwd: installPath,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, HOME: installPath },
  });
  child.unref();
  return { pid: child.pid ?? null, alive: child.pid ? true : false };
}

// Kill the whole process GROUP, then fall back to the single pid — exactly
// like the panel's local killProcess. Game start scripts detach children;
// killing only the wrapper pid left the game itself running (Stage 48:
// "stop" reported success while bedrock_server kept running).
function killTarget(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* gone already */
    }
  }
}

function stopServer(pid) {
  return new Promise((res) => {
    if (!isAlive(pid)) return res({ ok: true, alreadyStopped: true });
    killTarget(pid, "SIGTERM");
    const deadline = Date.now() + STOP_GRACE_MS;
    const timer = setInterval(() => {
      if (!isAlive(pid)) {
        clearInterval(timer);
        return res({ ok: true });
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        killTarget(pid, "SIGKILL");
        return res({ ok: true, escalated: true });
      }
    }, 250);
  });
}

// ── File operations ─────────────────────────────────────────────────────────
//
// These mirror the panel's local file-ops shapes so the Files panel works the
// same whether the server is local or remote. Every path is re-rooted against
// the allowed root before touching the disk.

const TEXT_READ_MAX_BYTES = 2 * 1024 * 1024;

async function fsStat(root, rel) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  const s = await stat(full);
  return { isDir: s.isDirectory(), isFile: s.isFile(), size: s.size, modified: s.mtime.toISOString() };
}

async function fsList(root, rel) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  const entries = await readdir(full, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    try {
      const p = join(full, e.name);
      const st = await stat(p);
      items.push({
        name: e.name,
        path: relative(root, p),
        isDir: e.isDirectory(),
        size: st.size,
        modified: st.mtime.toISOString(),
        ext: e.isFile() ? extname(e.name).slice(1) : null,
      });
    } catch {
      items.push({ name: e.name, path: relative(root, join(full, e.name)), isDir: e.isDirectory(), size: 0, modified: "", ext: null });
    }
  }
  items.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  return { type: "directory", path: relative(root, full), items };
}

async function fsRead(root, rel) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  const s = await stat(full);
  if (!s.isFile()) return { error: "Path is not a file", code: 400 };
  if (s.size > TEXT_READ_MAX_BYTES) {
    return { type: "file", path: relative(root, full), name: basename(full), size: s.size, tooLarge: true, content: null };
  }
  const raw = await readFile(full);
  // Refuse to hand back binary as text — the panel would corrupt it on save.
  const sniff = raw.subarray(0, 8192);
  const isText = !sniff.includes(0);
  if (!isText) {
    return { type: "file", path: relative(root, full), name: basename(full), size: s.size, modified: s.mtime.toISOString(), binary: true, content: null };
  }
  return { type: "file", path: relative(root, full), name: basename(full), size: s.size, modified: s.mtime.toISOString(), content: raw.toString("utf8") };
}

const BIN_READ_MAX_BYTES = 20 * 1024 * 1024;

async function fsReadBin(root, rel) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  const s = await stat(full);
  if (!s.isFile()) return { error: "Path is not a file", code: 400 };
  if (s.size > BIN_READ_MAX_BYTES) return { error: "File too large to download through the agent (20 MB cap)", code: 413 };
  const raw = await readFile(full);
  return { base64: raw.toString("base64"), fileName: basename(full), size: s.size };
}

async function fsWrite(root, rel, content) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  await mkdir(require_dirname(full), { recursive: true });
  await writeFile(full, content ?? "", "utf8");
  return { ok: true };
}

// dirname without importing path.dirname twice (join/relative already imported)
function require_dirname(p) {
  const i = p.lastIndexOf(sep);
  return i > 0 ? p.slice(0, i) : p;
}

async function fsMkdir(root, rel) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  await mkdir(full, { recursive: true });
  return { ok: true };
}

async function fsDelete(root, rel) {
  const full = containedPath(root, rel);
  if (!full) return { error: "Path outside the allowed root", code: 400 };
  if (full === resolve(root)) return { error: "Refusing to delete the server root", code: 400 };
  await rm(full, { recursive: true, force: true });
  return { ok: true };
}

async function fsRename(root, fromRel, toRel) {
  const from = containedPath(root, fromRel);
  const to = containedPath(root, toRel);
  if (!from || !to) return { error: "Path outside the allowed root", code: 400 };
  await rename(from, to);
  return { ok: true };
}

// ── Backups ─────────────────────────────────────────────────────────────────
//
// Same archive format and exclusions as the panel's createServerBackup so a
// backup made remotely restores identically. Retention keeps the newest N.

const BACKUP_NAME_RE = /^backup-[A-Za-z0-9._-]+\.tar\.gz$/;
const DEFAULT_BACKUP_KEEP = 10;

function backupDirFor(installPath) {
  return join(installPath, "gsm-backups");
}

async function backupCreate(root, relInstall) {
  const installPath = containedPath(root, relInstall);
  if (!installPath) return { error: "Path outside the allowed root", code: 400 };
  const dir = backupDirFor(installPath);
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `backup-${ts}.tar.gz`;
  const out = join(dir, name);
  const r = spawnSync("tar", ["czf", out, "--exclude=gsm-backups", "--exclude=steamcmd", "--exclude=.steam", "-C", installPath, "."], { encoding: "utf8" });
  if (r.status !== 0) return { error: (r.stderr || "tar failed").slice(-300), code: 500 };

  // Retention: keep the newest N, delete the rest.
  try {
    const keep = Number(process.env.GSM_BACKUP_KEEP || DEFAULT_BACKUP_KEEP);
    const files = (await readdir(dir)).filter((f) => BACKUP_NAME_RE.test(f)).sort((a, b) => b.localeCompare(a));
    for (const f of files.slice(keep)) await rm(join(dir, f), { force: true });
  } catch { /* pruning must never fail a good backup */ }

  return { ok: true, name };
}

async function backupList(root, relInstall) {
  const installPath = containedPath(root, relInstall);
  if (!installPath) return { error: "Path outside the allowed root", code: 400 };
  try {
    const dir = backupDirFor(installPath);
    const files = await readdir(dir);
    const backups = [];
    for (const f of files.filter((x) => BACKUP_NAME_RE.test(x))) {
      const st = await stat(join(dir, f)).catch(() => null);
      backups.push({ name: f, sizeMb: st ? Math.round((st.size / 1024 / 1024) * 10) / 10 : 0, created: st ? st.mtime.toISOString() : "" });
    }
    backups.sort((a, b) => b.created.localeCompare(a.created));
    return { backups };
  } catch {
    return { backups: [] };
  }
}

async function backupRestore(root, relInstall, name) {
  const installPath = containedPath(root, relInstall);
  if (!installPath) return { error: "Path outside the allowed root", code: 400 };
  if (typeof name !== "string" || !BACKUP_NAME_RE.test(name)) return { error: "Invalid backup name", code: 400 };
  const dir = backupDirFor(installPath);
  const file = join(dir, name);
  // The regex already blocks separators; belt-and-braces containment check.
  if (containedPath(dir, name) !== file) return { error: "Invalid backup name", code: 400 };
  const r = spawnSync("tar", ["xzf", file, "-C", installPath], { encoding: "utf8" });
  if (r.status !== 0) return { error: (r.stderr || "restore failed").slice(-300), code: 500 };
  return { ok: true };
}

// ── Migration transfer ──────────────────────────────────────────────────────
//
// Servers moving between nodes travel as one archive. The source streams it
// out in slices; the destination receives base64 chunks into a staged temp
// file and extracts on the final chunk.

const MIGRATION_SLICE_MAX = 8 * 1024 * 1024;
const importStaging = new Map();

async function backupDownloadSlice(root, relInstall, name, offset, length) {
  const installPath = containedPath(root, relInstall);
  if (!installPath) return { error: "Path outside the allowed root", code: 400 };
  if (typeof name !== "string" || !BACKUP_NAME_RE.test(name)) return { error: "Invalid backup name", code: 400 };
  const dir = backupDirFor(installPath);
  const file = join(dir, name);
  if (containedPath(dir, name) !== file) return { error: "Invalid backup name", code: 400 };
  const st = await stat(file);
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const len = Math.min(MIGRATION_SLICE_MAX, Math.max(1, Math.floor(Number(length) || MIGRATION_SLICE_MAX)));
  if (off >= st.size) return { data: "", size: st.size, eof: true };
  const { open } = await import("node:fs/promises");
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(len, st.size - off));
    await fh.read(buf, 0, buf.length, off);
    return { data: buf.toString("base64"), size: st.size, eof: off + buf.length >= st.size };
  } finally {
    await fh.close();
  }
}

async function importChunk(root, relInstall, dataB64, final) {
  const installPath = containedPath(root, relInstall);
  if (!installPath) return { error: "Path outside the allowed root", code: 400 };
  let staged = importStaging.get(installPath);
  if (!staged) {
    await mkdir(installPath, { recursive: true });
    staged = join(installPath, `.gsm-import-${process.pid}-${Date.now()}.tar.gz`);
    importStaging.set(installPath, staged);
  }
  if (typeof dataB64 === "string" && dataB64.length > 0) {
    await writeFile(staged, Buffer.from(dataB64, "base64"), { flag: "a" });
  }
  if (!final) return { ok: true, staged: true };

  importStaging.delete(installPath);
  const r = spawnSync("tar", ["xzf", staged, "-C", installPath], { encoding: "utf8" });
  await rm(staged, { force: true });
  if (r.status !== 0) return { error: (r.stderr || "extract failed").slice(-300), code: 500 };
  return { ok: true, extracted: true };
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveP, rejectP) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        rejectP(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveP(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectP);
  });
}

/** The request handler, exported for tests via an injected listener. */
export function createAgentHandler(cfg) {
  const { apiKey, root } = cfg;

  return async function handle(req, res) {
    try {
      if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

      // Auth first, always: no route is reachable without the key.
      const presented = req.headers["x-api-key"];
      if (!apiKey || typeof presented !== "string" || !constantTimeMatch(apiKey, presented)) {
        return send(res, 401, { error: "Invalid API key" });
      }

      let body = {};
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: "Invalid JSON body" });
      }

      const url = (req.url || "").split("?")[0];

      if (url === "/rpc/ping") {
        return send(res, 200, { ok: true, hostname: hostname(), version: AGENT_VERSION });
      }

      if (url === "/rpc/process") {
        const { action, installPath, pid } = body;
        const dir = containedPath(root, installPath);
        if (!dir) return send(res, 400, { error: "installPath outside the allowed root" });

        if (action === "status") {
          const alive = isAlive(pid);
          return send(res, 200, { alive, pid: alive ? pid : null });
        }
        if (action === "start") {
          try {
            const r = startServer(dir);
            return send(res, 200, r);
          } catch (e) {
            return send(res, 500, { error: e.message || "start failed" });
          }
        }
        if (action === "stop") {
          const r = await stopServer(pid);
          return send(res, 200, r);
        }
        return send(res, 400, { error: "Unknown action" });
      }

      if (url === "/rpc/log") {
        const { installPath, tail } = body;
        const dir = containedPath(root, installPath);
        if (!dir) return send(res, 400, { error: "installPath outside the allowed root" });
        try {
          const text = readFileSync(`${dir}/gsm-server.log`, "utf8");
          return send(res, 200, { log: tailLines(text, Number(tail) || 200) });
        } catch {
          return send(res, 200, { log: "" });
        }
      }

      if (url === "/rpc/install") {
        const { installPath, script } = body;
        const dir = containedPath(root, installPath);
        if (!dir) return send(res, 400, { error: "installPath outside the allowed root" });
        if (typeof script !== "string" || script.length === 0 || script.length > 2_000_000) {
          return send(res, 400, { error: "script required (string, max 2MB)" });
        }
        try {
          await mkdir(dir, { recursive: true });
          const scriptPath = join(dir, ".gsm-install.sh");
          await writeFile(scriptPath, script, { mode: 0o700 });
          const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 1_800_000, 5_000), 1_800_000);
          const result = await new Promise((resolveP) => {
            let output = "";
            let done = false;
            const append = (chunk) => {
              output += chunk.toString();
              if (output.length > 200_000) output = output.slice(-200_000);
            };
            const child = spawn("bash", [scriptPath], { cwd: dir });
            const timer = setTimeout(() => {
              if (done) return;
              done = true;
              child.kill("SIGKILL");
              resolveP({ ok: false, exitCode: -1, output: output.slice(-20_000) + "\n[killed: install timed out]" });
            }, timeoutMs);
            child.stdout.on("data", append);
            child.stderr.on("data", append);
            child.on("error", (e) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              resolveP({ ok: false, exitCode: -1, output: String(e.message || e) });
            });
            child.on("close", (code) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              rm(scriptPath).catch(() => undefined);
              resolveP({ ok: code === 0, exitCode: code ?? -1, output: output.slice(-20_000) });
            });
          });
          return send(res, result.ok ? 200 : 502, result);
        } catch (e) {
          return send(res, 500, { ok: false, exitCode: -1, output: String((e && e.message) || e) });
        }
      }

      if (url === "/rpc/disk") {
        const p = containedPath(root, body.path || ".") || root;
        try {
          const st = await statfs(p);
          const totalMb = Math.round((st.blocks * st.bsize) / (1024 * 1024));
          const freeMb = Math.round((st.bavail * st.bsize) / (1024 * 1024));
          return send(res, 200, { usedMb: Math.max(0, totalMb - freeMb), totalMb });
        } catch (e) {
          return send(res, 500, { error: e.message || "statfs failed" });
        }
      }

      if (url === "/rpc/fs") {
        const { op, path: rel, installPath } = body;
        // Stage 48: panel file operations are relative to the SERVER dir, not
        // the node root. When installPath is supplied (and contained), it
        // becomes the anchor; plain root-relative requests keep working.
        let base = root;
        if (typeof installPath === "string" && installPath.length > 0) {
          const anchored = containedPath(root, installPath);
          if (!anchored) return send(res, 400, { error: "installPath outside the allowed root" });
          base = anchored;
        }
        try {
          if (op === "stat") return send(res, 200, await fsStat(base, rel));
          if (op === "list") return send(res, 200, await fsList(base, rel));
          if (op === "read") return send(res, 200, await fsRead(base, rel));
          if (op === "readbin") return send(res, 200, await fsReadBin(base, rel));
          if (op === "write") {
            const r = await fsWrite(base, rel, body.content);
            return send(res, r.code || 200, r);
          }
          if (op === "mkdir") {
            const r = await fsMkdir(base, rel);
            return send(res, r.code || 200, r);
          }
          if (op === "delete") {
            const r = await fsDelete(base, rel);
            return send(res, r.code || 200, r);
          }
          if (op === "rename") {
            const r = await fsRename(base, rel, body.to);
            return send(res, r.code || 200, r);
          }
          return send(res, 400, { error: "Unknown fs op" });
        } catch (e) {
          const code = e && e.code === "ENOENT" ? 404 : 500;
          return send(res, code, { error: e.message || "fs op failed" });
        }
      }

      if (url === "/rpc/backup") {
        const { action, installPath, name } = body;
        let r;
        if (action === "create") r = await backupCreate(root, installPath);
        else if (action === "list") r = await backupList(root, installPath);
        else if (action === "restore") r = await backupRestore(root, installPath, name);
        else return send(res, 400, { error: "Unknown backup action" });
        return send(res, r.code || 200, r);
      }

      if (url === "/rpc/backup/download") {
        const { installPath, name, offset, length } = body;
        const r = await backupDownloadSlice(root, installPath, name, offset, length);
        return send(res, r.code || 200, r);
      }

      if (url === "/rpc/import") {
        const { installPath, data, final } = body;
        const r = await importChunk(root, installPath, data, Boolean(final));
        return send(res, r.code || 200, r);
      }

      return send(res, 404, { error: "Not found" });
    } catch (e) {
      return send(res, 500, { error: "Internal error" });
    }
  };
}

// ── Heartbeats ──────────────────────────────────────────────────────────────

function startHeartbeats(cfg) {
  const { panelUrl, nodeId, apiKey, root, intervalSeconds } = cfg;
  if (!panelUrl || !nodeId) return; // heartbeats optional; the panel can still drive us

  const tick = async () => {
    try {
      let ramUsedMb = 0;
      let ramTotalMb = 0;
      try {
        const mi = parseMeminfo(readFileSync("/proc/meminfo", "utf8"));
        ramTotalMb = Math.round(mi.totalMb);
        ramUsedMb = Math.round(mi.totalMb - mi.availableMb);
      } catch {
        /* non-Linux: leave zeros */
      }
      let diskUsedMb = 0;
      let diskTotalMb = 0;
      try {
        const st = await statfs(root);
        diskTotalMb = Math.round((st.blocks * st.bsize) / (1024 * 1024));
        diskUsedMb = Math.max(0, diskTotalMb - Math.round((st.bavail * st.bsize) / (1024 * 1024)));
      } catch {
        /* ignore */
      }
      const load = loadavg();
      const payload = {
        cpuLoad1: load[0],
        cpuLoad5: load[1],
        cpuLoad15: load[2],
        cpuPercent: Math.min(100, (load[0] / Math.max(1, cpus().length)) * 100),
        ramUsedMb,
        ramTotalMb,
        diskUsedMb,
        diskTotalMb,
      };
      const res = await fetch(`${panelUrl.replace(/\/+$/, "")}/api/nodes/${nodeId}/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(`[gsm-agent] heartbeat rejected: HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`[gsm-agent] heartbeat failed: ${e.message || e}`);
    }
  };

  void tick();
  const t = setInterval(() => void tick(), Math.max(5, intervalSeconds) * 1000);
  t.unref?.();
}

// ── Entry point ─────────────────────────────────────────────────────────────

function main() {
  const port = Number(process.env.GSM_AGENT_PORT || 8787);
  const apiKey = process.env.GSM_AGENT_KEY || "";
  const root = resolve(process.env.GSM_SERVERS_ROOT || "/opt/gameservers");
  if (!apiKey) {
    console.error("[gsm-agent] GSM_AGENT_KEY is required");
    process.exit(1);
  }

  const handler = createAgentHandler({ apiKey, root });
  const server = http.createServer((req, res) => void handler(req, res));
  server.listen(port, () => {
    console.log(`[gsm-agent] v${AGENT_VERSION} listening on :${port}, root ${root}`);
  });

  startHeartbeats({
    panelUrl: process.env.GSM_PANEL_URL || "",
    nodeId: process.env.GSM_NODE_ID || "",
    apiKey,
    root,
    intervalSeconds: Number(process.env.GSM_HEARTBEAT_SECONDS || 15),
  });
}

// Run main() only when executed directly, not when imported by tests.
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (isMain) main();

// Keep the randomBytes import honest (used by tooling that seeds test keys).
export const randomKey = () => randomBytes(24).toString("hex");
