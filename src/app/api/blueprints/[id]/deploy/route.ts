import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { serverBlueprints, serverPresets, nodes, gameServers, auditLog, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  ensureServerBlueprintsTable,
  expandBlueprintEntries,
  blueprintServerName,
  type BlueprintEntryInput,
} from "@/lib/blueprints";
import { POST as createServerAction } from "../../../servers/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Coerce stored jsonb entries back into validated shape (defence in depth). */
function parseStoredEntries(raw: unknown): BlueprintEntryInput[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: BlueprintEntryInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const e = item as Record<string, unknown>;
    const presetId = Number(e.presetId);
    const count = Number(e.count ?? 1);
    if (!Number.isInteger(presetId) || presetId <= 0) return null;
    if (!Number.isInteger(count) || count < 1 || count > 5) return null;
    entries.push({
      presetId,
      count,
      namePattern: typeof e.namePattern === "string" ? e.namePattern : null,
    });
  }
  return entries.length > 0 ? entries : null;
}

// POST /api/blueprints/[id]/deploy — { nodeId }
// Creates every server in the blueprint through the real create handler, so
// quotas, unique paths, port validation and maintenance checks all apply.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const nodeId = Number((body as Record<string, unknown>)?.nodeId);
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return NextResponse.json({ error: "A valid nodeId is required to deploy" }, { status: 400 });
  }

  try {
    const { id } = await params;
    await ensureServerBlueprintsTable();
    const [blueprint] = await db
      .select()
      .from(serverBlueprints)
      .where(eq(serverBlueprints.id, Number(id)))
      .limit(1);
    if (!blueprint) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && blueprint.userId !== auth.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const entries = parseStoredEntries(blueprint.entries);
    if (!entries) {
      return NextResponse.json({ error: "This blueprint has no deployable entries" }, { status: 400 });
    }
    const expanded = expandBlueprintEntries(entries);
    if (!expanded.ok) {
      return NextResponse.json({ error: expanded.error }, { status: 400 });
    }

    const [node] = await db
      .select({ id: nodes.id, maintenanceMode: nodes.maintenanceMode })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });
    if (node.maintenanceMode) {
      return NextResponse.json(
        { error: "That node is in maintenance mode — pick another node for the deploy." },
        { status: 400 }
      );
    }

    // Resolve presets up front: they must exist and be visible to this user
    // (their own, or admin).
    const presetCache = new Map<number, { name: string; gameId: number; variables: Record<string, string>; defaultPort: number | null }>();
    for (const entry of entries) {
      if (presetCache.has(entry.presetId)) continue;
      const [preset] = await db
        .select({
          name: serverPresets.name,
          gameId: serverPresets.gameId,
          variables: serverPresets.variables,
          userId: serverPresets.userId,
          defaultPort: gameDefinitions.defaultPort,
        })
        .from(serverPresets)
        .leftJoin(gameDefinitions, eq(serverPresets.gameId, gameDefinitions.id))
        .where(eq(serverPresets.id, entry.presetId))
        .limit(1);
      if (!preset) {
        return NextResponse.json({ error: `Preset #${entry.presetId} no longer exists` }, { status: 400 });
      }
      if (auth.role !== "admin" && preset.userId !== null && preset.userId !== auth.userId) {
        return NextResponse.json({ error: `Preset "${preset.name}" is not shared with you` }, { status: 403 });
      }
      const vars: Record<string, string> = {};
      if (preset.variables && typeof preset.variables === "object" && !Array.isArray(preset.variables)) {
        for (const [k, v] of Object.entries(preset.variables as Record<string, unknown>)) {
          if (typeof v === "string") vars[k] = v;
        }
      }
      presetCache.set(entry.presetId, {
        name: preset.name,
        gameId: preset.gameId,
        variables: vars,
        defaultPort: preset.defaultPort ?? null,
      });
    }

    const { nextFreePort, MIN_SERVER_PORT } = await import("@/lib/server-lifecycle");
    const patternByPreset = new Map<number, string | null>();
    for (const entry of entries) {
      if (!patternByPreset.has(entry.presetId)) patternByPreset.set(entry.presetId, entry.namePattern);
    }

    const results: Array<{ ordinal: number; name: string; ok: boolean; serverId?: number; error?: string | null }> = [];
    for (const step of expanded.plan) {
      const preset = presetCache.get(step.presetId);
      if (!preset) continue; // cannot happen — resolved above
      const name = blueprintServerName(patternByPreset.get(step.presetId) ?? null, preset.name, step.ordinal);

      // Allocate a free port on the node, counting servers created earlier in
      // this same deploy.
      const nodeServers = await db
        .select({ port: gameServers.port, queryPort: gameServers.queryPort, rconPort: gameServers.rconPort })
        .from(gameServers)
        .where(eq(gameServers.nodeId, nodeId));
      const taken = nodeServers.flatMap((s) =>
        [s.port, s.queryPort, s.rconPort].filter((n): n is number => typeof n === "number")
      );
      const port = nextFreePort(preset.defaultPort ?? MIN_SERVER_PORT, taken, 2);
      if (port === null) {
        results.push({ ordinal: step.ordinal, name, ok: false, error: "No free ports left on that node" });
        continue;
      }

      const headers = new Headers(req.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      const inner = new Request(`http://blueprint.internal/api/servers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          gameId: preset.gameId,
          nodeId,
          port,
          variables: preset.variables,
        }),
        // @ts-expect-error undici requires duplex when a body is present
        duplex: "half",
      });

      try {
        const res = await createServerAction(new NextRequest(inner));
        const data = (await res.json().catch(() => ({}))) as { server?: { id?: number }; error?: string };
        results.push({ ordinal: step.ordinal, name, ok: res.ok, serverId: data.server?.id, error: data.error ?? null });
        if (!res.ok) break; // Stop at the first failure — don't half-deploy into a wall.
      } catch (e: unknown) {
        results.push({ ordinal: step.ordinal, name, ok: false, error: e instanceof Error ? e.message : "Create failed" });
        break;
      }
    }

    const created = results.filter((r) => r.ok).length;
    try {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "blueprint.deploy",
        entityType: "blueprint",
        entityId: blueprint.id,
        details: { blueprintName: blueprint.name, nodeId, planned: expanded.plan.length, created },
        ipAddress: ip.slice(0, 45),
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({
      blueprint: blueprint.name,
      planned: expanded.plan.length,
      created,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e: unknown) {
    return apiError(e, "Blueprint deploy failed", 500);
  }
}
