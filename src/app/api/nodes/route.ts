import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, gameServers, nodeMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, desc, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { publicNode } from "@/lib/server-lifecycle";
import { createLogger } from "@/lib/logger";

const log = createLogger("nodes");

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    // Pre-maintenance installs lack the column; add lazily so the select works.
    try {
      await db.execute(sql`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT FALSE`);
    } catch { /* best-effort */ }

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
        maintenanceMode: nodes.maintenanceMode,
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

    // Latest heartbeat metrics per node (best-effort: a fresh install has no
    // node_metrics rows yet, and the picker degrades gracefully without them).
    // Heartbeat history carries the dedicated nodes.view.metrics permission,
    // so the list only embeds it for callers who hold that permission —
    // plain nodes.view (moderators) must not leak CPU/RAM/disk readings.
    const canSeeMetrics = await hasPermission(auth.userId, "nodes.view.metrics", auth.keyScope);
    const latestMetrics: Record<number, {
      cpuPercent: number | null;
      ramUsedMb: number | null;
      ramTotalMb: number | null;
      diskUsedMb: number | null;
      diskTotalMb: number | null;
      recordedAt: number | null;
    }> = {};
    if (canSeeMetrics) try {
      const result = await db.execute(sql`
        SELECT DISTINCT ON (node_id)
          node_id, cpu_percent, ram_used_mb, ram_total_mb,
          disk_used_mb, disk_total_mb,
          EXTRACT(EPOCH FROM recorded_at) * 1000 AS ts
        FROM node_metrics
        ORDER BY node_id, recorded_at DESC
      `);
      const rawRows: unknown = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
      for (const r of rawRows as Array<Record<string, unknown>>) {
        const nodeId = Number(r.node_id);
        if (!Number.isFinite(nodeId)) continue;
        latestMetrics[nodeId] = {
          cpuPercent: r.cpu_percent == null ? null : Number(r.cpu_percent),
          ramUsedMb: r.ram_used_mb == null ? null : Number(r.ram_used_mb),
          ramTotalMb: r.ram_total_mb == null ? null : Number(r.ram_total_mb),
          diskUsedMb: r.disk_used_mb == null ? null : Number(r.disk_used_mb),
          diskTotalMb: r.disk_total_mb == null ? null : Number(r.disk_total_mb),
          recordedAt: r.ts == null ? null : Number(r.ts),
        };
      }
    } catch {
      // node_metrics may not exist yet — metrics stay null.
    }

    const nodesWithData = nodeList.map((node) => ({
      ...node,
      serverCount: counts[node.id]?.total || 0,
      runningServers: counts[node.id]?.running || 0,
      metrics: latestMetrics[node.id] ?? null,
    }));

    return NextResponse.json({ nodes: nodesWithData });
  } catch (e) {
    log.exception("failed to list nodes", e);
    return NextResponse.json({ nodes: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "nodes.create", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
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

    // Echoing the row back would return the SSH credentials just submitted.
    return NextResponse.json({ node: publicNode(node) }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}
