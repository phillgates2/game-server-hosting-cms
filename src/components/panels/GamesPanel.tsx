"use client";

import { useEffect, useState, useCallback } from "react";

interface InstalledGame {
  id: number; slug: string; name: string; engine: string | null; defaultPort: number;
  steamAppId: string | null; installScript: string; startCommand: string;
  stopCommand: string | null; configFiles: Record<string, string> | null;
  defaultConfig: Record<string, string> | null; supportsIpv6: boolean | null; iconEmoji: string | null;
}
interface GameTemplate {
  slug: string; name: string; engine: string | null; defaultPort: number;
  steamAppId: string | null; iconEmoji: string; supportsIpv6: boolean;
  category: string; description: string; estimatedSize: string; variableCount: number;
}
interface TemplateDetail {
  slug: string; name: string; engine: string | null; defaultPort: number;
  steamAppId: string | null; iconEmoji: string; supportsIpv6: boolean;
  category: string; description: string; estimatedSize: string;
  installScript: string; startCommand: string; stopCommand: string | null;
  configFiles: Record<string, string>; defaultConfig: Record<string, string>;
  variables: Array<{
    name: string; description: string;
    env_variable: string; default_value: string;
    user_viewable: boolean; user_editable: boolean;
    rules: string; field_type: string;
    // legacy compat
    key?: string; defaultValue?: string; required?: boolean; type?: string;
  }>;
}

type Tab = "installed" | "templates" | "create" | "import";

const EMPTY_FORM = {
  name: "", slug: "", engine: "", defaultPort: "", steamAppId: "", iconEmoji: "🎮",
  supportsIpv6: false, installScript: "#!/bin/bash\nset -e\nINSTALL_DIR=\"{{INSTALL_PATH}}\"\nmkdir -p \"$INSTALL_DIR\"\ncd \"$INSTALL_DIR\"\n\n# Download server files here\necho \"Install complete\"",
  startCommand: "cd {{INSTALL_PATH}} && ./start.sh", stopCommand: "",
  configFiles: "{}", defaultConfig: "{}",
};

