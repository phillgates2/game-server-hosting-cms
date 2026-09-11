"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { isKeyStale } from "@/lib/key-hygiene";

interface PanelAccessKey {
  id: number;
  keyPrefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

/**
 * The CD-key gate: when enabled, nobody can log in or register without a key
 * minted here. Rendered inside the API Keys panel; silently hides itself for
 * anyone who cannot manage it (the list endpoint is admin-only).
 */
export default function AccessGateSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const [allowed, setAllowed] = useState(true);
  const [gateOn, setGateOn] = useState(false);
  const [keys, setKeys] = useState<PanelAccessKey[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  // Plaintext is shown exactly once, right after minting.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [gateRes, keysRes] = await Promise.all([
        fetch("/api/auth/access-gate"),
        fetch("/api/access-keys"),
      ]);
      if (!keysRes.ok) {
        setAllowed(false);
        return;
      }
      setKeys((await keysRes.json()).keys || []);
      if (gateRes.ok) setGateOn(Boolean((await gateRes.json()).required));
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

  async function toggleGate() {
    setBusy(true);
    try {
      const res = await fetch("/api/access-keys/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !gateOn }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Access gate", data?.error || "Could not update the gate");
        return;
      }
      setGateOn(Boolean(data.enabled));
      if (data.bootstrapKey) {
        setRevealedKey(data.bootstrapKey);
        toast.warning(
          "Gate enabled",
          "No keys existed, so one was created. Copy it now — it is shown only once."
        );
      } else {
        toast.success("Access gate", data.enabled ? "Enabled. New logins need a key." : "Disabled.");
      }
      void load();
    } catch {
      toast.error("Access gate", "Could not update the gate");
    } finally {
      setBusy(false);
    }
  }

  async function mintKey() {
    setBusy(true);
    try {
      const res = await fetch("/api/access-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Access key", data?.error || "Could not create the key");
        return;
      }
      setRevealedKey(data.key);
      setLabel("");
      void load();
    } catch {
      toast.error("Access key", "Could not create the key");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(key: PanelAccessKey) {
    const ok = await confirm({
      title: "Revoke access key",
      message: `Revoke ${key.keyPrefix}…${key.label ? ` (${key.label})` : ""}? Anyone using it loses panel access immediately.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/access-keys/${key.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error("Access key", data?.error || "Could not revoke the key");
        return;
      }
      toast.success("Access key", "Revoked.");
      void load();
    } catch {
      toast.error("Access key", "Could not revoke the key");
    }
  }

  if (!allowed) return null;
  if (!loaded) return null;

  const activeCount = keys.filter((k) => k.active).length;

  return (
    <div className="gaming-surface rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">🔑 Panel access gate (CD-key)</h3>
          <p className="text-sm text-text-secondary mt-0.5">
            When on, nobody can log in or register without a key you hand them.
          </p>
        </div>
        <button
          onClick={() => void toggleGate()}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
            gateOn ? "bg-success/15 text-success hover:bg-success/25" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
          }`}
        >
          {busy ? "Working…" : gateOn ? "✅ Gate ON — click to disable" : "Enable gate"}
        </button>
      </div>

      {gateOn && activeCount === 0 && (
        <p className="mt-3 text-xs text-danger font-medium">
          ⚠️ The gate is on but no active keys exist — only the master-key environment override can get in. Mint a key now.
        </p>
      )}

      {revealedKey && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-medium text-warning">Copy this key now — it is shown only once:</p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <code className="px-3 py-2 rounded bg-bg-secondary font-mono text-lg tracking-wider">{revealedKey}</code>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(revealedKey);
                toast.success("Copied", "Key copied to clipboard.");
              }}
              className="px-3 py-2 rounded-lg bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25"
            >
              📋 Copy
            </button>
            <button
              onClick={() => setRevealedKey(null)}
              className="px-3 py-2 rounded-lg bg-bg-tertiary text-text-muted text-xs font-medium hover:bg-bg-hover"
            >
              I saved it — hide
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-text-muted mb-1">Label (who is this key for?)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Ally — TF2 community"
            maxLength={128}
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <button
          onClick={() => void mintKey()}
          disabled={busy}
          className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium"
        >
          ➕ Mint new key
        </button>
      </div>

      {keys.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-text-muted border-b border-border">
                <th className="py-2 pr-3">Key</th>
                <th className="py-2 pr-3">Label</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Last used</th>
                <th className="py-2 pr-3">Health</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-mono">{k.keyPrefix}…</td>
                  <td className="py-2 pr-3 text-text-secondary">{k.label || "—"}</td>
                  <td className="py-2 pr-3 text-text-muted">{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-3 text-text-muted">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                  <td className="py-2 pr-3">
                    {k.active && isKeyStale({ createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }, now) && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-warning/15 text-warning" title="Not used recently — consider revoking if it was temporary.">stale</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {k.active ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-success/15 text-success">active</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-bg-tertiary text-text-muted">revoked</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {k.active && (
                      <button
                        onClick={() => void revokeKey(k)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-danger/15 text-danger hover:bg-danger/25"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
