"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface AuthUser { id: number; username: string; role: string }
interface GameDef { id: number; name: string; slug: string; defaultPort: number; iconEmoji: string | null }
interface NodeInfo { id: number; name: string; hostname: string; status: string; isDefault: boolean | null; gameServerPath: string | null }
interface TemplateVar {
  name: string; description: string; env_variable: string; default_value: string;
  user_viewable: boolean; user_editable: boolean; rules: string; field_type: string;
  enum_values?: Record<string, string>;
}
interface Server {
  id: number; name: string; ipv4: string | null; ipv6: string | null; port: number;
  status: string; gameName: string | null; gameSlug: string | null; gameIcon: string | null;
  nodeName: string | null; nodeId: number | null; autoRestart: boolean | null;
  discordWebhook: string | null; createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  running:        { label: "Running",    color: "text-success",  dot: "bg-success",  bg: "bg-success/10 border-success/30" },
  stopped:        { label: "Stopped",    color: "text-text-muted", dot: "bg-text-muted", bg: "bg-bg-secondary border-border" },
  installing:     { label: "Installing", color: "text-accent",   dot: "bg-accent",   bg: "bg-accent/10 border-accent/30" },
  install_failed: { label: "Install Failed", color: "text-danger", dot: "bg-danger", bg: "bg-danger/10 border-danger/30" },
};

