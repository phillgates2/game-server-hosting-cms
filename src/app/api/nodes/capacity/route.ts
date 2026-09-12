import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, nodeMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, desc, eq, gte } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  forecastDaysUntil,
  capacityVerdict,
  type CapacitySample,
} from "@/lib/capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Look back window for the fit. */
const WINDOW_DAYS = 7;
/** Raw rows fetched per node before stride-sampling. */
const MAX_ROWS_PER_NODE = 4_000;
/** Keep the fit honest: at most ~one sample per 30 minutes. */
const MAX_FIT_SAMPLES = 336;

// GET /api/nodes/capacity — growth forecasts per node. Derived from heartbeat
// metrics, so it carries the same permission as the metrics endpoints.
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.view.metrics", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const nodeList = await db.select({ id: nodes.id, name: nodes.name }).from(nodes).limit(200);
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const now = Date.now();

    const out: Array<{
      nodeId: number;
      name: string;
      disk: { usedPct: number | null; days: number | null; tone: string; label: string };
      ram: { usedPct: number | null; days: number | null; tone: string; label: string };
    }> = [];

    for (const node of nodeList) {
      const rows = await db
        .select({
          recordedAt: nodeMetrics.recordedAt,
          diskUsedMb: nodeMetrics.diskUsedMb,
          diskTotalMb: nodeMetrics.diskTotalMb,
          ramUsedMb: nodeMetrics.ramUsedMb,
          ramTotalMb: nodeMetrics.ramTotalMb,
        })
        .from(nodeMetrics)
        .where(and(eq(nodeMetrics.nodeId, node.id), gte(nodeMetrics.recordedAt, since)))
        .orderBy(desc(nodeMetrics.recordedAt))
        .limit(MAX_ROWS_PER_NODE)
        .then((r) => r.reverse());

      // Stride-sample so the fit sees evenly spread points, not one burst.
      const stride = Math.max(1, Math.floor(rows.length / MAX_FIT_SAMPLES));
      const sampled = rows.filter((_, i) => i % stride === 0);

      const last = sampled[sampled.length - 1];
      const diskSamples: CapacitySample[] = sampled
        .filter((r) => r.diskUsedMb != null)
        .map((r) => ({ t: r.recordedAt.getTime(), v: r.diskUsedMb as number }));
      const ramSamples: CapacitySample[] = sampled
        .filter((r) => r.ramUsedMb != null)
        .map((r) => ({ t: r.recordedAt.getTime(), v: r.ramUsedMb as number }));

      const diskTarget = last?.diskTotalMb ?? null;
      const ramTarget = last?.ramTotalMb ?? null;

      const diskFc =
        diskTarget != null
          ? forecastDaysUntil(diskSamples, diskTarget, now)
          : { slopePerDay: null, daysUntilTarget: null };
      const ramFc =
        ramTarget != null
          ? forecastDaysUntil(ramSamples, ramTarget, now)
          : { slopePerDay: null, daysUntilTarget: null };

      const diskVerdict = capacityVerdict(diskFc.daysUntilTarget);
      const ramVerdict = capacityVerdict(ramFc.daysUntilTarget);

      out.push({
        nodeId: node.id,
        name: node.name,
        disk: {
          usedPct:
            last?.diskTotalMb && last.diskUsedMb != null
              ? Math.round((last.diskUsedMb / last.diskTotalMb) * 100)
              : null,
          days: diskFc.daysUntilTarget,
          tone: diskVerdict.tone,
          label: diskVerdict.label,
        },
        ram: {
          usedPct:
            last?.ramTotalMb && last.ramUsedMb != null
              ? Math.round((last.ramUsedMb / last.ramTotalMb) * 100)
              : null,
          days: ramFc.daysUntilTarget,
          tone: ramVerdict.tone,
          label: ramVerdict.label,
        },
      });
    }

    return NextResponse.json({ windowDays: WINDOW_DAYS, nodes: out });
  } catch (e: unknown) {
    return apiError(e, "Could not load capacity forecasts", 500);
  }
}
