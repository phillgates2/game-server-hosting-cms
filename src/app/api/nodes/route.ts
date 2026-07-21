import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, gameServers, nodeMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, desc, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const nodeList = await db
      .select({
        id: nodes.id,
        name: nodes.name,
        description: nodes.description,
        hostname: nodes.hostname,
        ipv4: nodes.ipv4,
        ipv6: nodes.ipv6,
        sshPort: nodes.sshPort,
        status: nodes.status,
        isLocal: nodes.isLocal,
        isDefault: nodes.isDefault,
        maxServers: nodes.maxServers,
        maxRamMb: nodes.maxRamMb,
        maxDiskMb: nodes.maxDiskMb,
        gameServerPath: nodes.gameServerPath,
        location: nodes.location,
        provider: nodes.provider,
        lastHeartbeat: nodes.lastHeartbeat,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .orderBy(desc(nodes.isDefault), desc(nodes.isLocal), nodes.name);

    // Get server counts
    const counts: Record<number, { total: number; running: number }> = {};
    try {
      const sc = await db
        .select({
          nodeId: gameServers.nodeId,
          count: sql<number>`count(*)::int`,
          running: sql<number>`count(*) filter (where ${gameServers.status} = 'running')::int`,
        })
        .from(gameServers)
        .groupBy(gameServers.nodeId);
      for (const s of sc) {
        if (s.nodeId) counts[s.nodeId] = { total: s.count, running: s.running };
      }
    } catch {
      // Table might not have data yet
    }

    const nodesWithData = nodeList.map((node) => ({
      ...node,
      serverCount: counts[node.id]?.total || 0,
      runningServers: counts[node.id]?.running || 0,
      metrics: null,
    }));

    return NextResponse.json({ nodes: nodesWithData });
  } catch (e) {
    console.error("GET /api/nodes error:", e);
    return NextResponse.json({ nodes: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      name, description, hostname, ipv4, ipv6, sshPort, sshUser,
      sshKeyPath, sshPassword, apiUrl, apiKey, maxServers, maxRamMb,
      maxDiskMb, gameServerPath, steamcmdPath, isLocal, isDefault,
      location, provider,
    } = body;

    if (!name || !hostname) {
      return NextResponse.json({ error: "Name and hostname are required" }, { status: 400 });
    }

    if (isDefault) {
      await db.update(nodes).set({ isDefault: false });
    }

    const [node] = await db
      .insert(nodes)
      .values({
        name,
        description: description || null,
        hostname,
        ipv4: ipv4 || null,
        ipv6: ipv6 || null,
        sshPort: sshPort || 22,
        sshUser: sshUser || "root",
        sshKeyPath: sshKeyPath || null,
        sshPassword: sshPassword || null,
        apiUrl: apiUrl || null,
        apiKey: apiKey || null,
        maxServers: maxServers || 10,
        maxRamMb: maxRamMb || 16384,
        maxDiskMb: maxDiskMb || 100000,
        gameServerPath: gameServerPath || "/opt/gameservers",
        steamcmdPath: steamcmdPath || "/opt/steamcmd",
        isLocal: isLocal || false,
        isDefault: isDefault || false,
        status: "offline",
        location: location || null,
        provider: provider || null,
      })
      .returning();

    return NextResponse.json({ node }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
