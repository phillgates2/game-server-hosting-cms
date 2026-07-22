import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { sendRcon, detectRconProtocol } from "@/lib/rcon";
import { eq } from "drizzle-orm";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// POST /api/servers/[id]/rcon — Send RCON command
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.console"))) {
    return NextResponse.json({ error: "Permission denied: servers.console required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ipv4: gameServers.ipv4,
        ipv6: gameServers.ipv6,
        port: gameServers.port,
        rconPort: gameServers.rconPort,
        status: gameServers.status,
        variables: gameServers.variables,
        config: gameServers.config,
        userId: gameServers.userId,
        gameSlug: gameDefinitions.slug,
        gameName: gameDefinitions.name,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

    // Check ownership or admin
    if (server.userId !== auth.userId && !(await hasPermission(auth.userId, "servers.edit"))) {
      return NextResponse.json({ error: "Not your server" }, { status: 403 });
    }

    const body = await req.json();
    const { command } = body;
    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "Command required" }, { status: 400 });
    }

    // Get RCON password from server variables or config
    const vars = asRecord(server.variables);
    const config = asRecord(server.config);
    const rconPassword = String(
      body.password
      || vars.RCON_PASSWORD
      || config.RCON_PASSWORD
      || config.rcon_password
      || vars.ADMIN_PASSWORD
      || config.AdminPassword
      || ""
    );

    if (!rconPassword) {
      return NextResponse.json({
        error: "No RCON password configured. Set RCON_PASSWORD in server variables.",
      }, { status: 400 });
    }

    // Determine host and port
    const host = server.ipv4 || "127.0.0.1";
    const rconPort = server.rconPort || server.port;
    const protocol = detectRconProtocol(server.gameSlug || "");

    const result = await sendRcon(protocol, host, rconPort, rconPassword, command);

    return NextResponse.json({
      ...result,
      protocol,
      server: server.name,
      game: server.gameName,
      command,
    });
  } catch (e: unknown) {
    return NextResponse.json({
      success: false,
      response: "",
      error: e instanceof Error ? e.message : "RCON failed",
      duration: 0,
    }, { status: 500 });
  }
}

// GET /api/servers/[id]/rcon — Get RCON info for this server
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ipv4: gameServers.ipv4,
        port: gameServers.port,
        rconPort: gameServers.rconPort,
        status: gameServers.status,
        gameSlug: gameDefinitions.slug,
        gameName: gameDefinitions.name,
        gameIcon: gameDefinitions.iconEmoji,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const protocol = detectRconProtocol(server.gameSlug || "");

    return NextResponse.json({
      server: server.name,
      game: server.gameName,
      gameIcon: server.gameIcon,
      host: server.ipv4 || "127.0.0.1",
      port: server.rconPort || server.port,
      protocol,
      status: server.status,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
