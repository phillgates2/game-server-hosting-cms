import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { access, constants } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/servers/[id]/update — Re-run SteamCMD app_update or re-download latest
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!((await hasPermission(auth.userId, "servers.install")) || (await hasPermission(auth.userId, "games.install")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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

    // Check for the shared system SteamCMD install
    const steamcmdPath = "/opt/steamcmd/steamcmd.sh";
    const hasSteamcmd = await access(steamcmdPath, constants.X_OK).then(() => true).catch(() => false);

    if (!hasSteamcmd || !server.steamAppId) {
      return NextResponse.json({ error: "This server does not use SteamCMD or SteamCMD is not installed on the host. Use Install Files instead." }, { status: 400 });
    }

    await db.update(gameServers).set({ status: "installing", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    const { runSteamUpdate } = await import("@/lib/server-update-runner");
    const result = await runSteamUpdate({
      installPath: server.installPath,
      gameName: server.gameName || "game",
      steamAppId: String(server.steamAppId),
    });

    await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    return NextResponse.json({ ok: true, message: `${server.gameName} updated successfully`, output: result.stdout.slice(-4000) });
  } catch (e: unknown) {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    try { await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, Number(id))); } catch { /**/ }
    return NextResponse.json({ error: err.message || "Update failed", output: err.stdout?.slice(-4000) || "" }, { status: 500 });
  }
}
