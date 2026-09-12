"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * The unified master key — the ONLY key left (Stage 42 removed the CD-key
 * login gate). One key, three powers: guards fresh installs, validates as an
 * unlimited license key, and administers the shop/license APIs via the
 * X-Master-Key header. Rendered inside the API Keys panel; silently hides
 * itself for anyone who cannot manage it (the status endpoint is admin-only).
 */
export default function MasterKeySection() {
  const toast = useToast();
  const confirm = useConfirm();
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mkState, setMkState] = useState<{ env: boolean; stored: boolean } | null>(null);
  const [mkRevealed, setMkRevealed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const mkRes = await fetch("/api/settings/master-key");
      if (!mkRes.ok) {
        setAllowed(false);
        return;
      }
      const mk = await mkRes.json().catch(() => null);
      if (mk) setMkState({ env: mk.env === true, stored: mk.stored === true });
    } catch {
      /* leave defaults */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function rotateMasterKey() {
    if (busy) return;
    const replacing = mkState?.stored || mkState?.env;
    const ok = await confirm({
      title: replacing ? "Rotate the master key" : "Generate the master key",
      message: replacing
        ? "Rotating replaces the current master key — anything using the old one stops working immediately. Continue?"
        : "The master key guards fresh installs, validates as an unlimited license key, and administers the shop/license APIs via the X-Master-Key header. It is shown exactly once.",
      confirmLabel: replacing ? "Rotate" : "Generate",
      danger: Boolean(replacing),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/master-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.key) {
        setMkRevealed(data.key);
        setMkState((m) => ({ env: m?.env ?? false, stored: true }));
      } else toast.error("Master key", data?.error || "Could not generate the master key");
    } finally { setBusy(false); }
  }

  async function revokeMasterKey() {
    if (busy) return;
    const ok = await confirm({
      title: "Revoke the stored master key",
      message: "Anything using the stored master key stops working. The GSM_PANEL_MASTER_KEY environment key (if set) keeps working. Continue?",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/master-key", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) { toast.success("Master key revoked", ""); setMkState((m) => ({ env: m?.env ?? false, stored: false })); }
      else toast.error("Master key", data?.error || "Could not revoke the master key");
    } finally { setBusy(false); }
  }

  if (!allowed) return null;
  if (!loaded) return null;

  return (
    <div className="gaming-surface rounded-xl p-5 mb-6">
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-semibold">🔑 Master key</h3>
            <p className="text-sm text-text-secondary mt-0.5">
              Your one and only key — the CD-key login gate was removed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mkState?.stored && (
              <button onClick={() => void revokeMasterKey()} disabled={busy} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-danger/15 text-danger hover:bg-danger/25 disabled:opacity-40">Revoke stored key</button>
            )}
            <button onClick={() => void rotateMasterKey()} disabled={busy} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40">
              {busy ? "Working…" : mkState?.stored ? "Rotate" : "Generate"}
            </button>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          One key, three powers: guards <b>fresh installs</b> of this panel, validates as an <b>unlimited license key</b> (installs any panel, any time), and administers the shop &amp; license APIs via the <code className="text-[11px]">X-Master-Key</code> header — no login session needed. Only you should ever hold it.
          Status: {mkState === null ? "checking…" : <>{mkState.stored ? <span className="text-success">stored ✓</span> : <span className="text-text-muted">no stored key</span>}{mkState.env ? <span className="text-success"> · env key active</span> : null}</>}
        </p>
        {mkRevealed && (
          <div className="rounded-lg border border-success/40 bg-success/10 p-3 space-y-1">
            <p className="text-xs font-semibold text-success">Master key — shown exactly once. Store it somewhere safe:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-bg-card border border-border px-2 py-1.5 text-xs font-mono text-text-primary">{mkRevealed}</code>
              <button onClick={() => { void navigator.clipboard.writeText(mkRevealed).then(() => toast.success("Copied", "Master key copied.")); }} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover">Copy</button>
              <button onClick={() => setMkRevealed(null)} className="text-xs text-text-muted hover:text-text-primary">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
