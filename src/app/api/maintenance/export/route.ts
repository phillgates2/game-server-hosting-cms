import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  settings,
  serverPresets,
  scheduledTasks,
  gameServers,
  gameDefinitions,
  nodes,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { PANEL_EXPORT_KIND } from "@/lib/panel-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/maintenance/export — admin-only disaster-recovery snapshot.
// Reference metadata only: node credentials, SSH secrets and API keys are
// deliberately NOT in the export.
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [settingRows, presetRows, taskRows, serverRows, nodeRows] = await Promise.all([
      db.select({ key: settings.key, value: settings.value }).from(settings).limit(500),
      db
        .select({
          name: serverPresets.name,
          description: serverPresets.description,
          gameId: serverPresets.gameId,
          variables: serverPresets.variables,
          gameSlug: gameDefinitions.slug,
        })
        .from(serverPresets)
        .leftJoin(gameDefinitions, eq(serverPresets.gameId, gameDefinitions.id))
        .limit(500),
      db
        .select({
          taskType: scheduledTasks.taskType,
          cronExpression: scheduledTasks.cronExpression,
          command: scheduledTasks.command,
          enabled: scheduledTasks.enabled,
          serverName: gameServers.name,
        })
        .from(scheduledTasks)
        .leftJoin(gameServers, eq(scheduledTasks.serverId, gameServers.id))
        .limit(500),
      db
        .select({
          name: gameServers.name,
          port: gameServers.port,
          notes: gameServers.notes,
          tags: gameServers.tags,
          autoRestart: gameServers.autoRestart,
          variables: gameServers.variables,
          gameSlug: gameDefinitions.slug,
          nodeName: nodes.name,
        })
        .from(gameServers)
        .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
        .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
        .limit(1_000),
      db
        .select({
          name: nodes.name,
          hostname: nodes.hostname,
          ipv4: nodes.ipv4,
          ipv6: nodes.ipv6,
          location: nodes.location,
          provider: nodes.provider,
          maxServers: nodes.maxServers,
          maxRamMb: nodes.maxRamMb,
          gameServerPath: nodes.gameServerPath,
          isLocal: nodes.isLocal,
          isDefault: nodes.isDefault,
        })
        .from(nodes)
        .limit(200),
    ]);

    return NextResponse.json({
      app: "game-server-manager",
      kind: PANEL_EXPORT_KIND,
      exportedAt: new Date().toISOString(),
      settings: settingRows,
      presets: presetRows.map((p) => ({
        name: p.name,
        description: p.description,
        gameId: p.gameId,
        gameSlug: p.gameSlug,
        variables: p.variables ?? {},
      })),
      scheduledTasks: taskRows,
      servers: serverRows,
      nodes: nodeRows,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not build the export", 500);
  }
}
