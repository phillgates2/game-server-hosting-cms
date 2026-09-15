"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * File transfer (FTP/FTPS) panel.
 *
 * This is the front door for the one thing a browser upload cannot do well:
 * moving very large files at a game server. It hands the operator a real login
 * (host, port, username, password), the folder each server appears under, and
 * the two commands a script needs — plus, for admins, the listener settings.
 */

interface Account {
  id: number;
  username: string;
  password: string | null;
  serverId: number | null;
  enabled: boolean;
  readable: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  online: boolean;
  serverName?: string | null;
  owner?: string | null;
}

interface ServerFolder {
  serverId: number | null;
  label: string;
  folder: string;
  /** Not your own server: reached through a per-server file-transfer grant. */
  shared: boolean;
}

interface Endpoint {
  host: string;
  hostOnly: string;
  port: number;
  advertised: boolean;
  passivePorts: string;
  ftps: boolean;
  insecure: boolean;
  maxUploadMb: number;
}

interface TransferPayload {
  endpoint: Endpoint;
  settings: {
    enabled: boolean;
    port: number;
    bindHost: string;
    masqueradeHost: string;
    passiveMin: number;
    passiveMax: number;
    ftps: boolean;
    tlsCertPath: string;
    tlsKeyPath: string;
    idleTimeoutSeconds: number;
    maxConnections: number;
    maxUploadMb: number;
  };
  running: boolean;
  error: string | null;
  tlsError: string | null;
  stats: {
    connections: number;
    loggedIn: number;
    uploads: number;
    downloads: number;
    bytesIn: number;
    bytesOut: number;
    recent: Array<{ at: number; username: string; type: "upload" | "download"; path: string; bytes: number; durationMs: number; ok: boolean }>;
  } | null;
  accounts: Account[];
  servers: ServerFolder[];
  /** What this caller may do — decided server-side, one key per capability. */
  can: {
    manage: boolean;
    disconnect: boolean;
    any: boolean;
    settings: boolean;
  };
  admin?: { accounts: Account[] };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const inputClass = "w-full px-3 py-2.5 gaming-chip rounded-lg text-sm";

export default function FileTransferPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<TransferPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState<Record<string, string | boolean> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/file-transfer");
      const payload = await res.json();
      if (!res.ok) {
        toast.error("Could not load file transfer", payload.error);
        return;
      }
      setData(payload);
      setForm((current) => current ?? {
        ftp_enabled: payload.settings.enabled,
        ftp_port: String(payload.settings.port),
        ftp_bind_host: payload.settings.bindHost,
        ftp_masquerade_host: payload.settings.masqueradeHost,
        ftp_passive_min: String(payload.settings.passiveMin),
        ftp_passive_max: String(payload.settings.passiveMax),
        ftp_tls_cert: payload.settings.tlsCertPath,
        ftp_tls_key: payload.settings.tlsKeyPath,
        ftp_idle_timeout: String(payload.settings.idleTimeoutSeconds),
        ftp_max_connections: String(payload.settings.maxConnections),
        ftp_max_upload_mb: String(payload.settings.maxUploadMb),
      });
    } catch (e) {
      toast.error("Could not load file transfer", e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/file-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error("Request failed", payload.error);
        return null;
      }
      toast.success(success, payload.account ? `Username ${payload.account.username}` : undefined);
      await load();
      return payload;
    } catch (e) {
      toast.error("Request failed", e instanceof Error ? e.message : "Network error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function firewall(action: "open" | "close") {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/file-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firewall: action }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error("Firewall", payload.error);
        return;
      }
      if (action === "open") {
        toast.success("Firewall updated", payload.rules?.join(", ") || "UFW allowed the FTP ports");
      } else {
        toast.success("Firewall rules removed", "The FTP ports are closed again");
      }
    } catch (e) {
      toast.error("Firewall", e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.info("Copied", label);
    } catch {
      toast.error("Copy failed", "Your browser blocked clipboard access");
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/file-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: form }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error("Could not save", payload.error);
        return;
      }
      if (payload.error) {
        toast.error("Saved, but the listener did not start", payload.error);
      } else if (payload.tlsError) {
        toast.info("Saved", payload.tlsError);
      } else {
        toast.success("File transfer settings saved", payload.running ? "The listener restarted" : "The listener is off");
      }
      setForm(null);
      await load();
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(account: Account) {
    const ok = await confirm({
      title: "Delete login",
      message: `Delete "${account.username}"? Any client using it stops working immediately.`,
      confirmLabel: "Delete login",
      danger: true,
    });
    if (!ok) return;
    void act({ action: "delete", accountId: account.id }, "Login deleted");
  }

  if (!loaded) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="gaming-surface rounded-xl p-8 text-center">
        <span className="text-4xl block mb-3">📡</span>
        <h3 className="font-semibold mb-1">File transfer is unavailable</h3>
        <p className="text-text-secondary text-sm">The panel could not read its transfer settings.</p>
      </div>
    );
  }

  const { endpoint, settings, stats } = data;
  const status = !settings.enabled
    ? { tone: "text-text-muted bg-bg-secondary", label: "Disabled", icon: "⏸️" }
    : data.running
      ? { tone: "bg-success/15 text-success", label: `Listening on ${settings.bindHost}:${settings.port}`, icon: "🟢" }
      : { tone: "bg-danger/15 text-danger", label: data.error ?? "Not listening", icon: "🔴" };

  return (
    <div className="animate-fade-in panel-view space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">📡 File Transfer (FTP/FTPS)</h2>
          <p className="text-text-secondary text-sm">
            Upload multi-gigabyte files straight to disk with any FTP client — no browser upload size limits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1.5 rounded-lg text-xs font-medium ${status.tone}`}>
            {status.icon} {status.label}
          </span>
          {data.can.settings && (
            <button
              onClick={() => void act({ action: "restart" }, "Listener restarted")}
              disabled={busy}
              className="px-3 py-1.5 bg-bg-secondary hover:bg-border rounded-lg text-xs disabled:opacity-50"
            >
              ⟳ Restart
            </button>
          )}
        </div>
      </div>

      {data.tlsError && (
        <div className="bg-warning/15 text-warning rounded-lg p-3 text-sm">
          ⚠️ {data.tlsError} — connections still work, but without encryption.
        </div>
      )}
      {settings.enabled && !data.running && data.error && (
        <div className="bg-danger/15 text-danger rounded-lg p-3 text-sm">
          🚫 {data.error}
          <span className="block text-xs mt-1 opacity-80">
            Another process may be using port {settings.port}. Change the port below, or open it in your firewall.
          </span>
        </div>
      )}
      {settings.enabled && data.running && !endpoint.ftps && (
        <div className="bg-warning/10 text-warning rounded-lg p-3 text-sm">
          ⚠️ Running without TLS: passwords cross the network in the clear. Add a certificate under server settings, or
          keep this port on a private network.
        </div>
      )}

      {/* Connection details */}
      <div className="gaming-surface rounded-xl p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">🔌 Connect</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-text-muted mb-1">Host</p>
            <p className="font-mono">{endpoint.hostOnly}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1">Port</p>
            <p className="font-mono">{endpoint.port}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1">Encryption</p>
            <p>{endpoint.ftps ? "Explicit FTPS (AUTH TLS)" : "None"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1">Passive ports</p>
            <p className="font-mono">{endpoint.passivePorts}</p>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          {endpoint.advertised
            ? "The host above is the advertised address from server settings."
            : "In FileZilla use “Require explicit FTP over TLS” when a certificate is configured; otherwise plain FTP."}{" "}
          Each login only reaches the servers listed below it — never the whole fleet. Large transfers are streamed
          straight to disk; the only limits are the upload cap
          {settings.maxUploadMb > 0 ? ` (${settings.maxUploadMb} MB)` : " (none)"} and free space. Firewall the passive
          range above too, or transfers will hang after login.
        </p>
      </div>

      {/* Accounts */}
      <div className="gaming-surface rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2">🔑 Your logins</h3>
          {data.can.manage && (
            <button
              onClick={() => void act({ action: "create" }, "Login created")}
              disabled={busy}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              + Login for all my servers
            </button>
          )}
        </div>

        {data.servers.length === 0 && (
          <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-secondary">
            No servers are reachable yet. File transfer is granted <strong>per server</strong>: a server appears here when
            you own it, or when its owner enables <span className="font-mono">📡 file transfer</span> for you in that
            server&apos;s Sharing section. A panel-wide role cannot widen that.
          </div>
        )}

        {!data.can.manage && (
          <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-secondary">
            Your role can use existing logins but not create them. An administrator can grant{" "}
            <span className="font-mono text-text-primary">transfer.manage</span> under Roles → File Transfer.
          </div>
        )}

        {data.accounts.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No logins yet. Create one and every server you can file-manage appears as its own folder — connect with
            FileZilla, WinSCP, lftp or curl and drag files in.
          </p>
        ) : (
          <div className="space-y-3">
            {data.accounts.map((account) => {
              const scope = account.serverId
                ? data.servers.find((s) => s.serverId === account.serverId)?.label ?? `server ${account.serverId}`
                : "all my servers";
              const password = account.password ?? "";
              return (
                <div key={account.id} className="bg-bg-secondary rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-mono font-medium flex items-center gap-2">
                        {account.username}
                        {account.online && <span className="px-2 py-0.5 rounded-full text-[10px] bg-success/15 text-success">online</span>}
                        {!account.enabled && <span className="px-2 py-0.5 rounded-full text-[10px] bg-danger/15 text-danger">disabled</span>}
                        {!account.readable && <span className="px-2 py-0.5 rounded-full text-[10px] bg-warning/15 text-warning">rotate needed</span>}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        Sees {scope} · last login {fmtWhen(account.lastLoginAt)}
                        {account.lastLoginIp ? ` from ${account.lastLoginIp}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {data.can.disconnect && account.online && (
                        <button
                          onClick={() => void act({ action: "disconnect", accountId: account.id }, "Sessions dropped")}
                          disabled={busy}
                          className="px-3 py-1.5 bg-bg-primary hover:bg-border rounded-lg text-xs disabled:opacity-50"
                        >
                          ⏏ Drop sessions
                        </button>
                      )}
                      {data.can.manage && (
                        <>
                          <button
                            onClick={() => void act({ action: "rotate", accountId: account.id }, "Password rotated")}
                            disabled={busy}
                            className="px-3 py-1.5 bg-bg-primary hover:bg-border rounded-lg text-xs disabled:opacity-50"
                          >
                            ⟳ Rotate password
                          </button>
                          <button
                            onClick={() => void act({ action: account.enabled ? "disable" : "enable", accountId: account.id }, account.enabled ? "Login disabled" : "Login enabled")}
                            disabled={busy}
                            className="px-3 py-1.5 bg-bg-primary hover:bg-border rounded-lg text-xs disabled:opacity-50"
                          >
                            {account.enabled ? "⏸ Disable" : "▶ Enable"}
                          </button>
                          <button
                            onClick={() => void removeAccount(account)}
                            disabled={busy}
                            className="px-3 py-1.5 bg-danger/15 text-danger hover:bg-danger/25 rounded-lg text-xs disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {account.password === null ? (
                    <p className="text-xs text-warning">
                      This password can no longer be decrypted (the panel secret changed). Rotate it to restore access.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono flex-1 min-w-[220px] break-all">
                        {revealed[account.id] ? password : "•".repeat(Math.min(password.length, 24))}
                      </code>
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [account.id]: !r[account.id] }))}
                        className="px-3 py-2 bg-bg-primary hover:bg-border rounded-lg text-xs"
                      >
                        {revealed[account.id] ? "🙈 Hide" : "👁 Reveal"}
                      </button>
                      <button
                        onClick={() => void copy(password, "Password copied")}
                        className="px-3 py-2 bg-bg-primary hover:bg-border rounded-lg text-xs"
                      >
                        📋 Copy password
                      </button>
                      <button
                        onClick={() =>
                          void copy(
                            [
                              `Host: ${endpoint.hostOnly}`,
                              `Port: ${endpoint.port}`,
                              `Username: ${account.username}`,
                              `Password: ${password}`,
                              `Encryption: ${endpoint.ftps ? "Explicit FTP over TLS" : "Plain FTP"}`,
                              `Folder: ${account.serverId ? data.servers.find((s) => s.serverId === account.serverId)?.folder ?? "/" : "/<server folder>"}`,
                            ].join("\n"),
                            "Connection details copied"
                          )
                        }
                        className="px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium"
                      >
                        📋 Copy connection details
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data.can.manage && data.servers.length > 0 && (
          <div className="border-t border-border pt-4 space-y-2">
            <p className="text-xs font-medium text-text-secondary">
              Servers you can upload to
              {data.servers.some((srv) => srv.shared) && (
                <span className="text-text-muted"> · those marked <span className="text-success">shared</span> were granted to you per server</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {data.servers.map((server) => (
                <button
                  key={`${server.serverId}-${server.folder}`}
                  onClick={() => void act({ action: "create-scoped", serverId: server.serverId }, "Server login created")}
                  disabled={busy || !server.serverId}
                  title="Create a login rooted inside this folder"
                  className="px-3 py-1.5 bg-bg-secondary hover:bg-border rounded-lg text-xs disabled:opacity-50"
                >
                  📁 <span className="font-mono">{server.folder}</span> · {server.label}
                  {server.shared && <span className="ml-1 text-[10px] text-success">shared</span>}
                  {" "}<span className="opacity-60">+login</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Script / client examples */}
      {data.accounts[0] && (
        <div className="gaming-surface rounded-xl p-6 space-y-3">
          <h3 className="font-semibold">📥 Push a big file without a GUI</h3>
          <p className="text-xs text-text-muted">
            Replace <span className="font-mono">PASSWORD</span> and the folder name with the ones above. Both commands
            resume-safe: <span className="font-mono">lftp</span> mirrors directories,{" "}
            <span className="font-mono">curl -T</span> streams a single file.
          </p>
          {[
            `curl -T ./world.tar.gz -u '${data.accounts[0].username}:PASSWORD' ${endpoint.ftps ? "--ssl-reqd " : ""}ftp://${endpoint.hostOnly}:${endpoint.port}/${data.servers[0]?.folder ?? ""}/`,
            `lftp -u '${data.accounts[0].username},PASSWORD' ${endpoint.ftps ? "--use-ssl " : ""}${endpoint.hostOnly}:${endpoint.port}`,
          ].map((line) => (
            <div key={line} className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono break-all">{line}</code>
              <button onClick={() => void copy(line, "Command copied")} className="px-3 py-2 bg-bg-secondary hover:bg-border rounded-lg text-xs">
                📋
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Live stats */}
      {stats && (
        <div className="gaming-surface rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">📊 Activity</h3>
            <span className="text-xs text-text-muted">{stats.loggedIn} logged in</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-text-muted">Uploaded</p><p className="font-mono">{fmtSize(stats.bytesIn)}</p></div>
            <div><p className="text-xs text-text-muted">Downloaded</p><p className="font-mono">{fmtSize(stats.bytesOut)}</p></div>
            <div><p className="text-xs text-text-muted">Uploads</p><p className="font-mono">{stats.uploads}</p></div>
            <div><p className="text-xs text-text-muted">Connections</p><p className="font-mono">{stats.connections}</p></div>
          </div>
          {stats.recent.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border">
              {stats.recent.slice(0, 6).map((entry, index) => (
                <p key={`${entry.at}-${index}`} className="text-xs text-text-muted font-mono">
                  {entry.ok ? "✅" : "❌"} {entry.type === "upload" ? "↑" : "↓"} {entry.username} · {fmtSize(entry.bytes)} ·{" "}
                  {entry.path} · {fmtTime(entry.at)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Listener settings — transfer.settings */}
      {data.can.settings && form && (
        <form onSubmit={saveSettings} className="gaming-surface border-accent/30 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="font-semibold">⚙️ Server settings</h3>
            <p className="text-xs text-text-muted mt-1">
              Saved to the database and applied immediately (the listener restarts). Environment variables
              (<span className="font-mono">GSM_FTP_*</span>) provide the defaults these override.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input
                type="checkbox"
                checked={Boolean(form.ftp_enabled)}
                onChange={(e) => setForm({ ...form, ftp_enabled: e.target.checked })}
              />
              Enable the file transfer server
            </label>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Port</label>
              <input className={inputClass} value={String(form.ftp_port)} onChange={(e) => setForm({ ...form, ftp_port: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Bind address</label>
              <input className={inputClass} value={String(form.ftp_bind_host)} onChange={(e) => setForm({ ...form, ftp_bind_host: e.target.value })} placeholder="0.0.0.0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Advertised host</label>
              <input className={inputClass} value={String(form.ftp_masquerade_host)} onChange={(e) => setForm({ ...form, ftp_masquerade_host: e.target.value })} placeholder="ftp.example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Passive range start</label>
              <input className={inputClass} value={String(form.ftp_passive_min)} onChange={(e) => setForm({ ...form, ftp_passive_min: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Passive range end</label>
              <input className={inputClass} value={String(form.ftp_passive_max)} onChange={(e) => setForm({ ...form, ftp_passive_max: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Upload cap (MB, 0 = none)</label>
              <input className={inputClass} value={String(form.ftp_max_upload_mb)} onChange={(e) => setForm({ ...form, ftp_max_upload_mb: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">TLS certificate path</label>
              <input className={inputClass} value={String(form.ftp_tls_cert)} onChange={(e) => setForm({ ...form, ftp_tls_cert: e.target.value })} placeholder="/etc/letsencrypt/live/ftp.example.com/fullchain.pem" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">TLS key path</label>
              <input className={inputClass} value={String(form.ftp_tls_key)} onChange={(e) => setForm({ ...form, ftp_tls_key: e.target.value })} placeholder="/etc/letsencrypt/live/ftp.example.com/privkey.pem" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Idle timeout (seconds)</label>
              <input className={inputClass} value={String(form.ftp_idle_timeout)} onChange={(e) => setForm({ ...form, ftp_idle_timeout: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Connection limit</label>
              <input className={inputClass} value={String(form.ftp_max_connections)} onChange={(e) => setForm({ ...form, ftp_max_connections: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-text-muted">
            The certificate is read by the panel process, so the file must be readable by it (a Let&apos;s Encrypt
            <span className="font-mono"> privkey.pem</span> usually is not — copy it, or grant the panel read access).
          </p>
          <div className="border-t border-border pt-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[16rem]">
              <p className="text-sm font-medium">Firewall (UFW)</p>
              <p className="text-xs text-text-muted mt-0.5">
                Clients need the control port and every port in the passive range. One click opens TCP{" "}
                <span className="font-mono">{String(form.ftp_port)}</span> and{" "}
                <span className="font-mono">
                  {String(form.ftp_passive_min)}:{String(form.ftp_passive_max)}
                </span>{" "}
                tagged <span className="font-mono">GSM: FTP</span>; the second button removes those rules.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void firewall("open")}
              className="px-4 py-2 bg-bg-secondary hover:bg-border rounded-lg text-sm disabled:opacity-50"
            >
              Open ports
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void firewall("close")}
              className="px-4 py-2 bg-bg-secondary hover:bg-border rounded-lg text-sm disabled:opacity-50"
            >
              Remove rules
            </button>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium disabled:opacity-50">
              Save & apply
            </button>
            <button type="button" onClick={() => setForm(null)} className="px-5 py-2.5 bg-bg-secondary hover:bg-border rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Every account on the panel — transfer.any */}
      {data.admin && (
        <div className="gaming-surface rounded-xl p-6 space-y-3">
          <h3 className="font-semibold">🗂️ All transfer logins</h3>
          {data.admin.accounts.length === 0 ? (
            <p className="text-sm text-text-secondary">No logins exist yet on this panel.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-muted">
                    <th className="py-2">Username</th>
                    <th className="py-2">Owner</th>
                    <th className="py-2">Scope</th>
                    <th className="py-2">Last login</th>
                    <th className="py-2">State</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.admin.accounts.map((account) => (
                    <tr key={account.id} className="border-t border-border">
                      <td className="py-2 font-mono">{account.username}</td>
                      <td className="py-2">{account.owner ?? "—"}</td>
                      <td className="py-2">{account.serverName ?? "all servers"}</td>
                      <td className="py-2 text-xs text-text-muted">
                        {fmtWhen(account.lastLoginAt)}
                        {account.lastLoginIp ? ` · ${account.lastLoginIp}` : ""}
                      </td>
                      <td className="py-2 text-xs">
                        {account.enabled ? <span className="text-success">enabled</span> : <span className="text-danger">disabled</span>}
                        {account.online && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] bg-success/15 text-success">online</span>}
                      </td>
                      <td className="py-2 text-right">
                        {data.can.disconnect && account.online && (
                          <button
                            onClick={() => void act({ action: "disconnect", accountId: account.id }, "Sessions dropped")}
                            disabled={busy}
                            className="px-2 py-1 bg-bg-secondary hover:bg-border rounded text-xs mr-2 disabled:opacity-50"
                          >
                            ⏏ Drop
                          </button>
                        )}
                        <button
                          onClick={() => void act({ action: "rotate", accountId: account.id }, "Password rotated")}
                          disabled={busy}
                          className="px-2 py-1 bg-bg-secondary hover:bg-border rounded text-xs disabled:opacity-50"
                        >
                          ⟳ Rotate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Short clock for the recent-transfer list. */
function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}
