import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { inArray } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { validateBatchServerIds, partitionBatch } from "@/lib/batch-ops";
import {
  planStagedRollout,
  parseStagedFlag,
  shouldSweepRest,
  formatRolloutSummary,
  BOOT_GRACE_MS,
  type RolloutHaltReason,
} from "@/lib/staged-rollout";
// Delegate each server to the real update handler: pre-update backup,
// steamcmd checks and status bookkeeping all apply unchanged.
import { POST as updateServerAction } from "../[id]/update/route";
import { POST as processAction } from "../[id]/process/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Updates are heavy (steamcmd downloads) — smaller cap, sequential run. */
const BATCH_UPDATE_MAX = 10;

function subRequest(id: number, source: Headers, path = "update", body: unknown = {}): NextRequest {
  const headers = new Headers(source);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const inner = new Request(`http://batch.internal/api/servers/${id}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    // @ts-expect-error undici requires duplex when a body is present
    duplex: "half",
  });
  return new NextRequest(inner);
}

// POST /api/servers/batch-update — { serverIds: number[] }
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !(await hasPermission(auth.userId, "servers.install", auth.keyScope)) &&
    !(await hasPermission(auth.userId, "games.install", auth.keyScope))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const valid = validateBatchServerIds(body, BATCH_UPDATE_MAX);
  if (!valid.ok || !valid.value) {
    return NextResponse.json({ error: valid.error || "Invalid batch request" }, { status: 400 });
  }
  const serverIds = valid.value;

  try {
    const rows = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        userId: gameServers.userId,
        status: gameServers.status,
      })
      .from(gameServers)
      .where(inArray(gameServers.id, serverIds));

    const { dispatchable, skippedIds } = partitionBatch(
      rows,
      serverIds,
      auth.role === "admin",
      auth.userId
    );

    const staged = parseStagedFlag(body);
    if (staged) {
      return runStagedRollout({
        req,
        auth,
        dispatchable,
        skippedIds,
        requestedCount: serverIds.length,
      });
    }

    // Sequential on purpose: steamcmd runs are disk- and network-heavy, and
    // the shared steamcmd install does not enjoy parallel tenants.
    const results: Array<{ id: number; name: string; ok: boolean; skipped?: string; error?: string | null }> = [];
    for (const server of dispatchable) {
      if (server.status !== "stopped") {
        results.push({
          id: server.id,
          name: server.name,
          ok: false,
          skipped: `status is ${server.status} — stop it first`,
        });
        continue;
      }
      try {
        const res = await updateServerAction(subRequest(server.id, req.headers), {
          params: Promise.resolve({ id: String(server.id) }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        results.push({ id: server.id, name: server.name, ok: res.ok, error: data.error ?? null });
      } catch (e: unknown) {
        results.push({
          id: server.id,
          name: server.name,
          ok: false,
          error: e instanceof Error ? e.message : "Update dispatch failed",
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    try {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId,
        action: "server.batch-update",
        entityType: "server",
        entityId: null,
        details: {
          requested: serverIds.length,
          ok: okCount,
          failed: results.filter((r) => !r.ok && !r.skipped).length,
          skipped: results.filter((r) => r.skipped).length + skippedIds.length,
        },
        ipAddress: ip.slice(0, 45),
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({
      requested: serverIds.length,
      ok: okCount,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      skippedIds,
      results,
    });
  } catch (e: unknown) {
    return apiError(e, "Batch update failed", 500);
  }
}

// ── Staged rollout ──────────────────────────────────────────────────────────
// Update ONE canary first, prove it boots on the new build, then sweep the
// rest. A canary failure halts the rollout so one bad game update can't take
// down the whole fleet at once.

async function runStagedRollout(opts: {
  req: NextRequest;
  auth: { userId: number | string; role: string };
  dispatchable: Array<{ id: number; name: string; status: string }>;
  skippedIds: number[];
  requestedCount: number;
}): Promise<NextResponse> {
  const { req, auth, dispatchable, skippedIds, requestedCount } = opts;

  const plan = planStagedRollout(dispatchable);
  const results: Array<{ id: number; name: string; ok: boolean; skipped?: string; error?: string | null; canary?: boolean }> =
    plan.blocked.map(({ server, reason }) => ({ id: server.id, name: server.name, ok: false, skipped: reason }));

  let halted: RolloutHaltReason = null;
  let canaryVerified = false;

  if (!plan.canary) {
    halted = "canary-update-failed";
  } else {
    const canary = plan.canary;
    // Phase 1: update the canary through the real per-server handler.
    let canaryUpdateOk = false;
    let canaryError: string | null = null;
    try {
      const res = await updateServerAction(subRequest(canary.id, req.headers), {
        params: Promise.resolve({ id: String(canary.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      canaryUpdateOk = res.ok;
      canaryError = data.error ?? null;
    } catch (e: unknown) {
      canaryError = e instanceof Error ? e.message : "Update dispatch failed";
    }
    results.push({ id: canary.id, name: canary.name, ok: canaryUpdateOk, error: canaryError, canary: true });

    // Phase 2: boot verification — start it, give it BOOT_GRACE_MS to prove
    // it survives on the new build, then return it to its stopped state.
    let canaryBootAlive = false;
    if (canaryUpdateOk) {
      try {
        const startRes = await processAction(subRequest(canary.id, req.headers, "process", { action: "start" }), {
          params: Promise.resolve({ id: String(canary.id) }),
        });
        const startData = (await startRes.json().catch(() => ({}))) as { alive?: boolean };
        if (startRes.ok && startData.alive) {
          await new Promise((r) => setTimeout(r, BOOT_GRACE_MS));
          const { db } = await import("@/db");
          const { gameServers, nodes } = await import("@/db/schema");
          const { eq } = await import("drizzle-orm");
          const [row] = await db
            .select({ status: gameServers.status, pid: gameServers.pid, nodeIsLocal: nodes.isLocal })
            .from(gameServers)
            .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
            .where(eq(gameServers.id, canary.id))
            .limit(1);
          let aliveNow = row?.status === "running" && row.pid != null;
          if (aliveNow && row?.nodeIsLocal !== false && row?.pid) {
            const { isProcessAlive } = await import("@/lib/process-control");
            aliveNow = isProcessAlive(row.pid);
          }
          canaryBootAlive = aliveNow;
        }
      } catch {
        canaryBootAlive = false;
      }
      // Put the canary back the way we found it (stopped) either way.
      try {
        await processAction(subRequest(canary.id, req.headers, "process", { action: "stop" }), {
          params: Promise.resolve({ id: String(canary.id) }),
        });
      } catch {
        /* best-effort cleanup */
      }
    }

    // Phase 3: sweep — only if the canary earned it.
    if (!shouldSweepRest(canaryUpdateOk, canaryBootAlive)) {
      halted = canaryUpdateOk ? "canary-boot-failed" : "canary-update-failed";
    } else {
      canaryVerified = true;
      for (const server of plan.rest) {
        try {
          const res = await updateServerAction(subRequest(server.id, req.headers), {
            params: Promise.resolve({ id: String(server.id) }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          results.push({ id: server.id, name: server.name, ok: res.ok, error: data.error ?? null });
        } catch (e: unknown) {
          results.push({
            id: server.id,
            name: server.name,
            ok: false,
            error: e instanceof Error ? e.message : "Update dispatch failed",
          });
        }
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const summary = formatRolloutSummary({
    canaryName: plan.canary?.name ?? "(none)",
    halted,
    updated: okCount,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    blockedCount: results.filter((r) => r.skipped).length + skippedIds.length,
  });

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const { db } = await import("@/db");
    const { auditLog } = await import("@/db/schema");
    await db.insert(auditLog).values({
      userId: auth.userId as number,
      action: "server.batch-update",
      entityType: "server",
      entityId: null,
      details: {
        mode: "staged",
        canary: plan.canary?.id ?? null,
        canaryVerified,
        halted,
        requested: requestedCount,
        ok: okCount,
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
    mode: "staged",
    halted,
    canary: plan.canary ? { id: plan.canary.id, name: plan.canary.name, verified: canaryVerified } : null,
    requested: requestedCount,
    ok: okCount,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skippedIds,
    results,
    summary,
  });
}
