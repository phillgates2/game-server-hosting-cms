import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { nodes, gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { footprintForSlug, estimateCapacity, formatCapacityAnswer } from "@/lib/capacity-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/nodes/[id]/capacity?slug=tf2 — what-if capacity answer
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const [node] = await db
      .select({
        id: nodes.id,
        name: nodes.name,
        maxRamMb: nodes.maxRamMb,
        maxDiskMb: nodes.maxDiskMb,
        maxServers: nodes.maxServers,
      })
      .from(nodes)
      .where(eq(nodes.id, Number(id)))
      .limit(1);
    if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");

    let gameName = "generic";
    let footprint = footprintForSlug(slug);
    if (slug) {
      const [game] = await db
        .select({ name: gameDefinitions.name, slug: gameDefinitions.slug })
        .from(gameDefinitions)
        .where(eq(gameDefinitions.slug, slug))
        .limit(1);
      if (game) gameName = game.name;
    }

    const [{ count: serverCount } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gameServers)
      .where(eq(gameServers.nodeId, node.id));

    // Latest usage sample, same source the nodes list uses.
    let usedRamMb: number | null = null;
    let usedDiskMb: number | null = null;
    try {
      const rows = await pool.query(
        `SELECT ram_used_mb, disk_used_mb FROM node_metrics WHERE node_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [node.id]
      );
      const r = rows.rows[0] as { ram_used_mb: string | number | null; disk_used_mb: string | number | null } | undefined;
      usedRamMb = r?.ram_used_mb == null ? null : Number(r.ram_used_mb);
      usedDiskMb = r?.disk_used_mb == null ? null : Number(r.disk_used_mb);
    } catch { /* no metrics yet */ }

    const estimate = estimateCapacity(
      {
        maxRamMb: node.maxRamMb,
        maxDiskMb: node.maxDiskMb,
        maxServers: node.maxServers,
        usedRamMb,
        usedDiskMb,
        serverCount,
      },
      footprint
    );

    return NextResponse.json({
      node: node.name,
      game: gameName,
      footprint,
      serverCount,
      usedRamMb,
      usedDiskMb,
      fits: Number.isFinite(estimate.fits) ? estimate.fits : null,
      limiters: estimate.limiters,
      approximate: estimate.approximate,
      answer: formatCapacityAnswer({ nodeName: node.name, gameName, estimate }),
    });
  } catch (e: unknown) {
    return apiError(e, "Capacity check failed", 500);
  }
}
