"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

interface LicenseKeyInfo {
  id: number;
  prefix: string;
  label: string | null;
  maxActivations: number;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
  activations: number;
}

interface AnalyticsSummary {
  totalKeys: number;
  revokedKeys: number;
  unusedKeys: number;
  activeKeys: number;
  silentKeys: number;
  darkKeys: number;
  totalActivations: number;
  activeActivations: number;
}

interface ActivationInfo {
  id: number;
  hostname: string | null;
  panelUrl: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export default function LicensesPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<LicenseKeyInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [maxAct, setMaxAct] = useState(1);
  const [expires, setExpires] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [openActivations, setOpenActivations] = useState<number | null>(null);
  const [activations, setActivations] = useState<ActivationInfo[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLine, setAnalyticsLine] = useState<string | null>(null);
  const [keyHealth, setKeyHealth] = useState<Record<number, string>>({});
  const [signingKey, setSigningKey] = useState<{ configured: boolean; publicKey: string | null } | null>(null);
  const [offlineResult, setOfflineResult] = useState<{ token: string; publicKey: string; expiresAt: string } | null>(null);
  const [tokenDays, setTokenDays] = useState(90);

  async function loadSigningKeyState() {
    try {
      const res = await fetch("/api/license/signing-key");
      const data = await res.json().catch(() => null);
      if (res.ok) setSigningKey({ configured: data?.configured === true, publicKey: data?.publicKey ?? null });
    } catch { /* optional */ }
  }

