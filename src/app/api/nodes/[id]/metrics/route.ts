import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, nodeMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, eq, gte } from "drizzle-orm";
import { clampRangeHours, downsampleSeries } from "@/lib/metrics-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RAW_ROWS = 20_000;

// GET /api/nodes/[id]/metrics?hours=N — CPU/RAM history from node heartbeats
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Heartbeat history can include every machine an operator attached, so it
  // follows the nodes-panel rules rather than ordinary server viewing.
  if (!(await hasPermission(auth.userId, "nodes.view.metrics"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const nodeId = Number(id);
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return NextResponse.json({ error: "Invalid node id" }, { status: 400 });
  }

  try {
    const [node] = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const hours = clampRangeHours(req.nextUrl.searchParams.get("hours"));
    const since = new Date(Date.now() - hours * 3_600_000);

    const rows = await db
      .select({
        recordedAt: nodeMetrics.recordedAt,
        cpuPercent: nodeMetrics.cpuPercent,
        ramUsedMb: nodeMetrics.ramUsedMb,
        ramTotalMb: nodeMetrics.ramTotalMb,
      })
      .from(nodeMetrics)
      .where(and(eq(nodeMetrics.nodeId, nodeId), gte(nodeMetrics.recordedAt, since)))
      .orderBy(nodeMetrics.recordedAt)
      .limit(MAX_RAW_ROWS);

    const cpu = downsampleSeries(
      rows
        .filter((r) => r.cpuPercent !== null)
        .map((r) => ({ t: r.recordedAt.getTime(), v: Math.round((r.cpuPercent as number) * 100) / 100 }))
    );
    const ram = downsampleSeries(
      rows
        .filter((r) => r.ramUsedMb !== null && r.ramTotalMb)
        .map((r) => ({
          t: r.recordedAt.getTime(),
          v: Math.round(((r.ramUsedMb as number) / (r.ramTotalMb as number)) * 10000) / 100,
        }))
    );

    if (req.nextUrl.searchParams.get("format") === "csv") {
      const { seriesToCsv } = await import("@/lib/csv-export");
      const csv = seriesToCsv([
        { name: "cpu_percent", points: cpu },
        { name: "ram_percent", points: ram },
      ]);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="node-${nodeId}-metrics-${hours}h.csv"`,
        },
      });
    }

    const { detectAnomalies } = await import("@/lib/anomaly");
    const anomalies = {
      cpu: detectAnomalies(cpu).slice(-20),
      ram: detectAnomalies(ram).slice(-20),
    };

    return NextResponse.json({ nodeId, hours, samples: rows.length, cpu, ram, anomalies });
  } catch {
    return NextResponse.json({ error: "Could not load metrics" }, { status: 500 });
  }
}
