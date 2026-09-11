import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { join, resolve } from "node:path";
import { sep } from "node:path";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { apiError } from "@/lib/api-error";
import { assessDrill, latestBackupName, DRILL_MAX_ENTRIES, type DrillEntry } from "@/lib/backup-drill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const BACKUP_NAME = /^backup-[A-Za-z0-9._-]+\.tar\.gz$/;

function resolveBackupPath(backupDir: string, name: unknown): string | null {
  if (typeof name !== "string" || !BACKUP_NAME.test(name)) return null;
  const base = resolve(backupDir);
  const full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

// POST /api/servers/[id]/backup-drill — prove the newest backup restores.
// Extracts into a scratch dir, assesses the tree, deletes the scratch.
// The live server directory is never written to. Local nodes only in v1.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !(await hasPermission(auth.userId, "servers.backup")) &&
    !(await hasPermission(auth.userId, "servers.restore"))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  let scratch: string | null = null;
  const started = Date.now();

  try {
    const [server] = await db
      .select({
        installPath: gameServers.installPath,
        userId: gameServers.userId,
        nodeIsLocal: nodes.isLocal,
      })
      .from(gameServers)
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, idNum))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (server.nodeIsLocal === false) {
      return NextResponse.json(
        { error: "Restore drills run on local nodes only (the agent has no drill RPC yet)." },
        { status: 400 }
      );
    }

    const backupDir = join(server.installPath, "gsm-backups");
    let names: string[] = [];
    try {
      names = await readdir(backupDir);
    } catch {
      return NextResponse.json({ error: "No backups found — create one first." }, { status: 404 });
    }
    const backupName = latestBackupName(names);
    if (!backupName) {
      return NextResponse.json({ error: "No backups found — create one first." }, { status: 404 });
    }
    const backupPath = resolveBackupPath(backupDir, backupName);
    if (!backupPath) {
      return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
    }

    scratch = await mkdtemp(join(tmpdir(), "gsm-drill-"));
    await runCmd("tar", ["xzf", backupPath, "-C", scratch], scratch, 600_000);

    const entries = await collectEntries(scratch);
    const verdict = assessDrill(entries);

    return NextResponse.json({
      ok: verdict.ok,
      backupName,
      fileCount: verdict.fileCount,
      totalBytes: verdict.totalBytes,
      reason: verdict.reason,
      tookMs: Date.now() - started,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        reason: `drill failed: ${msg.slice(0, 300)}`,
        tookMs: Date.now() - started,
      },
      { status: 500 }
    );
  } finally {
    if (scratch) {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Walk the extracted tree once, bounded so a hostile archive cannot OOM us. */
async function collectEntries(root: string): Promise<DrillEntry[]> {
  const dirents = await readdir(root, { recursive: true, withFileTypes: true });
  const entries: DrillEntry[] = [];
  for (const d of dirents.slice(0, DRILL_MAX_ENTRIES)) {
    if (!d.isFile() && !d.isDirectory()) continue;
    let size = 0;
    if (d.isFile()) {
      const full = join(d.parentPath ?? d.path, d.name);
      try {
        size = (await stat(full)).size;
      } catch {
        size = 0;
      }
    }
    entries.push({ name: d.name, size, isFile: d.isFile() });
  }
  return entries;
}

async function runCmd(file: string, args: string[], cwd: string, timeout: number): Promise<void> {
  await mkdir(cwd, { recursive: true });
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    let done = false;
    const child: ChildProcess = spawn(file, args, { cwd });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error("extraction timed out"));
      }
    }, timeout);
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (e: Error) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on("close", (code: number | null) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (code === 0) resolvePromise();
        else reject(new Error(`tar exited ${code}: ${stderr.slice(0, 300)}`));
      }
    });
  });
}
