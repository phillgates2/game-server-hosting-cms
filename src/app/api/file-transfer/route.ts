import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { describeTransferEndpoint, transferSettingsSummary } from "@/lib/file-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's file-transfer logins plus the live server state.
 *
 * Access is the `transfer.*` permission set, not the web file manager's
 * `servers.files`: FTP is a separate door into the same disk, so a role can be
 * given one without the other (a mod team that may push files over FTP but must
 * not browse the panel, or the reverse). `transfer.any` additionally shows
 * every account on the panel so a leaked credential can be rotated without a
 * support round trip.
 */
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "transfer.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { fileTransferStats, fileTransferRuntimeError } = await import("@/lib/file-transfer-service");
    const { listAccountsForUser, listAllAccounts, loadTransferSettings, foldersForUser } = await import(
      "@/lib/file-transfer"
    );

    const settings = await loadTransferSettings();
    const stats = fileTransferStats();
    const runtime = fileTransferRuntimeError();
    // What this caller may do, decided server-side so the panel only has to
    // render buttons it can actually use.
    const canManage = await hasPermission(auth.userId, "transfer.manage", auth.keyScope);
    const canDisconnect = await hasPermission(auth.userId, "transfer.disconnect", auth.keyScope);
    const canAny = await hasPermission(auth.userId, "transfer.any", auth.keyScope);
    const canSettings = await hasPermission(auth.userId, "transfer.settings", auth.keyScope);

    const accounts = await listAccountsForUser(auth.userId);
    const folders = await foldersForUser(auth.userId);

    return NextResponse.json({
      endpoint: describeTransferEndpoint(settings, req.headers.get("host")),
      settings: transferSettingsSummary(settings),
      running: Boolean(stats?.listening),
      error: runtime.error,
      tlsError: runtime.tlsError,
      stats: stats ? { ...stats, recent: stats.recent.slice(0, 10) } : null,
      accounts: accounts.map((account) => ({
        id: account.id,
        username: account.username,
        password: account.password,
        serverId: account.serverId,
        enabled: account.enabled,
        readable: account.readable,
        createdAt: account.createdAt,
        lastLoginAt: account.lastLoginAt,
        lastLoginIp: account.lastLoginIp,
        online: Boolean(stats?.usernames.some((u) => u.toLowerCase() === account.username.toLowerCase())),
      })),
      servers: folders.map((folder) => ({
        serverId: folder.serverId,
        label: folder.label,
        folder: folder.name,
        /** Not the caller's own server: reached through a per-server grant. */
        shared: folder.shared === true,
      })),
      can: { manage: canManage, disconnect: canDisconnect, any: canAny, settings: canSettings },
      ...(canAny
        ? {
            admin: {
              accounts: (await listAllAccounts()).map((account) => ({
                id: account.id,
                username: account.username,
                userId: account.userId,
                owner: account.ownerUsername,
                serverId: account.serverId,
                serverName: account.serverName,
                enabled: account.enabled,
                readable: account.readable,
                lastLoginAt: account.lastLoginAt,
                lastLoginIp: account.lastLoginIp,
                online: Boolean(stats?.usernames.some((u) => u.toLowerCase() === account.username.toLowerCase())),
              })),
            },
          }
        : {}),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load transfer settings", 500);
  }
}

