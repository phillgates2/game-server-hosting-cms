import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { desc, eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { limitParam, offsetParam } from "@/lib/pagination";

// GET /api/audit-log — List audit log entries
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  const allowed = auth && ((await hasPermission(auth.userId, "security.audit")) || (await hasPermission(auth.userId, "panel.settings")));
  if (!allowed) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = limitParam(url.searchParams, 100);
  const offset = offsetParam(url.searchParams);

  try {
    const entries = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        details: auditLog.details,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
        username: users.username,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ entries: [] });
  }
}

// POST /api/audit-log — Record an audit entry
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Audit rows are append-only and read back directly; a multi-MB detail
  // would bloat every listing and every prune pass.
  const LIMITS = { action: 64, entityType: 64, entityId: 64, details: 8_000 };

  try {
    const { action, entityType, entityId, details } = await req.json();
    if (typeof action !== "string" || !action.trim() || action.trim().length > LIMITS.action) {
      return NextResponse.json({ error: `action is required (max ${LIMITS.action} characters)` }, { status: 400 });
    }

    const normType = entityType ? String(entityType).slice(0, LIMITS.entityType) : null;

    // entity_id is an integer column; anything else cannot be stored.
    let normId: number | null = null;
    if (entityId !== undefined && entityId !== null && entityId !== "") {
      const n = Number(entityId);
      if (Number.isInteger(n) && n > 0) normId = n;
    }

    // details is jsonb. A plain string is not valid JSON, so the historical
    // "details: 'something happened'" 500'd; normalise strings to JSON
    // strings instead (a string that is itself JSON stays structured).
    let normDetails: unknown = null;
    if (details !== undefined && details !== null && details !== "") {
      if (typeof details === "string") {
        const trimmed = details.trim();
        if (trimmed.length === 0) {
          normDetails = null;
        } else {
          try {
            normDetails = JSON.parse(trimmed) as unknown;
          } catch {
            normDetails = trimmed; // stored as a JSON string by the driver
          }
        }
      } else if (typeof details === "object" || typeof details === "number" || typeof details === "boolean") {
        normDetails = details;
      }
      if (JSON.stringify(normDetails)?.length > LIMITS.details) {
        return NextResponse.json({ error: `details is limited to ${LIMITS.details} characters` }, { status: 400 });
      }
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

    await db.insert(auditLog).values({
      userId: auth.userId,
      action: action.trim(),
      entityType: normType,
      entityId: normId,
      details: normDetails,
      ipAddress: ip.slice(0, 45),
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}
