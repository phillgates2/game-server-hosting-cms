import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, nodes, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { join, dirname } from "node:path";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { apiError } from "@/lib/api-error";
import { resolveBackupPath, precheckRestore } from "@/lib/backup-restore";
import { latestBackupName, assessDrill, DRILL_MAX_ENTRIES, type DrillEntry } from "@/lib/backup-drill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const child = spawn(/*turbopackIgnore: true*/ cmd, args, { cwd });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => {
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    });
    child.on("close", (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
}

// POST /api/servers/[id]/restore — { backup?: name } (default: newest)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.restore", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown = {};
  try { body = await req.json(); } catch { body = {}; }
  const requestedName = (body as Record<string, unknown>)?.backup ?? null;

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  let stagingContainer: string | null = null;
  let swapped = false;

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        userId: gameServers.userId,
        status: gameServers.status,
        pid: gameServers.pid,
        installPath: gameServers.installPath,
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

    // Gate 1: stopped, dead, local.
    const { isProcessAlive } = await import("@/lib/process-control");
    const alive = server.pid ? isProcessAlive(server.pid) : false;
    const pre = precheckRestore({ status: server.status, processAlive: alive, nodeIsLocal: server.nodeIsLocal });
    if (!pre.ok) return NextResponse.json({ error: pre.reason }, { status: 400 });

    const installPath = String(server.installPath);
    const backupDir = join(installPath, "gsm-backups");
    let names: string[] = [];
    try { names = await readdir(backupDir); } catch {
      return NextResponse.json({ error: "No backups found — create one first." }, { status: 404 });
    }
    const backupName = requestedName === null ? latestBackupName(names) : String(requestedName);
    if (!backupName) return NextResponse.json({ error: "No backups found — create one first." }, { status: 404 });
    const backupPath = resolveBackupPath(backupDir, backupName);
    if (!backupPath) return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
    try { await stat(backupPath); } catch {
      return NextResponse.json({ error: "That backup file no longer exists" }, { status: 404 });
    }

    // Gate 2: full extract into scratch + drill assessment BEFORE touching live files.
    stagingContainer = await mkdtemp(join(dirname(installPath), ".gsm-restore-"));
    const staging = join(stagingContainer, "staged");
    await mkdir(staging, { recursive: true });
    try {
      await runCmd("tar", ["xzf", backupPath, "-C", staging], staging, 900_000);
    } catch (e: unknown) {
      return NextResponse.json(
        { error: `The backup did not extract cleanly (${e instanceof Error ? e.message : "tar failed"}) — live files untouched.` },
        { status: 500 }
      );
    }

    const entries: DrillEntry[] = [];
    const stack = [staging];
    while (stack.length > 0 && entries.length < DRILL_MAX_ENTRIES) {
      const dir = stack.pop() as string;
      let children: string[] = [];
      try { children = await readdir(dir); } catch { continue; }
      for (const child of children) {
        const full = join(dir, child);
        let st;
        try { st = await (await import("node:fs/promises")).lstat(full); } catch { continue; }
        if (st.isDirectory()) {
          stack.push(full);
          entries.push({ name: full.slice(staging.length + 1), size: 0, isFile: false });
        } else {
          entries.push({ name: full.slice(staging.length + 1), size: st.size, isFile: true });
        }
      }
    }
    const verdict = assessDrill(entries);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: `The backup failed verification (${verdict.reason}) — live files untouched.` },
        { status: 500 }
      );
    }

    // Gate 3: swap. Preserve gsm-backups across the restore — restore points
    // must survive the restore itself.
    const backupsKept = join(stagingContainer, "gsm-backups-keep");
    let keptBackups = false;
    try {
      await stat(backupDir);
      await rename(backupDir, backupsKept);
      keptBackups = true;
    } catch { /* no backups dir inside — nothing to preserve */ }

    const oldPath = installPath + ".gsm-restore-old";
    await rm(oldPath, { recursive: true, force: true }).catch(() => undefined);
    await rename(installPath, oldPath);
    await rename(staging, installPath);
    swapped = true;
    if (keptBackups) {
      await rename(backupsKept, join(installPath, "gsm-backups")).catch(() => undefined);
    }

    // The old tree only goes away once the new one is proven in place.
    try {
      const check = await readdir(installPath);
      if (check.length > 0) await rm(oldPath, { recursive: true, force: true });
    } catch { /* old copy lingers as a manual fallback */ }

    try {
      const { recordServerEvent } = await import("@/lib/server-events");
      await recordServerEvent(server.id, "restored", `restored from ${backupName}`);
    } catch { /* best-effort */ }

    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "server.restore",
        entityType: "server",
        entityId: server.id,
        details: { backup: backupName, serverName: server.name },
        ipAddress: ip.slice(0, 45),
      });
    } catch { /* best-effort */ }

    return NextResponse.json({
      ok: true,
      backup: backupName,
      message: `Restored "${server.name}" from ${backupName}. Start the server when ready.`,
    });
  } catch (e: unknown) {
    if (!swapped && stagingContainer) {
      await rm(stagingContainer, { recursive: true, force: true }).catch(() => undefined);
    }
    return apiError(e, "Restore failed — check the server directory before starting it", 500);
  }
}
