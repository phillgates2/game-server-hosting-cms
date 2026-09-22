import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes, settings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { access, constants } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/servers/[id]/update — Re-run SteamCMD app_update or re-download latest
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!((await hasPermission(auth.userId, "servers.install", auth.keyScope)) || (await hasPermission(auth.userId, "games.install", auth.keyScope)))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  let updateClaimed = false;
  try {
    const [server] = await db
      .select({
        id: gameServers.id, userId: gameServers.userId, name: gameServers.name,
        installPath: gameServers.installPath, status: gameServers.status,
        steamAppId: gameDefinitions.steamAppId, gameName: gameDefinitions.name,
        steamcmdPath: nodes.steamcmdPath,
        gameSlug: gameDefinitions.slug, installScript: gameDefinitions.installScript,
        port: gameServers.port, queryPort: gameServers.queryPort, rconPort: gameServers.rconPort,
        variables: gameServers.variables, config: gameServers.config,
        nodeIsLocal: nodes.isLocal, nodeApiUrl: nodes.apiUrl, nodeApiKey: nodes.apiKey,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (server.status !== "stopped") return NextResponse.json({ error: "Stop the server before updating; an install or update must not already be in progress" }, { status: 409 });

    const remote = server.nodeIsLocal === false;
    if (remote && (!server.nodeApiUrl || !server.nodeApiKey)) {
      return NextResponse.json({ error: "Remote updates require a node agent API URL and key" }, { status: 400 });
    }
    const endpoint = { apiUrl: server.nodeApiUrl || "", apiKey: server.nodeApiKey || "" };
    const steamcmdDir = (server.steamcmdPath ?? "").trim() || "/opt/steamcmd";
    const { buildSteamUpdateScript, runUpdateScript } = await import("@/lib/server-update-runner");
    const { buildTemplateUpdateScript } = await import("@/lib/server-update-script");
    const script = server.steamAppId
      ? buildSteamUpdateScript({ installPath: server.installPath, gameName: server.gameName || "game", steamAppId: String(server.steamAppId), steamcmdDir })
      : buildTemplateUpdateScript(server);
    if (!script) {
      return NextResponse.json({ error: "This game has no download/install script. Configure one in the game definition to enable updates." }, { status: 400 });
    }
    if (server.steamAppId && !remote) {
      const available = await access(`${steamcmdDir}/steamcmd.sh`, constants.X_OK).then(() => true).catch(() => false);
      if (!available) return NextResponse.json({ error: "SteamCMD is not installed at the configured node path" }, { status: 400 });
    }

    // Claim before backing up so two Update clicks cannot run concurrently.
    const claimed = await db.update(gameServers)
      .set({ status: "installing", updatedAt: new Date() })
      .where(and(eq(gameServers.id, server.id), eq(gameServers.status, "stopped")))
      .returning({ id: gameServers.id });
    if (!claimed.length) return NextResponse.json({ error: "Server is no longer stopped" }, { status: 409 });
    updateClaimed = true;

    // Safety net: archive the server before the updater overwrites files. On by
    // default ("update_auto_backup" in Settings → Panel). A failed backup
    // aborts the update rather than proceeding without a restore point —
    // that is the exact failure mode this feature exists to prevent. The
    // claimed status is released when the backup aborts.
    const [autoBackupRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "update_auto_backup"))
      .limit(1);
    const autoBackup = (autoBackupRow?.value ?? "true") !== "false";

    let backupName: string | null = null;
    if (autoBackup) {
      try {
        if (remote) {
          const { remoteBackupCreate } = await import("@/lib/node-client");
          const backup = await remoteBackupCreate(endpoint, server.installPath);
          if (!backup.ok || !backup.name) throw new Error("Node agent did not confirm the backup");
          backupName = backup.name;
        } else {
          const { createServerBackup } = await import("@/lib/backup");
          backupName = (await createServerBackup(server.installPath)).name;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, server.id));
        updateClaimed = false;
        return NextResponse.json(
          {
            error: `Automatic pre-update backup failed (${msg}). The update was aborted and no files were changed. Turn off "Automatic backup before update" in Settings → Panel to update without a backup.`,
          },
          { status: 500 }
        );
      }
    }

    // Snapshot before the updater touches anything so we can report what changed.
    // Best-effort: a failing walk must never block the update itself.
    const { snapshotInstallPath, diffSnapshots, configFilesChanged, formatUpdateReport } = await import("@/lib/update-diff");
    const pre = remote ? null : await snapshotInstallPath(server.installPath).catch(() => null);

    let result: { stdout: string; stderr: string };
    if (remote) {
      const { nodeRpc } = await import("@/lib/node-client");
      const response = await nodeRpc<{ ok: boolean; output?: string; exitCode?: number }>(
        endpoint, "/rpc/install", { installPath: server.installPath, script }, { timeoutMs: 45 * 60_000 }
      );
      if (!response.ok) throw Object.assign(new Error(`Remote update failed (exit ${response.exitCode ?? "unknown"})`), { stdout: response.output });
      result = { stdout: response.output || "", stderr: "" };
    } else {
      result = await runUpdateScript({ installPath: server.installPath, script, timeoutMs: 45 * 60_000 });
    }

    await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    updateClaimed = false;

    // Diff + persist the report (best-effort, like all history writes).
    let report: { added: number; removed: number; changed: number; configsChanged: string[]; truncated: boolean } | null = null;
    if (pre) {
      const post = await snapshotInstallPath(server.installPath).catch(() => null);
      if (post) {
        const diff = diffSnapshots(pre.entries, post.entries, pre.truncated, post.truncated);
        const configs = configFilesChanged(diff);
        report = {
          added: diff.added.length,
          removed: diff.removed.length,
          changed: diff.changed.length,
          configsChanged: configs.slice(0, 20),
          truncated: diff.truncated,
        };
        try {
          const { recordServerEvent } = await import("@/lib/server-events");
          await recordServerEvent(server.id, "update-report", formatUpdateReport(diff).slice(0, 500));
        } catch {
          /* best-effort */
        }
      }
    }

    // Changelog entry: every update lands in the server's event history
    // with its backup name and file-report summary.
    try {
      const { recordServerEvent } = await import("@/lib/server-events");
      const { formatUpdateEventDetail } = await import("@/lib/update-history");
      await recordServerEvent(server.id, "updated", formatUpdateEventDetail({ backupName, report }));
    } catch {
      /* best-effort */
    }

    const backupNote = backupName ? ` (pre-update backup: ${backupName})` : "";
    const configNote = report && report.configsChanged.length > 0 ? ` — heads-up: ${report.configsChanged.length} config file(s) changed` : "";
    return NextResponse.json({ ok: true, backup: backupName, report, message: `${server.gameName} updated successfully${backupNote}${configNote}`, output: result.stdout.slice(-4000) });
  } catch (e: unknown) {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    try { if (updateClaimed) await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, Number(id))); } catch { /**/ }
    return NextResponse.json({ error: err.message || "Update failed", output: err.stdout?.slice(-4000) || "" }, { status: 500 });
  }
}