/**
 * Manage transfer logins.
 *
 * One key per capability: `transfer.manage` for the caller's own logins,
 * `transfer.disconnect` to cut sessions that are already open, `transfer.any`
 * to act on somebody else's, `transfer.settings` to bounce the listener.
 * `transfer.any` implies the other three for accounts it can reach.
 *
 * The keys are capability-only; WHICH SERVERS an account may reach is decided
 * per server (own server, or a sharing row with file transfer enabled).
 *
 * Deliberately no auto-provisioning on GET: an FTP login is a new, long-lived,
 * internet-facing credential, so it is created when somebody asks for one and
 * not as a side effect of opening a panel tab.
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const canManage = await hasPermission(auth.userId, "transfer.manage", auth.keyScope);
  const canDisconnect = await hasPermission(auth.userId, "transfer.disconnect", auth.keyScope);
  const canAny = await hasPermission(auth.userId, "transfer.any", auth.keyScope);
  const canSettings = await hasPermission(auth.userId, "transfer.settings", auth.keyScope);
  if (!canManage && !canDisconnect && !canAny && !canSettings) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  /** Actions that mint, re-key or retire a credential. */
  const requireManage = () => canManage || canAny;
  /** Actions that only look at what is already open. */
  const requireDisconnect = () => canDisconnect || canAny;
  /** Reaching another user's accounts at all. */
  const requireAny = () => canAny;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const accountId = Number(body.accountId ?? 0);

  try {
    const {
      deleteAccount,
      ensureAccountForUser,
      ensureServerAccount,
      folderNameFor,
      listAccountsForUser,
      recordTransferAudit,
      rotateAccountPassword,
      setAccountEnabled,
    } = await import("@/lib/file-transfer");
    const { kickTransferSessions, restartFileTransferService } = await import("@/lib/file-transfer-service");

    /** Load an account and refuse unless it belongs to the caller (or `transfer.any`). */
    const owned = async (id: number) => {
      if (!Number.isInteger(id) || id <= 0) return null;
      if (canAny) {
        const { listAllAccounts } = await import("@/lib/file-transfer");
        const all = await listAllAccounts();
        return all.find((a) => a.id === id) ?? null;
      }
      const accounts = await listAccountsForUser(auth.userId);
      return accounts.find((a) => a.id === id) ?? null;
    };

    switch (action) {
      case "create": {
        if (!requireManage()) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const account = await ensureAccountForUser(auth.userId);
        await recordTransferAudit({
          userId: auth.userId,
          action: "file_transfer.account_created",
          details: { username: account.username, scope: "all" },
          ip: clientIp(req),
        });
        return NextResponse.json({
          ok: true,
          account: { id: account.id, username: account.username, password: account.password, serverId: null },
        });
      }

      case "create-scoped": {
        if (!requireManage()) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const serverId = Number(body.serverId ?? 0);
        if (!Number.isInteger(serverId) || serverId <= 0) {
          return NextResponse.json({ error: "serverId is required" }, { status: 400 });
        }
        const { db } = await import("@/db");
        const { gameServers, nodes } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const [server] = await db
          .select({
            id: gameServers.id,
            name: gameServers.name,
            nodeIsLocal: nodes.isLocal,
          })
          .from(gameServers)
          .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
          .where(eq(gameServers.id, serverId))
          .limit(1);
        if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
        // Server-specific: only a server the caller owns, one shared with them
        // for file transfer, or any server for `transfer.any`. Knowing a server
        // id is not access.
        const { canTransferToServer } = await import("@/lib/server-collab");
        if (!(await canTransferToServer(serverId, auth.userId, auth.keyScope))) {
          return NextResponse.json(
            { error: "You do not have file transfer access to that server" },
            { status: 403 }
          );
        }
        if (server.nodeIsLocal === false) {
          return NextResponse.json(
            { error: "That server runs on a remote node — use its panel file manager instead." },
            { status: 400 }
          );
        }
        const account = await ensureServerAccount(auth.userId, serverId);
        await recordTransferAudit({
          userId: auth.userId,
          action: "file_transfer.account_created",
          serverId,
          details: { username: account.username, scope: folderNameFor({ id: server.id, name: server.name }) },
          ip: clientIp(req),
        });
        return NextResponse.json({
          ok: true,
          account: { id: account.id, username: account.username, password: account.password, serverId },
        });
      }

      case "rotate": {
        if (!requireManage()) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const target = await owned(accountId);
        if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        const updated = await rotateAccountPassword(target.id);
        if (!updated) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        // Live sessions keep working on the old password otherwise.
        const dropped = kickTransferSessions(updated.username);
        await recordTransferAudit({
          userId: auth.userId,
          action: "file_transfer.password_rotated",
          serverId: updated.serverId,
          details: { username: updated.username, sessionsDropped: dropped },
          ip: clientIp(req),
        });
        return NextResponse.json({
          ok: true,
          account: {
            id: updated.id,
            username: updated.username,
            password: updated.password,
            serverId: updated.serverId,
          },
          sessionsDropped: dropped,
        });
      }

      case "enable":
      case "disable": {
        if (!requireManage()) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const target = await owned(accountId);
        if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        const enabled = action === "enable";
        await setAccountEnabled(target.id, enabled);
        const dropped = enabled ? 0 : kickTransferSessions(target.username);
        await recordTransferAudit({
          userId: auth.userId,
          action: enabled ? "file_transfer.account_enabled" : "file_transfer.account_disabled",
          serverId: target.serverId,
          details: { username: target.username, sessionsDropped: dropped },
          ip: clientIp(req),
        });
        return NextResponse.json({ ok: true, enabled, sessionsDropped: dropped });
      }

      case "delete": {
        if (!requireManage()) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const target = await owned(accountId);
        if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        kickTransferSessions(target.username);
        await deleteAccount(target.id);
        await recordTransferAudit({
          userId: auth.userId,
          action: "file_transfer.account_deleted",
          serverId: target.serverId,
          details: { username: target.username },
          ip: clientIp(req),
        });
        return NextResponse.json({ ok: true });
      }

      case "disconnect": {
        if (!requireDisconnect()) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const target = await owned(accountId);
        if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        // Drops the sessions without touching the credential: the upload dies,
        // the password keeps working for the next legitimate connection.
        const dropped = kickTransferSessions(target.username);
        await recordTransferAudit({
          userId: auth.userId,
          action: "file_transfer.sessions_dropped",
          serverId: target.serverId,
          details: { username: target.username, sessionsDropped: dropped },
          ip: clientIp(req),
        });
        return NextResponse.json({ ok: true, sessionsDropped: dropped });
      }

      case "restart": {
        if (!canSettings) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        const stats = await restartFileTransferService("requested from the panel");
        return NextResponse.json({ ok: true, running: Boolean(stats?.listening) });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action || "(none)"}` }, { status: 400 });
    }
  } catch (e: unknown) {
    return apiError(e, "File transfer request failed", 500);
  }
}

/** Best-effort client address for the audit trail. */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "panel";
}
