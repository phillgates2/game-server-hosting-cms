import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { apiError } from "@/lib/api-error";

// Backup archives are always created by this route, so their names follow a
// fixed shape. Anything else is rejected rather than sanitized — a restore is
// destructive and there is no reason to accept a creative filename.
const BACKUP_NAME = /^backup-[A-Za-z0-9._-]+\.tar\.gz$/;

/** Resolve a backup file, refusing names that escape the backup directory. */
function resolveBackupPath(backupDir: string, name: unknown): string | null {
  if (typeof name !== "string" || !BACKUP_NAME.test(name)) return null;
  const base = resolve(backupDir);
  const full = resolve(base, name);
  // Defence in depth: the regex already forbids separators and "..".
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/[id]/backup — List backups
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!((await hasPermission(auth.userId, "servers.backup")) || (await hasPermission(auth.userId, "servers.restore")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const [server] = await db.select({ installPath: gameServers.installPath, userId: gameServers.userId }).from(gameServers).where(eq(gameServers.id, Number(id))).limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const backupDir = join(server.installPath, "gsm-backups");
    try {
      const files = await readdir(backupDir);
      const backups = [];
      for (const f of files.filter((f) => f.endsWith(".tar.gz"))) {
        const s = await stat(join(backupDir, f)).catch(() => null);
        backups.push({ name: f, sizeMb: s ? Math.round(s.size / 1024 / 1024 * 10) / 10 : 0, created: s?.mtime.toISOString() || "" });
      }
      backups.sort((a, b) => b.created.localeCompare(a.created));
      return NextResponse.json({ backups });
    } catch { return NextResponse.json({ backups: [] }); }
  } catch { return NextResponse.json({ backups: [] }); }
}

// POST /api/servers/[id]/backup — Create or restore backup
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const action = body.action as string; // "create" | "restore"

  if (action === "restore") {
    if (!(await hasPermission(auth.userId, "servers.restore"))) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }
  } else if (!(await hasPermission(auth.userId, "servers.backup"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const [server] = await db.select({ installPath: gameServers.installPath, userId: gameServers.userId, name: gameServers.name, status: gameServers.status }).from(gameServers).where(eq(gameServers.id, Number(id))).limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const backupDir = join(server.installPath, "gsm-backups");
    await mkdir(backupDir, { recursive: true });

    if (action === "create") {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupName = `backup-${ts}.tar.gz`;
      const backupPath = join(backupDir, backupName);

      const result = await runCmd(
        "tar",
        ["czf", backupPath, "--exclude=gsm-backups", "--exclude=steamcmd", "--exclude=.steam", "-C", server.installPath, "."],
        server.installPath,
        600000
      );

      return NextResponse.json({ ok: true, message: `Backup created: ${backupName}`, name: backupName, output: result.stdout.slice(-2000) });
    }

    if (action === "restore") {
      if (server.status === "running") return NextResponse.json({ error: "Stop the server before restoring" }, { status: 400 });
      const backupName = body.name as string;
      if (!backupName) return NextResponse.json({ error: "Backup name required" }, { status: 400 });

      const backupPath = resolveBackupPath(backupDir, backupName);
      if (!backupPath) {
        return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
      }
      // Only restore something this panel actually produced.
      try {
        const s = await stat(backupPath);
        if (!s.isFile()) throw new Error("not a file");
      } catch {
        return NextResponse.json({ error: "Backup not found" }, { status: 404 });
      }

      const result = await runCmd("tar", ["xzf", backupPath, "-C", server.installPath], server.installPath, 600000);

      return NextResponse.json({ ok: true, message: `Restored from ${backupName}`, output: result.stdout.slice(-2000) });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: unknown) {
    return apiError(e, "Backup operation failed");
  }
}

// Runs a binary with an argument array — never a shell string, so nothing in
// `args` can be interpreted as a command.
async function runCmd(file: string, args: string[], cwd: string, timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    let stdout = ""; let stderr = ""; let done = false;
    const child: ChildProcess = spawn(file, args, { cwd });
    const timer = setTimeout(() => { if (!done) { done = true; child.kill("SIGKILL"); reject(new Error("Timed out")); } }, timeout);
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e: Error) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code: number | null) => { if (!done) { done = true; clearTimeout(timer); if (code === 0) resolvePromise({ stdout, stderr }); else reject(new Error(`Exit ${code}\n${stderr}`)); } });
  });
}
