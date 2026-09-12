import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { inArray } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  validateBatchRequest,
  partitionBatch,
  type BatchAction,
} from "@/lib/batch-ops";
import {
  planRollingRestart,
  parseRollingFlag,
  shouldContinueRolling,
  formatRollingRestartSummary,
  SETTLE_MS,
} from "@/lib/rolling-restart";
// The real per-server handler: delegating keeps every existing rail —
// ownership, crash-loop breaker, remote-node dispatch, Discord pings — intact.
import { POST as processServerAction } from "../[id]/process/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/** Build the internal request handed to the per-server handler. */
function subRequest(id: number, action: BatchAction, source: Headers): NextRequest {
  const headers = new Headers(source);
  // Strip hop-specific values so the fresh body is not misread.
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const inner = new Request(`http://batch.internal/api/servers/${id}/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action }),
    // @ts-expect-error undici requires duplex when a body is present
    duplex: "half",
  });
  return new NextRequest(inner);
}

// POST /api/servers/batch — { action: "start"|"stop"|"restart", serverIds: number[] }
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const valid = validateBatchRequest(body);
  if (!valid.ok || !valid.value) {
    return NextResponse.json({ error: valid.error || "Invalid batch request" }, { status: 400 });
  }
  const { action, serverIds } = valid.value;

  // Fail fast with the same permission rules the per-server route enforces,
  // so a caller without the right cannot probe which ids exist.
  const canAct =
    action === "restart"
      ? (await hasPermission(auth.userId, "servers.restart", auth.keyScope)) ||
        (await hasPermission(auth.userId, "servers.start_stop", auth.keyScope))
      : await hasPermission(auth.userId, "servers.start_stop", auth.keyScope);
  if (!canAct) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const rows = await db
      .select({ id: gameServers.id, name: gameServers.name, userId: gameServers.userId, status: gameServers.status })
      .from(gameServers)
      .where(inArray(gameServers.id, serverIds));

    const { dispatchable, skippedIds } = partitionBatch(
      rows,
      serverIds,
      auth.role === "admin",
      auth.userId
    );

    const rolling = action === "restart" && parseRollingFlag(body);
    if (rolling) {
      return runRollingRestart({ req, auth, dispatchable, skippedIds, requestedCount: serverIds.length });
    }

    const results = await Promise.all(
      dispatchable.map(async (server) => {
        try {
          const res = await processServerAction(subRequest(server.id, action, req.headers), {
            params: Promise.resolve({ id: String(server.id) }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { id: server.id, name: server.name, ok: res.ok, error: data.error ?? null };
        } catch (e: unknown) {
          return {
            id: server.id,
            name: server.name,
            ok: false,
            error: e instanceof Error ? e.message : "Dispatch failed",
          };
        }
      })
    );

    const okCount = results.filter((r) => r.ok).length;

    // One audit line per batch, best-effort — auditing must never break the op.
    try {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId,
        action: "server.batch",
        entityType: "server",
        entityId: null,
        details: {
          action,
          requested: serverIds.length,
          ok: okCount,
          failed: results.length - okCount,
          skipped: skippedIds.length,
        },
        ipAddress: ip.slice(0, 45),
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({
      action,
      requested: serverIds.length,
      ok: okCount,
      failed: results.length - okCount,
      skippedIds,
      results,
    });
  } catch (e: unknown) {
    return apiError(e, "Batch operation failed", 500);
  }
}

// ── Rolling restart ─────────────────────────────────────────────────────────
// Restart one server at a time; each must be alive again after SETTLE_MS
// before the next one is touched. First failure halts the sweep.

async function verifyServerAlive(serverId: number): Promise<boolean> {
  const { eq } = await import("drizzle-orm");
  const { nodes } = await import("@/db/schema");
  const [row] = await db
    .select({ status: gameServers.status, pid: gameServers.pid, nodeIsLocal: nodes.isLocal })
    .from(gameServers)
    .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
    .where(eq(gameServers.id, serverId))
    .limit(1);
  if (!row || row.status !== "running" || row.pid === null) return false;
  if (row.nodeIsLocal === false) return true; // remote: agent-reported status is our evidence
  const { isProcessAlive } = await import("@/lib/process-control");
  return isProcessAlive(row.pid);
}

async function runRollingRestart(opts: {
  req: NextRequest;
  auth: { userId: number | string; role: string };
  dispatchable: Array<{ id: number; name: string; status: string }>;
  skippedIds: number[];
  requestedCount: number;
}): Promise<NextResponse> {
  const { req, auth, dispatchable, skippedIds, requestedCount } = opts;

  const plan = planRollingRestart(dispatchable);
  const results: Array<{ id: number; name: string; ok: boolean; skipped?: string; error?: string | null }> =
    plan.blocked.map(({ server, reason }) => ({ id: server.id, name: server.name, ok: false, skipped: reason }));

  let haltedAt: string | null = null;
  let restarted = 0;

  for (let i = 0; i < plan.eligible.length; i++) {
    const server = plan.eligible[i];
    let ok = false;
    let error: string | null = null;
    try {
      const res = await processServerAction(subRequest(server.id, "restart", req.headers), {
        params: Promise.resolve({ id: String(server.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; alive?: boolean };
      ok = res.ok && data.alive === true;
      error = data.error ?? (res.ok && data.alive !== true ? "process did not come up" : null);
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "Dispatch failed";
    }

    // Give it the settle window, then verify for real.
    const verified = ok
      ? await new Promise<boolean>((resolve) => {
          setTimeout(() => void verifyServerAlive(server.id).then(resolve).catch(() => resolve(false)), SETTLE_MS);
        })
      : false;

    results.push({ id: server.id, name: server.name, ok: verified, error: verified ? null : error ?? "did not come back after restart" });
    if (!shouldContinueRolling(verified)) {
      haltedAt = server.name;
      // Everyone still waiting stays untouched — that is the whole point.
      for (const rest of plan.eligible.slice(i + 1)) {
        results.push({ id: rest.id, name: rest.name, ok: false, skipped: "rolling restart halted before this server" });
      }
      break;
    }
    restarted += 1;
  }

  const summary = formatRollingRestartSummary({
    haltedAt,
    restarted,
    blockedCount: results.filter((r) => r.skipped).length + skippedIds.length,
  });

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    await db.insert(auditLog).values({
      userId: auth.userId as number,
      action: "server.batch",
      entityType: "server",
      entityId: null,
      details: {
        action: "restart",
        mode: "rolling",
        haltedAt,
        requested: requestedCount,
        ok: restarted,
        failed: results.filter((r) => !r.ok && !r.skipped).length,
        skipped: results.filter((r) => r.skipped).length + skippedIds.length,
        summary,
      },
      ipAddress: ip.slice(0, 45),
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({
    action: "restart",
    rolling: true,
    haltedAt,
    requested: requestedCount,
    ok: restarted,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skippedIds,
    results,
    summary,
  });
}
