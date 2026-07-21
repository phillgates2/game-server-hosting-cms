"use client";

import { useEffect, useState, useCallback } from "react";

interface InstalledGame {
  id: number;
  slug: string;
  name: string;
  engine: string | null;
  defaultPort: number;
  steamAppId: string | null;
  installScript: string;
  startCommand: string;
  stopCommand: string | null;
  configFiles: Record<string, string> | null;
  defaultConfig: Record<string, string> | null;
  supportsIpv6: boolean | null;
  iconEmoji: string | null;
}

interface GameTemplate {
  slug: string;
  name: string;
  engine: string | null;
  defaultPort: number;
  steamAppId: string | null;
  iconEmoji: string;
  supportsIpv6: boolean;
  category: string;
  description: string;
  estimatedSize: string;
  variableCount: number;
}

interface TemplateDetail {
  slug: string;
  name: string;
  engine: string | null;
  defaultPort: number;
  steamAppId: string | null;
  iconEmoji: string;
  supportsIpv6: boolean;
  category: string;
  description: string;
  estimatedSize: string;
  installScript: string;
  startCommand: string;
  variables: Array<{
    name: string;
    key: string;
    description: string;
    defaultValue: string;
    required: boolean;
    type: string;
  }>;
  defaultConfig: Record<string, string>;
}

type Tab = "installed" | "templates";

