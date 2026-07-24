import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { access, constants, readFile } from "fs/promises";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findBash(): Promise<string> {
  for (const p of ["/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash"]) {
    try { await access(p, constants.X_OK); return p; } catch { /**/ }
  }
  return "bash";
}

// POST /api/servers/[id]/update — Re-run SteamCMD app_update or re-download latest
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id, userId: gameServers.userId, name: gameServers.name,
        installPath: gameServers.installPath, status: gameServers.status,
        steamAppId: gameDefinitions.steamAppId, gameName: gameDefinitions.name,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (server.status === "running") return NextResponse.json({ error: "Stop the server before updating" }, { status: 400 });

    // Check for steamcmd in the install path
    const steamcmdPath = join(server.installPath, "steamcmd", "steamcmd.sh");
    const hasSteamcmd = await access(steamcmdPath, constants.X_OK).then(() => true).catch(() => false);

    if (!hasSteamcmd || !server.steamAppId) {
      return NextResponse.json({ error: "This server does not use SteamCMD or steamcmd is not installed. Use Install Files instead." }, { status: 400 });
    }

    await db.update(gameServers).set({ status: "installing", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    const bashPath = await findBash();
    const script = `#!/usr/bin/env bash
set -e
cd "${server.installPath}/steamcmd"
export HOME="${server.installPath}"
echo "Updating ${server.gameName || "game"} (AppID: ${server.steamAppId})..."
./steamcmd.sh +force_install_dir "${server.installPath}" +login anonymous +app_update ${server.steamAppId} validate +quit
echo "Update complete"
`;

    const { mkdtemp, writeFile, chmod, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const tempDir = await mkdtemp(join(tmpdir(), "gsm-update-"));
    const scriptPath = join(tempDir, "update.sh");
    await writeFile(scriptPath, script, "utf8");
    await chmod(scriptPath, 0o755);

    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = ""; let stderr = ""; let done = false;
      const child: ChildProcess = spawn(bashPath, [scriptPath], { cwd: tempDir, env: { ...process.env as NodeJS.ProcessEnv, HOME: server.installPath } });
      const timer = setTimeout(() => { if (!done) { done = true; child.kill("SIGKILL"); reject(new Error("Update timed out")); } }, 1000 * 60 * 30);
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("error", (e: Error) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
      child.on("close", (code: number | null) => { if (!done) { done = true; clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else { const e = new Error(`Exit ${code}`); (e as unknown as Record<string,unknown>).stdout = stdout; (e as unknown as Record<string,unknown>).stderr = stderr; reject(e); } } });
    });

    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    return NextResponse.json({ ok: true, message: `${server.gameName} updated successfully`, output: result.stdout.slice(-4000) });
  } catch (e: unknown) {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    try { await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, Number(id))); } catch { /**/ }
    return NextResponse.json({ error: err.message || "Update failed", output: err.stdout?.slice(-4000) || "" }, { status: 500 });
  }
}
