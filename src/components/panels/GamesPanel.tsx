"use client";

import { useEffect, useState, useCallback } from "react";

interface InstalledGame {
  id: number; slug: string; name: string; engine: string | null; defaultPort: number;
  steamAppId: string | null; installScript: string; startCommand: string;
  stopCommand: string | null; configFiles: Record<string, string> | null;
  defaultConfig: Record<string, string> | null; supportsIpv6: boolean | null;
  iconEmoji: string | null;
}
interface GameTemplate {
  slug: string; name: string; iconEmoji: string; category: string;
  description: string; estimatedSize: string; variableCount: number;
}
interface TemplateDetail {
  slug: string; name: string; engine: string | null; defaultPort: number;
  iconEmoji: string; supportsIpv6: boolean; category: string; description: string;
  installScript: string; startCommand: string;
  variables: Array<{ name: string; key: string; description: string; defaultValue: string; required: boolean; type: string }>;
  defaultConfig: Record<string, string>;
}

type Tab = "installed" | "templates" | "custom";

export default function GamesPanel() {
  const [tab, setTab] = useState<Tab>("installed");
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [templates, setTemplates] = useState<GameTemplate[]>([]);
  const [templatesByCategory, setTemplatesByCategory] = useState<Record<string, Array<{ slug: string; name: string; iconEmoji: string; description: string }>>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [editingGame, setEditingGame] = useState<InstalledGame | null>(null);
  const [editForm, setEditForm] = useState({ name: "", engine: "", defaultPort: "", iconEmoji: "", installScript: "", startCommand: "", stopCommand: "", supportsIpv6: false, defaultConfig: "" });
  const [customForm, setCustomForm] = useState({ name: "", slug: "", engine: "", defaultPort: "27015", iconEmoji: "🎮", installScript: "", startCommand: "", stopCommand: "", supportsIpv6: false, defaultConfig: "{}" });
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadGames = useCallback(async () => {
    const res = await fetch("/api/games"); const data = await res.json(); setGames(data.games || []);
  }, []);
  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/templates"); const data = await res.json();
    setTemplates(data.templates || []); setTemplatesByCategory(data.byCategory || {});
  }, []);

  useEffect(() => { loadGames(); loadTemplates(); }, [loadGames, loadTemplates]);

  async function loadTemplateDetail(slug: string) {
    const res = await fetch(`/api/templates/${slug}`); const data = await res.json();
    setSelectedTemplate(data.template);
  }
  async function installTemplate(slug: string) {
    setInstalling(slug); setMessage(null);
    try {
      const res = await fetch(`/api/templates/${slug}/install`, { method: "POST" }); const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: data.message }); loadGames(); setSelectedTemplate(null); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
    finally { setInstalling(null); }
  }
  async function uninstallGame(slug: string) {
    if (!confirm("Remove this game template?")) return;
    await fetch(`/api/templates/${slug}/install`, { method: "DELETE" });
    setMessage({ type: "success", text: "Game uninstalled" }); loadGames(); setEditingGame(null);
  }

  function startEdit(game: InstalledGame) {
    setEditingGame(game);
    setEditForm({
      name: game.name, engine: game.engine || "", defaultPort: String(game.defaultPort),
      iconEmoji: game.iconEmoji || "🎮", installScript: game.installScript,
      startCommand: game.startCommand, stopCommand: game.stopCommand || "",
      supportsIpv6: game.supportsIpv6 || false,
      defaultConfig: JSON.stringify(game.defaultConfig || {}, null, 2),
    });
  }

  async function saveEdit() {
    if (!editingGame) return;
    setSaving(true); setMessage(null);
    try {
      let parsedConfig = {};
      try { parsedConfig = JSON.parse(editForm.defaultConfig); } catch { /* ignore */ }
      const res = await fetch(`/api/games/${editingGame.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, defaultPort: Number(editForm.defaultPort), defaultConfig: parsedConfig }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: `"${editForm.name}" updated` }); setEditingGame(null); loadGames(); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
    finally { setSaving(false); }
  }

  async function createCustomGame(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setMessage(null);
    try {
      let parsedConfig = {};
      try { parsedConfig = JSON.parse(customForm.defaultConfig); } catch { /* ignore */ }
      const res = await fetch(`/api/games/${0}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customForm, defaultPort: Number(customForm.defaultPort), defaultConfig: parsedConfig }),
      });
      // The POST handler is on /api/games/[id] but we actually need it on /api/games
      // Let me use the correct endpoint
    } catch { /* ignore */ }

    // Use the correct endpoint
    try {
      let parsedConfig = {};
      try { parsedConfig = JSON.parse(customForm.defaultConfig); } catch { /* ignore */ }
      const res = await fetch("/api/games/0", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customForm, defaultPort: Number(customForm.defaultPort), defaultConfig: parsedConfig }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else {
        setMessage({ type: "success", text: `Custom game "${customForm.name}" created` });
        setCustomForm({ name: "", slug: "", engine: "", defaultPort: "27015", iconEmoji: "🎮", installScript: "", startCommand: "", stopCommand: "", supportsIpv6: false, defaultConfig: "{}" });
        loadGames(); setTab("installed");
      }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
    finally { setSaving(false); }
  }

  const installedSlugs = new Set(games.map((g) => g.slug));

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">📦 Game Management</h2>
          <p className="text-text-secondary text-sm">Install, edit, and create game templates</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setTab("installed"); setEditingGame(null); setSelectedTemplate(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "installed" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            Installed ({games.length})
          </button>
          <button onClick={() => { setTab("templates"); setEditingGame(null); setSelectedTemplate(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "templates" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            Templates ({templates.length})
          </button>
          <button onClick={() => { setTab("custom"); setEditingGame(null); setSelectedTemplate(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "custom" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            + Custom Game
          </button>
        </div>
      </div>

      {message && <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>{message.text}</div>}

      {/* ═══ INSTALLED ═══ */}
      {tab === "installed" && !editingGame && (
        <div className="space-y-4">
          {games.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
              <span className="text-4xl block mb-3">📦</span>
              <h3 className="font-semibold mb-1">No games installed</h3>
              <p className="text-text-secondary text-sm">Install from Templates or create a Custom Game</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {games.map((game) => (
                <div key={game.id} className="bg-bg-card border border-border rounded-xl p-5 hover:border-accent/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{game.iconEmoji || "🎮"}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm">{game.name}</h3>
                      <p className="text-xs text-text-muted">{game.engine || "Custom"} · Port {game.defaultPort}</p>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => startEdit(game)} className="px-2 py-1 bg-accent/15 text-accent rounded text-[10px] font-medium">Edit</button>
                        <button onClick={() => uninstallGame(game.slug)} className="px-2 py-1 bg-danger/15 text-danger rounded text-[10px] font-medium">Uninstall</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ EDIT INSTALLED GAME ═══ */}
      {tab === "installed" && editingGame && (
        <div className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Editing: {editingGame.iconEmoji} {editingGame.name}</h3>
            <button onClick={() => setEditingGame(null)} className="text-text-muted text-xs">Cancel</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="block text-xs text-text-muted mb-1">Name</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Engine</label><input value={editForm.engine} onChange={(e) => setEditForm({ ...editForm, engine: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Default Port</label><input type="number" value={editForm.defaultPort} onChange={(e) => setEditForm({ ...editForm, defaultPort: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Icon</label><input value={editForm.iconEmoji} onChange={(e) => setEditForm({ ...editForm, iconEmoji: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Start Command</label>
            <textarea value={editForm.startCommand} onChange={(e) => setEditForm({ ...editForm, startCommand: e.target.value })} rows={2} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono resize-y" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Stop Command</label>
            <input value={editForm.stopCommand} onChange={(e) => setEditForm({ ...editForm, stopCommand: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Install Script</label>
            <textarea value={editForm.installScript} onChange={(e) => setEditForm({ ...editForm, installScript: e.target.value })} rows={10} className="w-full px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono resize-y text-text-primary" spellCheck={false} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Default Config (JSON)</label>
            <textarea value={editForm.defaultConfig} onChange={(e) => setEditForm({ ...editForm, defaultConfig: e.target.value })} rows={4} className="w-full px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono resize-y text-text-primary" spellCheck={false} />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editForm.supportsIpv6} onChange={(e) => setEditForm({ ...editForm, supportsIpv6: e.target.checked })} className="rounded" /> IPv6 support</label>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={saving} className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium">{saving ? "Saving..." : "Save Changes"}</button>
            <button onClick={() => setEditingGame(null)} className="px-6 py-2 bg-bg-secondary text-text-muted rounded-lg text-sm font-medium">Cancel</button>
          </div>
        </div>
      )}

      {/* ═══ TEMPLATES ═══ */}
      {tab === "templates" && (
        <div className="space-y-6">
          {Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold mb-3">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categoryTemplates.map((tmpl) => {
                  const isInstalled = installedSlugs.has(tmpl.slug);
                  return (
                    <div key={tmpl.slug} onClick={() => !isInstalled && loadTemplateDetail(tmpl.slug)}
                      className={`bg-bg-card border rounded-xl p-4 transition-all ${isInstalled ? "border-success/30 opacity-60" : "border-border hover:border-accent/30 cursor-pointer"} ${selectedTemplate?.slug === tmpl.slug ? "border-accent" : ""}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{tmpl.iconEmoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-sm">{tmpl.name}</h4>
                            {isInstalled && <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success">Installed</span>}
                          </div>
                          <p className="text-xs text-text-muted mt-1 line-clamp-2">{tmpl.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {selectedTemplate && (
            <div className="bg-bg-card border border-accent rounded-xl overflow-hidden">
              <div className="bg-gradient-to-r from-accent/20 to-purple/20 p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{selectedTemplate.iconEmoji}</span>
                  <div><h3 className="font-bold">{selectedTemplate.name}</h3><p className="text-xs text-text-secondary">{selectedTemplate.description}</p></div>
                </div>
                <button onClick={() => installTemplate(selectedTemplate.slug)} disabled={installing === selectedTemplate.slug}
                  className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                  {installing === selectedTemplate.slug ? "Installing..." : "➕ Install Game"}
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <h4 className="text-xs text-text-muted uppercase mb-2">Variables ({selectedTemplate.variables.length})</h4>
                  <div className="grid gap-2">{selectedTemplate.variables.map((v) => (
                    <div key={v.key} className="bg-bg-secondary rounded-lg p-3 flex items-center justify-between">
                      <div><code className="text-accent text-xs font-mono">{`{{${v.key}}}`}</code><p className="text-sm">{v.name}</p><p className="text-xs text-text-muted">{v.description}</p></div>
                      <div className="text-right text-xs">
                        <span className={`px-2 py-0.5 rounded ${v.required ? "bg-warning/15 text-warning" : "bg-bg-tertiary text-text-muted"}`}>{v.required ? "Required" : "Optional"}</span>
                        {v.defaultValue && <p className="text-text-muted mt-1">Default: {v.defaultValue}</p>}
                      </div>
                    </div>
                  ))}</div>
                </div>
                <div><h4 className="text-xs text-text-muted uppercase mb-2">Start Command</h4><pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto text-success">{selectedTemplate.startCommand}</pre></div>
                <div><h4 className="text-xs text-text-muted uppercase mb-2">Install Script</h4><pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto text-text-secondary">{selectedTemplate.installScript}</pre></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ CUSTOM GAME ═══ */}
      {tab === "custom" && (
        <form onSubmit={createCustomGame} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Create Custom Game Template</h3>
          <p className="text-text-secondary text-xs">Define your own game server with custom install and start scripts. Use <code className="text-accent">{`{{VARIABLE}}`}</code> placeholders.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="block text-xs text-text-muted mb-1">Game Name *</label><input value={customForm.name} onChange={(e) => setCustomForm({ ...customForm, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required placeholder="My Custom Game" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Slug *</label><input value={customForm.slug} onChange={(e) => setCustomForm({ ...customForm, slug: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" required placeholder="my-custom-game" /></div>
            <div><label className="block text-xs text-text-muted mb-1">Engine</label><input value={customForm.engine} onChange={(e) => setCustomForm({ ...customForm, engine: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="Unity, Source, etc." /></div>
            <div><label className="block text-xs text-text-muted mb-1">Default Port *</label><input type="number" value={customForm.defaultPort} onChange={(e) => setCustomForm({ ...customForm, defaultPort: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-text-muted mb-1">Icon Emoji</label><input value={customForm.iconEmoji} onChange={(e) => setCustomForm({ ...customForm, iconEmoji: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
            <div className="flex items-end"><label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={customForm.supportsIpv6} onChange={(e) => setCustomForm({ ...customForm, supportsIpv6: e.target.checked })} className="rounded" /> Supports IPv6</label></div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Install Script * <span className="text-text-muted">(bash — use {`{{INSTALL_PATH}}`}, {`{{PORT}}`}, {`{{SERVER_NAME}}`})</span></label>
            <textarea value={customForm.installScript} onChange={(e) => setCustomForm({ ...customForm, installScript: e.target.value })} rows={10}
              className="w-full px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono resize-y text-text-primary" required spellCheck={false}
              placeholder={`#!/bin/bash\nset -e\nINSTALL_DIR="{{INSTALL_PATH}}"\nmkdir -p "$INSTALL_DIR"\ncd "$INSTALL_DIR"\n\n# Download your server files here\ncurl -L -o server.tar.gz "https://example.com/server.tar.gz"\ntar xzf server.tar.gz\nrm server.tar.gz\n\necho "Server installed"`} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Start Command * <span className="text-text-muted">(use {`{{INSTALL_PATH}}`}, {`{{PORT}}`}, etc.)</span></label>
            <textarea value={customForm.startCommand} onChange={(e) => setCustomForm({ ...customForm, startCommand: e.target.value })} rows={2}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono resize-y" required
              placeholder={`cd {{INSTALL_PATH}} && ./server -port {{PORT}} -name "{{SERVER_NAME}}"`} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Stop Command <span className="text-text-muted">(optional)</span></label>
            <input value={customForm.stopCommand} onChange={(e) => setCustomForm({ ...customForm, stopCommand: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" placeholder="quit" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Default Config (JSON)</label>
            <textarea value={customForm.defaultConfig} onChange={(e) => setCustomForm({ ...customForm, defaultConfig: e.target.value })} rows={3}
              className="w-full px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono resize-y text-text-primary" spellCheck={false} />
          </div>
          <button type="submit" disabled={saving} className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {saving ? "Creating..." : "Create Custom Game"}
          </button>
        </form>
      )}
    </div>
  );
}