export default function ServersPanel({ user }: { user: AuthUser }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [games, setGames] = useState<GameDef[]>([]);
  const [nodeList, setNodeList] = useState<NodeInfo[]>([]);
  const [wizard, setWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [form, setForm] = useState({ name: "", gameId: "", nodeId: "", port: "", ipv4: "0.0.0.0", ipv6: "", installPath: "", discordWebhook: "" });
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [installLog, setInstallLog] = useState<{ output: string; error: string; success: boolean } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gameVars, setGameVars] = useState<TemplateVar[]>([]);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [consoleId, setConsoleId] = useState<number | null>(null);
  const [consoleLog, setConsoleLog] = useState("");
  const [consoleInfo, setConsoleInfo] = useState<{ status: string; pid: number | null; lines: number; fileSizeKb: number } | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [srvR, gameR, nodeR] = await Promise.allSettled([fetch("/api/servers"), fetch("/api/games"), fetch("/api/nodes")]);
      if (srvR.status === "fulfilled" && srvR.value.ok) setServers((await srvR.value.json()).servers || []);
      if (gameR.status === "fulfilled" && gameR.value.ok) setGames((await gameR.value.json()).games || []);
      if (nodeR.status === "fulfilled" && nodeR.value.ok) {
        const online = ((await nodeR.value.json()).nodes || []).filter((n: NodeInfo) => n.status === "online");
        setNodeList(online);
        const def = online.find((n: NodeInfo) => n.isDefault);
        if (def) setForm((f) => ({ ...f, nodeId: String(def.id), installPath: def.gameServerPath || "" }));
      }
    } catch { /**/ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function onGameChange(gameId: string) {
    const game = games.find((g) => g.id === Number(gameId));
    const node = nodeList.find((n) => n.id === Number(form.nodeId));
    const base = node?.gameServerPath || "/home/gameservers";
    if (game) {
      setForm((f) => ({ ...f, gameId, port: String(game.defaultPort), installPath: `${base}/${game.slug}` }));
      try {
        const res = await fetch(`/api/games/${game.id}/variables`);
        if (res.ok) {
          const data = await res.json();
          const vars: TemplateVar[] = data.variables || [];
          setGameVars(vars.filter((v) => v.user_viewable));
          const skip = new Set(["SERVER_NAME", "PORT", "INSTALL_PATH", "QUERY_PORT"]);
          const defs: Record<string, string> = {};
          for (const v of vars) { if (!skip.has(v.env_variable) && v.default_value) defs[v.env_variable] = v.default_value; }
          setVarValues(defs);
        }
      } catch { setGameVars([]); }
    } else { setForm((f) => ({ ...f, gameId })); setGameVars([]); setVarValues({}); }
  }

  async function createServer(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/servers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, variables: varValues }) });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed");
      else { setWizard(false); setWizardStep(0); setMessage({ type: "success", text: `Server "${form.name}" created! Click Install Files to download game files.` }); loadData(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setLoading(false); }
  }

  async function controlProcess(id: number, action: "start" | "stop" | "restart") {
    setMessage(null);
    const res = await fetch(`/api/servers/${id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    if (!res) { setMessage({ type: "error", text: "Network error" }); return; }
    const data = await res.json();
    if (!res.ok) { setMessage({ type: "error", text: data.error }); }
    else if (action === "start" && !data.alive) { setMessage({ type: "error", text: "Server crashed immediately. Open Console to see why." }); }
    else { setMessage({ type: "success", text: `${action === "start" ? "▶ Started" : action === "stop" ? "⏹ Stopped" : "🔄 Restarted"} (PID ${data.pid || "—"})` }); }
    loadData();
  }

  async function deleteServer(id: number) { if (!confirm("Delete this server?")) return; await fetch(`/api/servers/${id}`, { method: "DELETE" }); loadData(); }

  async function installServerFiles(id: number) {
    if (!confirm("Install / update game files? This may take several minutes.")) return;
    setInstallingId(id); setMessage(null); setInstallLog(null);
    try {
      const res = await fetch(`/api/servers/${id}/install`, { method: "POST" }); const data = await res.json();
      if (!res.ok) { setInstallLog({ output: data.output || "", error: data.error || data.errorOutput || "Install failed", success: false }); setMessage({ type: "error", text: data.error || "Install failed" }); }
      else { setInstallLog({ output: data.output || "", error: data.errorOutput || "", success: true }); setMessage({ type: "success", text: "✅ Game files installed! You can now Start the server." }); }
      loadData();
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); } finally { setInstallingId(null); }
  }

  async function openConsole(id: number) { setConsoleId(id); fetchLog(id); }
  async function fetchLog(id: number) {
    try { const d = await (await fetch(`/api/servers/${id}/log?tail=300`)).json(); setConsoleLog(d.log || d.message || ""); setConsoleInfo({ status: d.status, pid: d.pid, lines: d.lines || 0, fileSizeKb: d.fileSizeKb || 0 }); setTimeout(() => { consoleRef.current && (consoleRef.current.scrollTop = consoleRef.current.scrollHeight); }, 50); } catch { /**/ }
  }
  useEffect(() => { if (consoleId === null) return; const i = setInterval(() => fetchLog(consoleId), 3000); return () => clearInterval(i); }, [consoleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedGame = games.find((g) => g.id === Number(form.gameId));
  const onlineNodes = nodeList;
  const canCreate = form.name && form.gameId && form.nodeId && form.port;
  const visibleVars = gameVars.filter((v) => !["SERVER_NAME","PORT","INSTALL_PATH","QUERY_PORT"].includes(v.env_variable));
  const inputCls = "w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-colors";

  function VarField({ v }: { v: TemplateVar }) {
    const val = varValues[v.env_variable] ?? v.default_value ?? "";
    const set = (nv: string) => setVarValues((p) => ({ ...p, [v.env_variable]: nv }));
    const req = v.rules?.includes("required");

    if (v.field_type === "select" || (v.enum_values && Object.keys(v.enum_values).length > 0)) {
      return (
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">{v.name}</label>
          <select value={val} onChange={(e) => set(e.target.value)} className={inputCls} required={req}>
            {Object.entries(v.enum_values || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {v.description && <p className="text-[10px] text-text-muted mt-1">{v.description}</p>}
        </div>
      );
    }
    if (v.field_type === "checkbox") {
      return (
        <div className="flex items-start gap-3 py-1">
          <input type="checkbox" checked={["true","1","True"].includes(val)} onChange={(e) => set(e.target.checked ? "true" : "false")} className="rounded mt-0.5 w-4 h-4 accent-accent" />
          <div><p className="text-sm font-medium">{v.name}</p>{v.description && <p className="text-[10px] text-text-muted">{v.description}</p>}</div>
        </div>
      );
    }
    return (
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5">{v.name} {req && <span className="text-warning">*</span>}</label>
        <input type={v.field_type === "password" ? "password" : v.field_type === "number" ? "number" : "text"} value={val} onChange={(e) => set(e.target.value)} className={inputCls} placeholder={v.default_value || v.description || v.name} required={req} />
        {v.description && <p className="text-[10px] text-text-muted mt-1">{v.description}</p>}
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🎮 Game Servers</h2>
          <p className="text-text-secondary text-sm">{servers.length} server{servers.length !== 1 ? "s" : ""}{servers.filter((s) => s.status === "running").length > 0 ? ` · ${servers.filter((s) => s.status === "running").length} running` : ""}</p>
        </div>
        <button onClick={() => { setWizard(!wizard); setWizardStep(0); setError(""); }} className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
          {wizard ? "✕ Cancel" : "+ Create Server"}
        </button>
      </div>

      {/* Notices */}
      {message && (
        <div className={`flex items-start gap-3 border rounded-xl p-4 text-sm ${message.type === "success" ? "bg-success/10 border-success/30 text-success" : "bg-danger/10 border-danger/30 text-danger"}`}>
          <span className="text-lg flex-shrink-0">{message.type === "success" ? "✅" : "❌"}</span>
          <p className="whitespace-pre-wrap">{message.text}</p>
          <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100 flex-shrink-0">✕</button>
        </div>
      )}
      {onlineNodes.length === 0 && loaded && <Notice icon="🖥️" text="No online nodes. Go to Nodes and add a Local Node first." />}
      {games.length === 0 && loaded && <Notice icon="📦" text="No games installed. Go to Games → Templates to install one." />}

      {/* ═══ CREATE WIZARD ═══ */}
      {wizard && onlineNodes.length > 0 && games.length > 0 && (
        <div className="bg-bg-card border border-accent/30 rounded-xl overflow-hidden shadow-lg">
          {/* Wizard steps */}
          <div className="flex border-b border-border">
            {["① Basics", "② Game Settings", "③ Confirm"].map((label, i) => (
              <button key={i} onClick={() => i <= wizardStep && setWizardStep(i)}
                className={`flex-1 py-3 text-xs font-medium transition-colors ${i === wizardStep ? "bg-accent/10 text-accent border-b-2 border-accent" : i < wizardStep ? "text-success bg-success/5" : "text-text-muted"}`}>
                {i < wizardStep ? `✓ ${label.slice(2)}` : label}
              </button>
            ))}
          </div>

          <form onSubmit={createServer} className="p-6">
            {/* Step 1: Basics */}
            {wizardStep === 0 && (
              <div className="space-y-5">
                <p className="text-text-secondary text-sm">Choose a game, name your server, and pick a node to host it on.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Game *</label>
                    <select value={form.gameId} onChange={(e) => onGameChange(e.target.value)} className={inputCls} required>
                      <option value="">Choose a game...</option>
                      {games.map((g) => <option key={g.id} value={g.id}>{g.iconEmoji} {g.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Server Name *</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder="My Awesome Server" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Node *</label>
                    <select value={form.nodeId} onChange={(e) => { setForm({ ...form, nodeId: e.target.value }); }} className={inputCls} required>
                      <option value="">Choose a node...</option>
                      {onlineNodes.map((n) => <option key={n.id} value={n.id}>{n.name} {n.isDefault ? "★ Default" : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Port *</label>
                    <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className={inputCls} required placeholder={selectedGame ? String(selectedGame.defaultPort) : "27015"} />
                    <p className="text-[10px] text-text-muted mt-1">Default: {selectedGame?.defaultPort || "varies by game"}</p>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button type="button" disabled={!form.gameId || !form.name || !form.nodeId || !form.port} onClick={() => setWizardStep(1)}
                    className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors">
                    Next: Game Settings →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Game settings */}
            {wizardStep === 1 && (
              <div className="space-y-5">
                <p className="text-text-secondary text-sm">Configure {selectedGame?.name || "the game"} settings. All fields have sensible defaults — change only what you need.</p>
                {visibleVars.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {visibleVars.map((v) => <VarField key={v.env_variable} v={v} />)}
                  </div>
                ) : (
                  <div className="bg-bg-secondary rounded-lg p-6 text-center text-text-muted text-sm">
                    <p>This game has no additional settings to configure.</p>
                  </div>
                )}
                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setWizardStep(0)} className="px-5 py-2.5 bg-bg-secondary border border-border text-text-primary rounded-lg text-sm font-medium">← Back</button>
                  <button type="button" onClick={() => setWizardStep(2)} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
                    Next: Review →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Confirm */}
            {wizardStep === 2 && (
              <div className="space-y-5">
                <p className="text-text-secondary text-sm">Review your server configuration before creating it.</p>
                <div className="bg-bg-secondary rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-3 pb-3 border-b border-border">
                    <span className="text-3xl">{selectedGame?.iconEmoji || "🎮"}</span>
                    <div>
                      <p className="font-bold text-lg">{form.name || "Unnamed Server"}</p>
                      <p className="text-text-secondary text-sm">{selectedGame?.name}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-text-muted text-xs">Node</p><p>{onlineNodes.find((n) => n.id === Number(form.nodeId))?.name || "—"}</p></div>
                    <div><p className="text-text-muted text-xs">Port</p><p>{form.port}</p></div>
                    <div><p className="text-text-muted text-xs">IPv4</p><p>{form.ipv4 || "0.0.0.0"}</p></div>
                    <div><p className="text-text-muted text-xs">Install Path</p><p className="font-mono text-xs truncate">{form.installPath}</p></div>
                  </div>
                  {Object.keys(varValues).length > 0 && (
                    <div className="pt-3 border-t border-border">
                      <p className="text-text-muted text-xs mb-2">Game Settings</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {Object.entries(varValues).filter(([, v]) => v).map(([k, v]) => {
                          const def = gameVars.find((gv) => gv.env_variable === k);
                          const label = def?.name || k;
                          let display = v;
                          if (def?.enum_values && def.enum_values[v]) display = def.enum_values[v];
                          if (def?.field_type === "password" && v) display = "••••••";
                          return <div key={k} className="text-xs"><span className="text-text-muted">{label}:</span> <span className="font-medium">{display}</span></div>;
                        })}
                      </div>
                    </div>
                  )}
                </div>
                {error && <p className="text-danger text-sm flex items-center gap-2">❌ {error}</p>}
                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setWizardStep(1)} className="px-5 py-2.5 bg-bg-secondary border border-border text-text-primary rounded-lg text-sm font-medium">← Back</button>
                  <button type="submit" disabled={loading || !canCreate} className="px-8 py-2.5 bg-success hover:opacity-90 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                    {loading ? "Creating..." : "🚀 Create Server"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}

      {/* ═══ CONSOLE ═══ */}
      {consoleId && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-sm">📋 Console</h3>
              <span className="text-xs text-text-muted">{servers.find((s) => s.id === consoleId)?.name}</span>
              {consoleInfo && <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${consoleInfo.status === "running" ? "bg-success/15 text-success" : "bg-bg-tertiary text-text-muted"}`}>{consoleInfo.status}{consoleInfo.pid ? ` · PID ${consoleInfo.pid}` : ""}</span>}
            </div>
            <div className="flex gap-2"><button onClick={() => fetchLog(consoleId)} className="text-accent text-xs">↻ Refresh</button><button onClick={() => setConsoleId(null)} className="text-text-muted text-xs">✕ Close</button></div>
          </div>
          <div ref={consoleRef} className="h-80 overflow-y-auto p-4 bg-[#0d1117] font-mono text-xs leading-relaxed whitespace-pre-wrap text-text-secondary">
            {consoleLog || <span className="text-text-muted italic">No output yet. Start the server to see logs here.</span>}
          </div>
          <div className="px-5 py-2 border-t border-border text-[10px] text-text-muted flex justify-between"><span>↻ Auto-refresh 3s</span><span>gsm-server.log</span></div>
        </div>
      )}

      {/* ═══ INSTALL LOG ═══ */}
      {installLog && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm">{installLog.success ? "✅" : "⚠️"} Install Log</h3>
            <button onClick={() => setInstallLog(null)} className="text-text-muted text-xs">✕ Close</button>
          </div>
          <div className="p-4 max-h-72 overflow-y-auto bg-[#0d1117] font-mono text-xs whitespace-pre-wrap leading-relaxed">
            {installLog.output && <div className="text-text-secondary">{installLog.output}</div>}
            {installLog.error && <div className="text-danger mt-2">{installLog.error}</div>}
          </div>
        </div>
      )}

      {/* ═══ LOADING ═══ */}
      {!loaded && <div className="text-center py-12"><div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {/* ═══ EMPTY STATE ═══ */}
      {loaded && servers.length === 0 && !wizard && (
        <div className="bg-bg-card border border-border rounded-xl p-16 text-center">
          <span className="text-5xl block mb-4">🎮</span>
          <h3 className="text-xl font-bold mb-2">No servers yet</h3>
          <p className="text-text-secondary mb-6 max-w-md mx-auto">Create your first game server to get started. The wizard will guide you through choosing a game, configuring settings, and installing files.</p>
          <button onClick={() => { setWizard(true); setWizardStep(0); }} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors shadow-sm">
            + Create Your First Server
          </button>
        </div>
      )}

      {/* ═══ SERVER LIST ═══ */}
      {servers.length > 0 && (
        <div className="space-y-4">
          {servers.map((server) => {
            const st = STATUS_MAP[server.status] || STATUS_MAP.stopped;
            const isInstalling = installingId === server.id || server.status === "installing";
            return (
              <div key={server.id} className={`bg-bg-card border rounded-xl overflow-hidden transition-colors hover:shadow-md ${server.status === "running" ? "border-success/20" : "border-border"}`}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Server info */}
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="relative flex-shrink-0">
                        <span className="text-4xl block">{server.gameIcon || "🎮"}</span>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-bg-card ${st.dot}`} title={st.label} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-lg leading-tight truncate">{server.name}</h3>
                        <p className="text-text-secondary text-sm">{server.gameName}</p>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${st.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                          {server.nodeName && <span className="text-xs text-text-muted">🖥️ {server.nodeName}</span>}
                          {server.ipv4 && server.ipv4 !== "0.0.0.0" && <span className="text-xs text-text-muted font-mono">{server.ipv4}:{server.port}</span>}
                          {server.ipv4 === "0.0.0.0" && <span className="text-xs text-text-muted font-mono">Port {server.port}</span>}
                          {server.discordWebhook && <span className="text-xs text-[#5865F2]">🔔</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action bar */}
                <div className="px-5 py-3 bg-bg-secondary/50 border-t border-border flex items-center gap-2 flex-wrap">
                  {/* Primary actions */}
                  {server.status === "running" ? (
                    <>
                      <Btn onClick={() => controlProcess(server.id, "stop")} color="danger" icon="⏹" label="Stop" />
                      <Btn onClick={() => controlProcess(server.id, "restart")} color="warning" icon="🔄" label="Restart" />
                    </>
                  ) : (
                    <Btn onClick={() => controlProcess(server.id, "start")} color="success" icon="▶" label="Start" />
                  )}
                  <div className="w-px h-5 bg-border mx-1" />
                  {/* Secondary actions */}
                  <Btn onClick={() => installServerFiles(server.id)} color="accent" icon="📥" label={isInstalling ? "Installing..." : "Install"} disabled={isInstalling} />
                  <Btn onClick={() => openConsole(server.id)} color="muted" icon="📋" label="Console" />
                  <div className="ml-auto" />
                  {user.role === "admin" && <Btn onClick={() => deleteServer(server.id)} color="danger" icon="🗑️" label="" small />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Btn({ onClick, color, icon, label, disabled, small }: { onClick: () => void; color: string; icon: string; label: string; disabled?: boolean; small?: boolean }) {
  const colors: Record<string, string> = {
    success: "bg-success/15 text-success hover:bg-success/25",
    danger: "bg-danger/15 text-danger hover:bg-danger/25",
    warning: "bg-warning/15 text-warning hover:bg-warning/25",
    accent: "bg-accent/15 text-accent hover:bg-accent/25",
    muted: "bg-bg-tertiary text-text-secondary hover:bg-bg-hover",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${small ? "px-2 py-1.5" : "px-3 py-1.5"} ${colors[color] || colors.muted} rounded-lg text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5`}>
      <span>{icon}</span>{label && <span>{label}</span>}
    </button>
  );
}

function Notice({ icon, text }: { icon: string; text: string }) {
  return <div className="flex items-center gap-3 bg-warning/10 border border-warning/20 rounded-xl p-4 text-warning text-sm"><span className="text-xl">{icon}</span><p>{text}</p></div>;
}