  async function generateSigningKey() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/license/signing-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Signing key ready", "You can now issue offline tokens."); void loadSigningKeyState(); }
      else toast.error("Signing key", data?.error || "Could not generate the key");
    } finally { setBusy(false); }
  }

  async function issueOfflineToken(keyId: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/license/keys/${keyId}/offline-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: tokenDays }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.token) setOfflineResult({ token: data.token, publicKey: data.publicKey, expiresAt: data.expiresAt });
      else toast.error("Offline token", data?.error || "Could not issue the token");
    } finally { setBusy(false); }
  }

  async function load() {
    try {
      const res = await fetch("/api/license/keys");
      const data = await res.json().catch(() => null);
      if (res.ok) setKeys(data?.keys ?? []);
      else toast.error("Licenses", data?.error || "Could not load license keys");
    } catch { /* panel keeps working */ }
    finally { setLoaded(true); }
    try {
      const res = await fetch("/api/license/analytics");
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setAnalytics(data.summary ?? null);
        setAnalyticsLine(data.line ?? null);
        const health: Record<number, string> = {};
        for (const k of data.keys ?? []) health[k.keyId] = k.health;
        setKeyHealth(health);
      }
    } catch { /* analytics are optional sugar */ }
    void loadSigningKeyState();
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function issueKey() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/license/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          maxActivations: maxAct,
          expiresAt: expires || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.key) {
        setIssuedKey(data.key);
        setLabel(""); setExpires("");
        void load();
      } else {
        toast.error("Issue failed", data?.error || "Could not issue the key");
      }
    } catch (e) { toast.error("Issue failed", e instanceof Error ? e.message : "Network error"); }
    finally { setBusy(false); }
  }

  async function revokeKey(id: number, prefix: string) {
    const ok = await confirm({
      title: "Revoke license",
      message: `Revoke ${prefix}? Installations using it will fail re-validation immediately. This cannot be undone.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/license/keys/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Revoked", `${prefix} can no longer be used.`); void load(); }
      else toast.error("Revoke failed", data?.error || "Could not revoke the key");
    } finally { setBusy(false); }
  }

  async function showActivations(id: number) {
    if (openActivations === id) { setOpenActivations(null); return; }
    setOpenActivations(id);
    setActivations([]);
    try {
      const res = await fetch(`/api/license/keys/${id}`);
      const data = await res.json().catch(() => null);
      if (res.ok) setActivations(data?.activations ?? []);
    } catch { /* empty list stays */ }
  }

  async function copyKey(key: string) {
    try { await navigator.clipboard.writeText(key); toast.success("Copied", "License key copied to clipboard."); }
    catch { toast.error("Copy failed", "Select and copy the key manually."); }
  }

  return (
    <div className="space-y-4">
      {/* Issued-once banner */}
      {issuedKey && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-success">✅ License key issued — this is the ONLY time it is shown:</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="rounded-lg bg-bg-card border border-border px-3 py-2 text-sm text-text-primary font-mono">{issuedKey}</code>
            <button onClick={() => void copyKey(issuedKey)} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
            <button onClick={() => setIssuedKey(null)} className="text-xs text-text-muted hover:text-text-primary">Dismiss</button>
          </div>
          <p className="text-[11px] text-text-muted">Give this key to your customer — their installer will validate it against this panel. Only the hash is stored here.</p>
        </div>
      )}

      {/* Usage analytics */}
      {analytics && (
        <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold">📈 License usage</h3>
            {analyticsLine && <span className="text-xs text-text-secondary">{analyticsLine}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-success/10 px-3 py-1.5 text-xs text-success">{analytics.activeKeys} active keys</span>
            <span className="rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning">{analytics.silentKeys} silent (7-30d)</span>
            <span className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger">{analytics.darkKeys} dark (30d+)</span>
            <span className="rounded-lg bg-bg-secondary px-3 py-1.5 text-xs text-text-muted">{analytics.unusedKeys} unused</span>
            <span className="rounded-lg bg-bg-secondary px-3 py-1.5 text-xs text-text-muted">{analytics.revokedKeys} revoked</span>
            <span className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent">{analytics.activeActivations}/{analytics.totalActivations} installs phoned home</span>
          </div>
        </div>
      )}

      {/* Issue form */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">🎟️ Issue a license key</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={128} placeholder="Label — e.g. customer name or order #" className="min-w-[220px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted" />
          <label className="text-xs text-text-muted flex items-center gap-1">
            Activations
            <input type="number" min={1} max={100} value={maxAct} onChange={(e) => setMaxAct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-16 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
          </label>
          <label className="text-xs text-text-muted flex items-center gap-1">
            Expires
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary" />
          </label>
          <button onClick={() => void issueKey()} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">{busy ? "Working…" : "Issue key"}</button>
        </div>
        <p className="text-[10px] text-text-muted">1 activation = 1 installation. Re-validation from the same machine never consumes an extra activation.</p>
      </div>

      {/* Offline token result */}
      {offlineResult && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-accent">📦 Offline token issued (expires {new Date(offlineResult.expiresAt).toLocaleDateString()}) — hand BOTH to the customer:</p>
          <p className="text-[11px] text-text-muted">1) Token:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-bg-card border border-border px-3 py-2 text-xs font-mono text-text-primary">{offlineResult.token}</code>
            <button onClick={() => { void navigator.clipboard.writeText(offlineResult.token).then(() => toast.success("Copied", "Token copied.")); }} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
          </div>
          <p className="text-[11px] text-text-muted">2) Public key (verifies the token):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-bg-card border border-border px-3 py-2 text-xs font-mono text-text-primary">{offlineResult.publicKey.replace(/\n/g, " ")}</code>
            <button onClick={() => { void navigator.clipboard.writeText(offlineResult.publicKey).then(() => toast.success("Copied", "Public key copied.")); }} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover">Copy</button>
            <button onClick={() => setOfflineResult(null)} className="text-xs text-text-muted hover:text-text-primary">Dismiss</button>
          </div>
          <p className="text-[10px] text-text-muted">Install with: bash install.sh --license-token &lt;token&gt; --license-pubkey pubkey.pem  — or paste both into the web installer.</p>
        </div>
      )}

      {/* Signing key for offline tokens */}
      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold">🔏 Offline tokens (air-gapped installs)</h3>
          {signingKey && !signingKey.configured && (
            <button onClick={() => void generateSigningKey()} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">{busy ? "Working…" : "Generate signing key"}</button>
          )}
        </div>
        {signingKey === null ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : signingKey.configured ? (
          <>
            <p className="text-xs text-text-secondary">Signing key ready — use “Offline token” on any key below. Tokens are Ed25519-signed and verified locally on the customer box; no network needed.</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">Token lifetime</label>
              <select value={tokenDays} onChange={(e) => setTokenDays(Number(e.target.value))} className="rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary">
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>
          </>
        ) : (
          <p className="text-xs text-text-muted">Generate an Ed25519 signing key to issue pre-signed tokens for air-gapped customers. The private key stays in this panel&apos;s database; only the public half travels.</p>
        )}
      </div>

      {/* Key list */}
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Issued keys</h3>
        {!loaded ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-text-muted">No license keys yet — issue one above to distribute installations.</p>
        ) : (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.id}>
                <div className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-secondary px-3 py-2">
                  <code className="font-mono text-xs text-text-primary">{k.prefix}</code>
                  <span className="text-xs text-text-secondary truncate max-w-[180px]">{k.label ?? "—"}</span>
                  <button onClick={() => void showActivations(k.id)} className="text-[11px] text-accent hover:underline">{k.activations}/{k.maxActivations} activations</button>
                  {k.expiresAt ? <span className="text-[10px] text-text-muted">expires {new Date(k.expiresAt).toLocaleDateString()}</span> : <span className="text-[10px] text-text-muted">never expires</span>}
                  <span className="flex-1" />
                  {!k.revoked && signingKey?.configured && (
                    <button onClick={() => void issueOfflineToken(k.id)} disabled={busy} className="text-[11px] text-accent hover:underline disabled:opacity-40">Offline token</button>
                  )}
                  {!k.revoked && keyHealth[k.id] && keyHealth[k.id] !== "never" && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${keyHealth[k.id] === "active" ? "bg-success/15 text-success" : keyHealth[k.id] === "silent" ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger"}`}
                      title={keyHealth[k.id] === "active" ? "Phoned home within 7 days" : keyHealth[k.id] === "silent" ? "Last seen 7-30 days ago" : "Not seen in 30+ days"}
                    >{keyHealth[k.id]}</span>
                  )}
                  {k.revoked ? (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">revoked</span>
                  ) : (
                    <button onClick={() => void revokeKey(k.id, k.prefix)} disabled={busy} className="text-[11px] text-text-muted hover:text-danger disabled:opacity-40">Revoke</button>
                  )}
                </div>
                {openActivations === k.id && (
                  <div className="mt-1 ml-4 space-y-1">
                    {activations.length === 0 ? (
                      <p className="text-[11px] text-text-muted">No activations yet.</p>
                    ) : activations.map((a) => (
                      <p key={a.id} className="text-[11px] font-mono text-text-secondary">
                        {a.hostname ?? "?"} · {a.panelUrl ?? "?"} · {a.ipAddress ?? "?"} · first {new Date(a.createdAt).toLocaleString()} · seen {new Date(a.lastSeenAt).toLocaleString()}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