export default function GamesPanel() {
  const [tab, setTab] = useState<Tab>("installed");
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
  const [templates, setTemplates] = useState<GameTemplate[]>([]);
  const [templatesByCategory, setTemplatesByCategory] = useState<Record<string, Array<{ slug: string; name: string; iconEmoji: string; description: string }>>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [selectedInstalled, setSelectedInstalled] = useState<InstalledGame | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadInstalledGames = useCallback(async () => {
    const res = await fetch("/api/games");
    const data = await res.json();
    setInstalledGames(data.games || []);
  }, []);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/templates");
    const data = await res.json();
    setTemplates(data.templates || []);
    setTemplatesByCategory(data.byCategory || {});
  }, []);

  useEffect(() => {
    loadInstalledGames();
    loadTemplates();
  }, [loadInstalledGames, loadTemplates]);

  async function loadTemplateDetail(slug: string) {
    const res = await fetch(`/api/templates/${slug}`);
    const data = await res.json();
    setSelectedTemplate(data.template);
  }

  async function installTemplate(slug: string) {
    setInstalling(slug);
    setMessage(null);

    try {
      const res = await fetch(`/api/templates/${slug}/install`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: data.message });
        loadInstalledGames();
        setSelectedTemplate(null);
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to install" });
    } finally {
      setInstalling(null);
    }
  }

  async function uninstallGame(slug: string) {
    if (!confirm("Remove this game? Existing servers using it will no longer work.")) return;

    try {
      const res = await fetch(`/api/templates/${slug}/install`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: "Game uninstalled" });
        loadInstalledGames();
        setSelectedInstalled(null);
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to uninstall" });
    }
  }

  const installedSlugs = new Set(installedGames.map((g) => g.slug));

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🎮 Game Management</h2>
          <p className="text-text-secondary text-sm">Install game templates to make them available for server creation</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setTab("installed"); setSelectedTemplate(null); setSelectedInstalled(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "installed" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"
            }`}
          >
            Installed ({installedGames.length})
          </button>
          <button
            onClick={() => { setTab("templates"); setSelectedTemplate(null); setSelectedInstalled(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "templates" ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"
            }`}
          >
            Templates ({templates.length})
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg text-sm ${
          message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
        }`}>
          {message.text}
        </div>
      )}

      {/* Installed Games Tab */}
      {tab === "installed" && (
        <div className="space-y-4">
          {installedGames.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
              <span className="text-4xl block mb-3">📦</span>
              <h3 className="text-lg font-semibold mb-1">No games installed</h3>
              <p className="text-text-secondary text-sm mb-4">
                Go to the Templates tab to install games for your panel
              </p>
              <button
                onClick={() => setTab("templates")}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium"
              >
                Browse Templates →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {installedGames.map((game) => (
                <div
                  key={game.id}
                  onClick={() => setSelectedInstalled(selectedInstalled?.id === game.id ? null : game)}
                  className={`bg-bg-card border rounded-xl p-5 cursor-pointer transition-all hover:shadow-lg ${
                    selectedInstalled?.id === game.id ? "border-accent" : "border-border hover:border-accent/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{game.iconEmoji || "🎮"}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm">{game.name}</h3>
                      <div className="mt-2 space-y-1 text-xs text-text-muted">
                        {game.engine && <p>Engine: {game.engine}</p>}
                        <p>Default Port: {game.defaultPort}</p>
                        <div className="flex gap-2 mt-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                            game.supportsIpv6 ? "bg-success/15 text-success" : "bg-bg-secondary text-text-muted"
                          }`}>
                            {game.supportsIpv6 ? "IPv6 ✓" : "IPv4"}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-success/15 text-success">
                            Installed ✓
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected installed game details */}
          {selectedInstalled && (
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              <div className="bg-bg-secondary p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selectedInstalled.iconEmoji}</span>
                  <div>
                    <h3 className="font-semibold">{selectedInstalled.name}</h3>
                    <p className="text-xs text-text-muted">{selectedInstalled.slug}</p>
                  </div>
                </div>
                <button
                  onClick={() => uninstallGame(selectedInstalled.slug)}
                  className="px-4 py-2 bg-danger/15 hover:bg-danger/25 text-danger rounded-lg text-sm font-medium"
                >
                  Uninstall
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Start Command</h4>
                  <pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto text-success">
                    {selectedInstalled.startCommand}
                  </pre>
                </div>

                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Install Script</h4>
                  <pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto text-text-secondary">
                    {selectedInstalled.installScript}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Templates Tab */}
      {tab === "templates" && (
        <div className="space-y-6">
          {Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold mb-3">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categoryTemplates.map((tmpl) => {
                  const fullTemplate = templates.find((t) => t.slug === tmpl.slug);
                  const isInstalled = installedSlugs.has(tmpl.slug);

                  return (
                    <div
                      key={tmpl.slug}
                      onClick={() => !isInstalled && loadTemplateDetail(tmpl.slug)}
                      className={`bg-bg-card border rounded-xl p-4 transition-all ${
                        isInstalled
                          ? "border-success/30 opacity-60 cursor-default"
                          : "border-border hover:border-accent/30 cursor-pointer hover:shadow-lg"
                      } ${selectedTemplate?.slug === tmpl.slug ? "border-accent" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{tmpl.iconEmoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-sm">{tmpl.name}</h4>
                            {isInstalled && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success">
                                Installed
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-1 line-clamp-2">{tmpl.description}</p>
                          {fullTemplate && (
                            <div className="flex gap-2 mt-2">
                              <span className="text-[10px] text-text-muted">
                                {fullTemplate.estimatedSize}
                              </span>
                              {fullTemplate.steamAppId && (
                                <span className="text-[10px] text-accent">SteamCMD</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Selected template details */}
          {selectedTemplate && (
            <div className="bg-bg-card border border-accent rounded-xl overflow-hidden">
              <div className="bg-gradient-to-r from-accent/20 to-purple/20 p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{selectedTemplate.iconEmoji}</span>
                  <div>
                    <h3 className="font-bold">{selectedTemplate.name}</h3>
                    <p className="text-xs text-text-secondary">{selectedTemplate.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => installTemplate(selectedTemplate.slug)}
                  disabled={installing === selectedTemplate.slug}
                  className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {installing === selectedTemplate.slug ? "Installing..." : "➕ Install Game"}
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Quick info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <InfoBox label="Engine" value={selectedTemplate.engine || "Custom"} />
                  <InfoBox label="Default Port" value={selectedTemplate.defaultPort.toString()} />
                  <InfoBox label="Est. Size" value={selectedTemplate.estimatedSize} />
                  <InfoBox label="IPv6" value={selectedTemplate.supportsIpv6 ? "Supported" : "IPv4 only"} />
                </div>

                {/* Variables */}
                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-3">
                    Configuration Variables ({selectedTemplate.variables.length})
                  </h4>
                  <div className="grid gap-2">
                    {selectedTemplate.variables.map((v) => (
                      <div key={v.key} className="bg-bg-secondary rounded-lg p-3 flex items-center justify-between">
                        <div>
                          <code className="text-accent text-xs font-mono">{`{{${v.key}}}`}</code>
                          <p className="text-sm">{v.name}</p>
                          <p className="text-xs text-text-muted">{v.description}</p>
                        </div>
                        <div className="text-right text-xs">
                          <span className={`px-2 py-0.5 rounded ${v.required ? "bg-warning/15 text-warning" : "bg-bg-tertiary text-text-muted"}`}>
                            {v.required ? "Required" : "Optional"}
                          </span>
                          {v.defaultValue && (
                            <p className="text-text-muted mt-1">Default: {v.defaultValue}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Start Command */}
                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Start Command Template</h4>
                  <pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto text-success">
                    {selectedTemplate.startCommand}
                  </pre>
                </div>

                {/* Install Script Preview */}
                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">Install Script</h4>
                  <pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto text-text-secondary">
                    {selectedTemplate.installScript}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-3">
      <p className="text-[10px] text-text-muted uppercase">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
