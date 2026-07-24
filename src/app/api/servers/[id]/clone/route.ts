import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

// POST /api/servers/[id]/clone — Clone a server with all settings
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [source] = await db
      .select()
      .from(gameServers)
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!source) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && source.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const newName = body.name || `${source.name} (Clone)`;
    const newPort = body.port || source.port + 1;
    const newPath = body.installPath || `${source.installPath}-clone`;

    const [clone] = await db.insert(gameServers).values({
      userId: auth.userId,
      nodeId: source.nodeId,
      gameId: source.gameId,
      name: newName,
      ipv4: source.ipv4,
      ipv6: source.ipv6,
      port: newPort,
      queryPort: newPort + 1,
      rconPort: source.rconPort ? newPort + 2 : null,
      installPath: newPath,
      status: "stopped",
      config: source.config,
      variables: source.variables,
      autoRestart: source.autoRestart,
      autoStart: false,
      maxRamMb: source.maxRamMb,
      maxCpuPercent: source.maxCpuPercent,
      discordWebhook: source.discordWebhook,
      discordNotifyStart: source.discordNotifyStart,
      discordNotifyStop: source.discordNotifyStop,
      discordNotifyRestart: source.discordNotifyRestart,
      discordNotifyCrash: source.discordNotifyCrash,
    }).returning();

    return NextResponse.json({
      ok: true,
      message: `Cloned "${source.name}" as "${newName}". Run Install Files on the clone to set up game files.`,
      server: clone,
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Clone failed" }, { status: 500 });
  }
}
