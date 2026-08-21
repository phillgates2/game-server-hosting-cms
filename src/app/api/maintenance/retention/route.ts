import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { pruneMetrics, pruneAuditLog, retentionStats } from "@/lib/retention";

async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return null;
  const allowed = await hasPermission(auth.userId, "panel.settings");
  return allowed ? auth : null;
}

/**
 * GET /api/maintenance/retention
 *
 * Row counts for the append-only tables plus the configured retention windows,
 * so an operator can see how much history is being kept.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  try {
    return NextResponse.json(await retentionStats());
  } catch (e: unknown) {
    return apiError(e, "Could not read retention stats", 500);
  }
}

/**
 * POST /api/maintenance/retention
 *
 * Force a prune now instead of waiting for the probabilistic cleanup that runs
 * off node heartbeats. Body: { "target": "metrics" | "audit" | "all" }.
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let target = "metrics";
  try {
    const body = await req.json();
    if (typeof body?.target === "string") target = body.target;
  } catch {
    // No body is fine - default to pruning metrics.
  }

  if (!["metrics", "audit", "all"].includes(target)) {
    return NextResponse.json(
      { error: 'target must be one of "metrics", "audit", "all"' },
      { status: 400 }
    );
  }

  try {
    const result: Record<string, number> = {};
    if (target === "metrics" || target === "all") result.metricRowsDeleted = await pruneMetrics();
    if (target === "audit" || target === "all") result.auditRowsDeleted = await pruneAuditLog();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    return apiError(e, "Prune failed", 500);
  }
}
