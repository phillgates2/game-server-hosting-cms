"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmDialog";

interface ApiKey {
  id: number; name: string; keyPrefix: string;
  permissions: Record<string, boolean> | null;
  lastUsedAt: string | null; expiresAt: string | null; createdAt: string;
}

export default function ApiKeysPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", expiresInDays: "" });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/api-keys");
      if (res.ok) setKeys((await res.json()).keys || []);
    } catch { /**/ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, expiresInDays: form.expiresInDays ? parseInt(form.expiresInDays) : undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error("Failed", data.error); return; }
      setNewKey(data.secretKey);
      toast.success("API Key Created", "Copy the key now — it won't be shown again.");
      setShowCreate(false);
      setForm({ name: "", expiresInDays: "" });
      load();
    } catch (e) { toast.error("Error", e instanceof Error ? e.message : "Failed"); }
  }

  async function deleteKey(id: number, name: string) {
    const ok = await confirm({ title: "Delete API Key", message: `Delete "${name}"? Any tools using this key will stop working.`, confirmLabel: "Delete Key", danger: true });
    if (!ok) return;
    await fetch("/api/api-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    toast.info("API Key Deleted", name);
    load();
  }

  function copyKey() {
    if (newKey) { navigator.clipboard.writeText(newKey).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  const ic = "w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm";

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold">🔐 API Keys</h2><p className="text-text-secondary text-sm">Generate personal API keys for external tools and scripts</p></div>
        <button onClick={() => { setShowCreate(!showCreate); setNewKey(null); }} className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">{showCreate ? "✕ Cancel" : "+ New Key"}</button>
      </div>

      {/* New key reveal */}
      {newKey && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2"><span className="text-xl">⚠️</span><h3 className="font-bold text-warning">Save Your API Key Now</h3></div>
          <p className="text-sm text-text-secondary">This key will <strong>never be shown again</strong>. Copy it and store it securely.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-4 py-3 bg-[#0d1117] border border-border rounded-lg text-sm font-mono text-success break-all">{newKey}</code>
            <button onClick={copyKey} className="px-4 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium flex-shrink-0">{copied ? "✓ Copied" : "📋 Copy"}</button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-text-muted hover:text-text-primary">I've saved it — dismiss</button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createKey} className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Create API Key</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Key Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={ic} required placeholder="My Script" /></div>
            <div><label className="block text-xs font-medium text-text-secondary mb-1.5">Expires In (days)</label><input type="number" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} className={ic} placeholder="Leave blank for no expiry" /></div>
          </div>
          <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-muted">
            <p className="font-medium text-text-secondary mb-1">API Usage</p>
            <p>Include the key in your requests as a header:</p>
            <code className="block mt-1 text-accent">Authorization: Bearer gsm_your_key_here</code>
          </div>
          <button type="submit" className="px-6 py-2.5 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Generate Key</button>
        </form>
      )}

      {!loaded && <div className="text-center py-12"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {loaded && keys.length === 0 && !showCreate && !newKey && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">🔐</span><h3 className="font-semibold mb-1">No API keys</h3>
          <p className="text-text-secondary text-sm">Create an API key to access the panel from external tools, scripts, or automations.</p>
        </div>
      )}

      {keys.length > 0 && (
        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="bg-bg-card border border-border rounded-xl p-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <span className="text-2xl">🔑</span>
                <div>
                  <h3 className="font-semibold">{key.name}</h3>
                  <div className="flex gap-3 mt-1 text-xs text-text-muted">
                    <span className="font-mono">{key.keyPrefix}•••</span>
                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                    {key.lastUsedAt && <span>Last used {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                    {key.expiresAt && <span className={new Date(key.expiresAt) < new Date() ? "text-danger" : ""}>Expires {new Date(key.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => deleteKey(key.id, key.name)} className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-xs font-medium">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
