import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { licenseKeys, licenseActivations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureLicenseTables } from "@/lib/licensing";
import {
  classifyActivationHealth,
  classifyKeyHealth,
  summarizeLicenseFleet,
  formatFleetUsageLine,
  LICENSE_ACTIVE_WINDOW_DAYS,
  LICENSE_SILENT_WINDOW_DAYS,
  type LicenseKeyUsage,
} from "@/lib/license-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/license/analytics — fleet licensing health at a glance
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "licenses.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await ensureLicenseTables();
    const nowMs = Date.now();

    const keyRows = await db
      .select({
        id: licenseKeys.id,
        keyPrefix: licenseKeys.keyPrefix,
        label: licenseKeys.label,
        maxActivations: licenseKeys.maxActivations,
        expiresAt: licenseKeys.expiresAt,
        revokedAt: licenseKeys.revokedAt,
        activationCount: sql<number>`count(${licenseActivations.id})::int`,
        lastSeen: sql<string | null>`max(${licenseActivations.lastSeenAt})`,
      })
      .from(licenseKeys)
      .leftJoin(licenseActivations, eq(licenseActivations.keyId, licenseKeys.id))
      .groupBy(licenseKeys.id);

    const keys: LicenseKeyUsage[] = keyRows.map((r) => ({
      keyId: r.id,
      label: r.label,
      prefix: r.keyPrefix,
      revoked: r.revokedAt !== null,
      expired: !!r.expiresAt && new Date(r.expiresAt).getTime() <= nowMs,
      maxActivations: r.maxActivations,
      activationCount: r.activationCount,
      lastSeenMs: r.lastSeen ? new Date(r.lastSeen).getTime() : null,
    }));

    const actRows = await db
      .select({
        id: licenseActivations.id,
        keyId: licenseActivations.keyId,
        hostname: licenseActivations.hostname,
        panelUrl: licenseActivations.panelUrl,
        lastSeenAt: licenseActivations.lastSeenAt,
        createdAt: licenseActivations.createdAt,
      })
      .from(licenseActivations)
      .orderBy(desc(licenseActivations.lastSeenAt))
      .limit(500);

    const labelByKey = new Map(keys.map((k) => [k.keyId, k.label ?? k.prefix]));
    const activations = actRows.map((a) => {
      const health = classifyActivationHealth(a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : null, nowMs);
      return {
        id: a.id,
        keyId: a.keyId,
        keyLabel: labelByKey.get(a.keyId) ?? `key #${a.keyId}`,
        hostname: a.hostname,
        panelUrl: a.panelUrl,
        lastSeenAt: a.lastSeenAt,
        health,
      };
    });
    const activationHealth = activations.map((a) => a.health);

    const summary = summarizeLicenseFleet(keys, activationHealth, nowMs);

    return NextResponse.json({
      windows: { activeDays: LICENSE_ACTIVE_WINDOW_DAYS, silentDays: LICENSE_SILENT_WINDOW_DAYS },
      summary,
      line: formatFleetUsageLine(summary),
      keys: keys.map((k) => ({
        ...k,
        health: classifyKeyHealth(k, nowMs),
      })),
      recentActivations: activations.slice(0, 25),
    });
  } catch (e: unknown) {
    return apiError(e, "License analytics failed", 500);
  }
}
