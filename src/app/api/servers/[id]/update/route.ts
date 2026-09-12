import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes, settings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
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
  if (!((await hasPermission(auth.userId, "servers.install")) || (await hasPermission(auth.userId, "games.install")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id, userId: gameServers.userId, name: gameServers.name,
        installPath: gameServers.installPath, status: gameServers.status,
        steamAppId: gameDefinitions.steamAppId, gameName: gameDefinitions.name,
        steamcmdPath: nodes.steamcmdPath,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (server.status === "running") return NextResponse.json({ error: "Stop the server before updating" }, { status: 400 });

    // Check for the shared system SteamCMD install (path from the node config)
    const steamcmdDir = (server.steamcmdPath ?? "").trim() || "/opt/steamcmd";
    const steamcmdPath = `${steamcmdDir}/steamcmd.sh`;
    const hasSteamcmd = await access(steamcmdPath, constants.X_OK).then(() => true).catch(() => false);

    if (!hasSteamcmd || !server.steamAppId) {
      return NextResponse.json({ error: "This server does not use SteamCMD or SteamCMD is not installed on the host. Use Install Files instead." }, { status: 400 });
    }

    // Safety net: archive the server before Steam overwrites files. On by
    // default ("update_auto_backup" in Settings → Panel). A failed backup
    // aborts the update rather than proceeding without a restore point —
    // that is the exact failure mode this feature exists to prevent. The
    // status stays "stopped" when it aborts, so nothing else can act on it.
    const [autoBackupRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "update_auto_backup"))
      .limit(1);
    const autoBackup = (autoBackupRow?.value ?? "true") !== "false";

    let backupName: string | null = null;
    if (autoBackup) {
      try {
        const { createServerBackup } = await import("@/lib/backup");
        const backup = await createServerBackup(server.installPath);
        backupName = backup.name;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            error: `Automatic pre-update backup failed (${msg}). The update was aborted and no files were changed. Turn off "Automatic backup before update" in Settings → Panel to update without a backup.`,
          },
          { status: 500 }
        );
      }
    }

    await db.update(gameServers).set({ status: "installing", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    // Snapshot before Steam touches anything so we can report what changed.
    // Best-effort: a failing walk must never block the update itself.
    const { snapshotInstallPath, diffSnapshots, configFilesChanged, formatUpdateReport } = await import("@/lib/update-diff");
    const pre = await snapshotInstallPath(server.installPath).catch(() => null);

    const { runSteamUpdate } = await import("@/lib/server-update-runner");
    const result = await runSteamUpdate({
      installPath: server.installPath,
      gameName: server.gameName || "game",
      steamAppId: String(server.steamAppId),
      steamcmdDir,
    });

    await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

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
    try { await db.update(gameServers).set({ status: "stopped", updatedAt: new Date() }).where(eq(gameServers.id, Number(id))); } catch { /**/ }
    return NextResponse.json({ error: err.message || "Update failed", output: err.stdout?.slice(-4000) || "" }, { status: 500 });
  }
}