export default function GamesPanel() {
  const [tab, setTab] = useState<Tab>("installed");
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
  const [templates, setTemplates] = useState<GameTemplate[]>([]);
  const [templatesByCategory, setTemplatesByCategory] = useState<Record<string, Array<{ slug: string; name: string; iconEmoji: string; description: string }>>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [editing, setEditing] = useState<InstalledGame | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [importData, setImportData] = useState("");
  const [importFormat, setImportFormat] = useState("auto");

  const loadInstalledGames = useCallback(async () => {
    const res = await fetch("/api/games"); const data = await res.json();
    setInstalledGames(data.games || []);
  }, []);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/templates"); const data = await res.json();
    setTemplates(data.templates || []); setTemplatesByCategory(data.byCategory || {});
  }, []);

  useEffect(() => { loadInstalledGames(); loadTemplates(); }, [loadInstalledGames, loadTemplates]);

  async function loadTemplateDetail(slug: string) {
    const res = await fetch(`/api/templates/${slug}`); const data = await res.json();
    setSelectedTemplate(data.template);
  }

  async function installTemplate(slug: string) {
    setInstalling(slug); setMessage(null);
    try {
      const res = await fetch(`/api/templates/${slug}/install`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: data.message }); loadInstalledGames(); setSelectedTemplate(null); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally { setInstalling(null); }
  }

  async function uninstallGame(slug: string) {
    if (!confirm("Remove this game? Existing servers using it may stop working.")) return;
    try {
      const res = await fetch(`/api/templates/${slug}/install`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); setMessage({ type: "error", text: d.error }); }
      else { setMessage({ type: "success", text: "Game uninstalled" }); loadInstalledGames(); setEditing(null); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  function startEdit(game: InstalledGame) {
    setEditing(game);
    setEditForm({
      name: game.name, slug: game.slug, engine: game.engine || "", defaultPort: String(game.defaultPort),
      steamAppId: game.steamAppId || "", iconEmoji: game.iconEmoji || "🎮",
      supportsIpv6: game.supportsIpv6 || false,
      installScript: game.installScript, startCommand: game.startCommand,
      stopCommand: game.stopCommand || "",
      configFiles: JSON.stringify(game.configFiles || {}, null, 2),
      defaultConfig: JSON.stringify(game.defaultConfig || {}, null, 2),
    });
    setTab("installed");
  }

  async function saveEdit() {
    if (!editing) return;
    setMessage(null);
    try {
      let parsedConfigFiles = {}; let parsedDefaultConfig = {};
      try { parsedConfigFiles = JSON.parse(editForm.configFiles); } catch { /* keep empty */ }
      try { parsedDefaultConfig = JSON.parse(editForm.defaultConfig); } catch { /* keep empty */ }

      const res = await fetch(`/api/games/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm, defaultPort: Number(editForm.defaultPort),
          steamAppId: editForm.steamAppId || null, stopCommand: editForm.stopCommand || null,
          configFiles: parsedConfigFiles, defaultConfig: parsedDefaultConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: `"${editForm.name}" updated` }); setEditing(null); loadInstalledGames(); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  async function createCustom(e?: React.FormEvent) {
    e?.preventDefault(); setMessage(null);
    try {
      let parsedConfigFiles = {}; let parsedDefaultConfig = {};
      try { parsedConfigFiles = JSON.parse(createForm.configFiles); } catch { /* keep empty */ }
      try { parsedDefaultConfig = JSON.parse(createForm.defaultConfig); } catch { /* keep empty */ }

      const res = await fetch("/api/games/custom", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createForm, defaultPort: Number(createForm.defaultPort),
          steamAppId: createForm.steamAppId || null, stopCommand: createForm.stopCommand || null,
          configFiles: parsedConfigFiles, defaultConfig: parsedDefaultConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: `"${createForm.name}" created` }); setCreating(false); setCreateForm(EMPTY_FORM); setTab("installed"); loadInstalledGames(); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  const installedSlugs = new Set(installedGames.map((g) => g.slug));

  function ScriptEditor({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
    return (
      <div>
        <label className="block text-xs text-text-muted mb-1">{label}</label>
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows || 8}
          className="w-full px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono text-text-primary resize-y focus:outline-none focus:ring-2 focus:ring-accent" spellCheck={false} />
      </div>
    );
  }

  function GameForm({ form, setForm, onSave, onCancel, saveLabel, title }: {
    form: typeof EMPTY_FORM; setForm: (f: typeof EMPTY_FORM) => void;
    onSave: (e?: React.FormEvent) => Promise<void> | void; onCancel: () => void; saveLabel: string; title: string;
  }) {
    return (
      <div className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button onClick={onCancel} className="text-text-muted text-xs">Cancel</button></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="block text-xs text-text-muted mb-1">Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required /></div>
          <div><label className="block text-xs text-text-muted mb-1">Slug *</label><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" required placeholder="my-game" /></div>
          <div><label className="block text-xs text-text-muted mb-1">Engine</label><input value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="Unity, UE5, Source..." /></div>
          <div><label className="block text-xs text-text-muted mb-1">Default Port *</label><input type="number" value={form.defaultPort} onChange={(e) => setForm({ ...form, defaultPort: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required /></div>
          <div><label className="block text-xs text-text-muted mb-1">Steam App ID</label><input value={form.steamAppId} onChange={(e) => setForm({ ...form, steamAppId: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="Optional" /></div>
          <div><label className="block text-xs text-text-muted mb-1">Icon Emoji</label><input value={form.iconEmoji} onChange={(e) => setForm({ ...form, iconEmoji: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.supportsIpv6} onChange={(e) => setForm({ ...form, supportsIpv6: e.target.checked })} className="rounded" /> Supports IPv6</label>
        <ScriptEditor label="Install Script *" value={form.installScript} onChange={(v) => setForm({ ...form, installScript: v })} rows={12} />
        <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-muted space-y-1">
          <p className="font-medium text-text-secondary">Available variables:</p>
          <p><code className="text-accent">{"{{INSTALL_PATH}}"}</code> — Server install directory &nbsp; <code className="text-accent">{"{{PORT}}"}</code> — Main port &nbsp; <code className="text-accent">{"{{QUERY_PORT}}"}</code> — Query port</p>
          <p><code className="text-accent">{"{{SERVER_NAME}}"}</code> — Server name &nbsp; <code className="text-accent">{"{{MAX_PLAYERS}}"}</code> — Max players &nbsp; <code className="text-accent">{"{{MAX_RAM}}"}</code> — Max RAM (GB)</p>
          <p><code className="text-accent">{"{{RCON_PASSWORD}}"}</code> — RCON password &nbsp; <code className="text-accent">{"{{RCON_PORT}}"}</code> — RCON port</p>
        </div>
        <ScriptEditor label="Start Command *" value={form.startCommand} onChange={(v) => setForm({ ...form, startCommand: v })} rows={3} />
        <ScriptEditor label="Stop Command (optional)" value={form.stopCommand} onChange={(v) => setForm({ ...form, stopCommand: v })} rows={2} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScriptEditor label="Config Files (JSON: path → name)" value={form.configFiles} onChange={(v) => setForm({ ...form, configFiles: v })} rows={4} />
          <ScriptEditor label="Default Config (JSON: key → value)" value={form.defaultConfig} onChange={(v) => setForm({ ...form, defaultConfig: v })} rows={4} />
        </div>
        <button onClick={(e) => onSave(e)} className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">{saveLabel}</button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold">🎮 Game Management</h2><p className="text-text-secondary text-sm">Install, create, and edit game templates</p></div>
        <div className="flex gap-2">
          <button onClick={() => { setTab("installed"); setSelectedTemplate(null); setEditing(null); setCreating(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "installed" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            Installed ({installedGames.length})
          </button>
          <button onClick={() => { setTab("templates"); setSelectedTemplate(null); setEditing(null); setCreating(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "templates" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            Templates ({templates.length})
          </button>
          <button onClick={() => { setTab("create"); setEditing(null); setCreating(true); setCreateForm(EMPTY_FORM); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "create" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            + Custom
          </button>
          <button onClick={() => { setTab("import"); setEditing(null); setCreating(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "import" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted"}`}>
            📥 Import
          </button>
        </div>
      </div>

      {message && <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>{message.text}</div>}

      {/* ═══ INSTALLED ═══ */}
      {tab === "installed" && !editing && (
        <div className="space-y-4">
          {installedGames.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
              <span className="text-4xl block mb-3">📦</span><h3 className="font-semibold mb-1">No games installed</h3>
              <p className="text-text-secondary text-sm mb-4">Go to Templates or create a custom game</p>
              <button onClick={() => setTab("templates")} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium">Browse Templates →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {installedGames.map((game) => (
                <div key={game.id} className="bg-bg-card border border-border rounded-xl p-5 hover:border-accent/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{game.iconEmoji || "🎮"}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm">{game.name}</h3>
                      <div className="mt-1 text-xs text-text-muted space-y-0.5">
                        {game.engine && <p>Engine: {game.engine}</p>}
                        <p>Port: {game.defaultPort}</p>
                        <p className="font-mono text-[10px]">{game.slug}</p>
                      </div>
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

      {/* ═══ EDIT INSTALLED ═══ */}
      {tab === "installed" && editing && (
        <GameForm form={editForm} setForm={setEditForm} onSave={saveEdit}
          onCancel={() => setEditing(null)} saveLabel="Save Changes" title={`Editing: ${editing.name}`} />
      )}

      {/* ═══ CREATE CUSTOM ═══ */}
      {tab === "create" && creating && (
        <GameForm form={createForm} setForm={setCreateForm} onSave={createCustom}
          onCancel={() => { setCreating(false); setTab("installed"); }} saveLabel="Create Game" title="Create Custom Game Template" />
      )}

      {/* ═══ TEMPLATES ═══ */}
      {tab === "templates" && (
        <div className="space-y-6">
          {Object.entries(templatesByCategory).map(([category, catTemplates]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold mb-3">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {catTemplates.map((tmpl) => {
                  const full = templates.find((t) => t.slug === tmpl.slug);
                  const isInstalled = installedSlugs.has(tmpl.slug);
                  return (
                    <div key={tmpl.slug} onClick={() => !isInstalled && loadTemplateDetail(tmpl.slug)}
                      className={`bg-bg-card border rounded-xl p-4 transition-all ${isInstalled ? "border-success/30 opacity-60 cursor-default" : "border-border hover:border-accent/30 cursor-pointer hover:shadow-lg"} ${selectedTemplate?.slug === tmpl.slug ? "border-accent" : ""}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{tmpl.iconEmoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-sm">{tmpl.name}</h4>
                            {isInstalled && <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success">Installed</span>}
                          </div>
                          <p className="text-xs text-text-muted mt-1 line-clamp-2">{tmpl.description}</p>
                          {full && <div className="flex gap-2 mt-2"><span className="text-[10px] text-text-muted">{full.estimatedSize}</span></div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Selected template detail */}
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
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-bg-secondary rounded-lg p-3"><p className="text-[10px] text-text-muted uppercase">Engine</p><p className="text-sm font-medium">{selectedTemplate.engine || "Custom"}</p></div>
                  <div className="bg-bg-secondary rounded-lg p-3"><p className="text-[10px] text-text-muted uppercase">Port</p><p className="text-sm font-medium">{selectedTemplate.defaultPort}</p></div>
                  <div className="bg-bg-secondary rounded-lg p-3"><p className="text-[10px] text-text-muted uppercase">Size</p><p className="text-sm font-medium">{selectedTemplate.estimatedSize}</p></div>
                  <div className="bg-bg-secondary rounded-lg p-3"><p className="text-[10px] text-text-muted uppercase">IPv6</p><p className="text-sm font-medium">{selectedTemplate.supportsIpv6 ? "Yes" : "No"}</p></div>
                </div>
                <div><h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Variables ({selectedTemplate.variables.length})</h4>
                  <div className="grid gap-2">{selectedTemplate.variables.map((v) => {
                    const envVar = v.env_variable || (v as Record<string, unknown>).key as string || "";
                    const defVal = v.default_value || (v as Record<string, unknown>).defaultValue as string || "";
                    const isRequired = v.rules?.includes("required") ?? (v as Record<string, unknown>).required as boolean ?? false;
                    return (
                    <div key={envVar} className="bg-bg-secondary rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <code className="text-accent text-xs font-mono">{`{{${envVar}}}`}</code>
                        <p className="text-sm">{v.name}</p>
                        <p className="text-xs text-text-muted">{v.description}</p>
                      </div>
                      <div className="text-right text-xs space-y-1">
                        <span className={`px-2 py-0.5 rounded ${isRequired ? "bg-warning/15 text-warning" : "bg-bg-tertiary text-text-muted"}`}>{isRequired ? "Required" : "Optional"}</span>
                        {defVal && <p className="text-text-muted">Default: {defVal}</p>}
                        {v.rules && <p className="text-text-muted font-mono text-[10px]">{v.rules}</p>}
                        {v.field_type && <p className="text-text-muted text-[10px]">Type: {v.field_type}</p>}
                        <div className="flex gap-1 justify-end">
                          {v.user_viewable && <span className="text-[10px] bg-accent/10 text-accent px-1 rounded">viewable</span>}
                          {v.user_editable && <span className="text-[10px] bg-success/10 text-success px-1 rounded">editable</span>}
                        </div>
                      </div>
                    </div>
                    );
                  })}</div>
                </div>
                <div><h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Start Command</h4><pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto text-success">{selectedTemplate.startCommand}</pre></div>
                <div><h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Install Script</h4><pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto text-text-secondary">{selectedTemplate.installScript}</pre></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ IMPORT ═══ */}
      {tab === "import" && (
        <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">📥 Import Game Template</h3>
          <p className="text-text-secondary text-sm">
            Paste a <strong>Pterodactyl egg JSON</strong> or an <strong>AMP template JSON</strong> to import it as a game definition.
          </p>
          <div>
            <label className="block text-xs text-text-muted mb-1">Format</label>
            <select value={importFormat} onChange={(e) => setImportFormat(e.target.value)} className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm">
              <option value="auto">Auto-detect</option>
              <option value="pterodactyl">Pterodactyl Egg (JSON)</option>
              <option value="amp">AMP Template (JSON)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Paste JSON</label>
            <textarea value={importData} onChange={(e) => setImportData(e.target.value)} rows={14}
              className="w-full px-3 py-2 bg-[#0d1117] border border-border rounded-lg text-xs font-mono text-text-primary resize-y" placeholder="Paste full egg or template JSON..." spellCheck={false} />
          </div>
          <button onClick={async () => {
            setMessage(null);
            try {
              let parsed; try { parsed = JSON.parse(importData); } catch { setMessage({ type: "error", text: "Invalid JSON" }); return; }
              const res = await fetch("/api/games/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: importFormat === "auto" ? undefined : importFormat, data: parsed }) });
              const data = await res.json();
              if (!res.ok) setMessage({ type: "error", text: data.error });
              else { setMessage({ type: "success", text: data.message }); setImportData(""); loadInstalledGames(); setTab("installed"); }
            } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
          }} disabled={!importData.trim()} className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            Import Template
          </button>
          <div className="bg-bg-secondary rounded-lg p-4 text-xs text-text-muted space-y-1">
            <p className="font-medium text-text-secondary">Sources:</p>
            <p>🥚 Pterodactyl eggs: <a href="https://github.com/pelican-eggs/eggs" target="_blank" className="text-accent hover:underline">github.com/pelican-eggs/eggs</a></p>
            <p>⚡ AMP templates: <a href="https://github.com/CubeCoders/AMPTemplates" target="_blank" className="text-accent hover:underline">github.com/CubeCoders/AMPTemplates</a></p>
          </div>
        </div>
      )}
    </div>
  );
}
