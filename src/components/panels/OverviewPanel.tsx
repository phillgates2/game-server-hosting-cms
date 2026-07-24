"use client";

import { useEffect, useState, useCallback } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

type OverviewTab = "servers" | "nodes" | "games" | "monitor" | "files" | "rcon" | "forum" | "cms" | "users" | "roles" | "profile" | "database" | "audit" | "overview";

interface MonitorData {
  memory: { totalMb: number; usedMb: number; freeMb: number; buffersMb: number; cachedMb: number; usedPercent: number; bufferPercent: number };
  cpu: { load1: number; load5: number; load15: number };
  disk: { totalMb: number; usedMb: number; usedPercent: number };
  ipv6: { enabled: boolean };
}

interface ServerRow {
  id: number;
  name: string;
  status: string;
  gameName: string | null;
  gameIcon: string | null;
  nodeName: string | null;
}

interface GameRow {
  id: number;
  name: string;
  slug: string;
  iconEmoji: string | null;
}

interface NodeRow {
  id: number;
  name: string;
  status: string;
  isLocal: boolean | null;
  serverCount: number;
}

export default function OverviewPanel({ user, onNavigate }: { user: AuthUser; onNavigate?: (tab: OverviewTab) => void }) {
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [nodeList, setNodeList] = useState<NodeRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [monRes, srvRes, gameRes, nodeRes] = await Promise.allSettled([
        fetch("/api/monitor"),
        fetch("/api/servers"),
        fetch("/api/games"),
        fetch("/api/nodes"),
      ]);

      if (monRes.status === "fulfilled" && monRes.value.ok) setMonitor(await monRes.value.json());
      if (srvRes.status === "fulfilled" && srvRes.value.ok) setServers((await srvRes.value.json()).servers || []);
      if (gameRes.status === "fulfilled" && gameRes.value.ok) setGames((await gameRes.value.json()).games || []);
      if (nodeRes.status === "fulfilled" && nodeRes.value.ok) setNodeList((await nodeRes.value.json()).nodes || []);
    } catch (e) {
      console.error("OverviewPanel load error:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onlineServers = servers.filter((s) => s.status === "running").length;
  const onlineNodes = nodeList.filter((n) => n.status === "online").length;
  const hasNodes = nodeList.length > 0;
  const hasGames = games.length > 0;
  const hasServers = servers.length > 0;

  async function quickAction(id: number, action: "start" | "stop") {
    try {
      await fetch(`/api/servers/${id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      loadData();
    } catch { /**/ }
  }

  const setupSteps = [
    { done: hasNodes, title: "Add a node", detail: hasNodes ? `${onlineNodes}/${nodeList.length} online` : "Connect the machine that will host servers.", action: "nodes" as OverviewTab, cta: "Open Nodes" },
    { done: hasGames, title: "Install a game template", detail: hasGames ? `${games.length} game template${games.length !== 1 ? "s" : ""} installed` : "Choose a built-in template or import your own.", action: "games" as OverviewTab, cta: "Open Games" },
    { done: hasServers, title: "Create a server", detail: hasServers ? `${servers.length} server${servers.length !== 1 ? "s" : ""} created` : "Run the guided create-server wizard.", action: "servers" as OverviewTab, cta: "Open Servers" },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {user.username} 👋</h2>
        <p className="text-text-secondary text-sm mt-1">Everything important is summarized here so you can jump straight into the next task.</p>
      </div>

      {/* Quick start */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">🚀 Quick Start Checklist</h3>
            <p className="text-text-secondary text-sm">New to the panel? Follow these steps in order.</p>
          </div>
          <span className="text-xs text-text-muted bg-bg-secondary px-3 py-1 rounded-full">
            {setupSteps.filter((s) => s.done).length}/{setupSteps.length} complete
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {setupSteps.map((step, idx) => (
            <div key={step.title} className={`rounded-xl border p-4 ${step.done ? "border-success/30 bg-success/5" : "border-border bg-bg-secondary/40"}`}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step.done ? "bg-success/15 text-success" : "bg-bg-tertiary text-text-muted"}`}>
                  {step.done ? "✓" : idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-xs text-text-muted mt-1">{step.detail}</p>
                  {!step.done && onNavigate && (
                    <button onClick={() => onNavigate(step.action)} className="mt-3 px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs font-medium hover:bg-accent/25 transition-colors">
                      {step.cta}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🖥️" label="Nodes" value={`${onlineNodes}/${nodeList.length}`} sub="Online nodes" color="text-accent" />
        <StatCard icon="🎮" label="Servers" value={`${onlineServers}/${servers.length}`} sub="Running" color="text-success" />
        <StatCard icon="📦" label="Games" value={games.length.toString()} sub="Installed" color="text-purple" />
        <StatCard icon="💾" label="RAM" value={monitor ? `${monitor.memory.usedPercent}%` : "..."} sub={monitor ? `${monitor.memory.usedMb}/${monitor.memory.totalMb} MB` : "Loading..."} color={monitor && monitor.memory.usedPercent > 80 ? "text-danger" : "text-success"} />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction icon="+" title="Create Server" desc="Launch the guided setup wizard." onClick={() => onNavigate?.("servers")} />
        <QuickAction icon="📂" title="Open Files" desc="Edit configs, worlds, mods, and plugins." onClick={() => onNavigate?.("files")} />
        <QuickAction icon="🖥️" title="Open Console" desc="Watch startup logs and runtime output." onClick={() => onNavigate?.("servers")} />
        <QuickAction icon="🔍" title="Run Audit" desc="Verify templates, binaries, and live installs." onClick={() => onNavigate?.("audit")} />
      </div>

      {/* Health bars */}
      {monitor && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h3 className="text-lg font-semibold">System Health</h3>
              <p className="text-text-secondary text-sm">Use this to spot overloaded nodes or high cache usage at a glance.</p>
            </div>
            {onNavigate && <button onClick={() => onNavigate("monitor")} className="text-accent text-sm hover:underline">Open Monitor →</button>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <ProgressBar label="CPU Load" value={Math.min(monitor.cpu.load1 * 25, 100)} suffix={monitor.cpu.load1.toFixed(2)} />
              <ProgressBar label="RAM" value={monitor.memory.usedPercent} suffix={`${monitor.memory.usedPercent}%`} />
              <ProgressBar label="Buffers/Cache" value={monitor.memory.bufferPercent} suffix={`${monitor.memory.bufferPercent}%`} color="bg-warning" />
              <ProgressBar label="Disk" value={monitor.disk.usedPercent || 0} suffix={`${monitor.disk.usedPercent || 0}%`} />
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-text-secondary">Memory Breakdown</h4>
              <div className="text-xs space-y-1">
                <div className="flex justify-between"><span className="text-text-muted">Total</span><span>{monitor.memory.totalMb} MB</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Used</span><span className="text-accent">{monitor.memory.usedMb} MB</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Free</span><span className="text-success">{monitor.memory.freeMb} MB</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Buffers</span><span className="text-warning">{monitor.memory.buffersMb} MB</span></div>
                <div className="flex justify-between"><span className="text-text-muted">Cached</span><span className="text-warning">{monitor.memory.cachedMb} MB</span></div>
                <div className="flex justify-between"><span className="text-text-muted">IPv6</span><span>{monitor.ipv6.enabled ? "✅ Enabled" : "❌ Disabled"}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Nodes */}
      {nodeList.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h3 className="text-lg font-semibold">🖥️ Nodes</h3>
              <p className="text-text-secondary text-sm">Where your game servers run.</p>
            </div>
            {onNavigate && <button onClick={() => onNavigate("nodes")} className="text-accent text-sm hover:underline">Manage Nodes →</button>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {nodeList.map((node) => (
              <div key={node.id} className="bg-bg-secondary rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${node.status === "online" ? "bg-success" : "bg-danger"}`} />
                  <div>
                    <p className="text-sm font-medium">{node.name}</p>
                    {node.isLocal && <p className="text-[10px] text-accent">Local</p>}
                  </div>
                </div>
                <span className="text-xs text-text-muted">{node.serverCount} servers</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasNodes && loaded && (
        <FriendlyEmpty icon="🖥️" title="No nodes configured" text="Add a Local Node first so the panel has somewhere to install and run game servers." buttonLabel="Open Nodes" onClick={() => onNavigate?.("nodes")} />
      )}

      {hasGames && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h3 className="text-lg font-semibold">📦 Installed Games ({games.length})</h3>
              <p className="text-text-secondary text-sm">Templates currently available in the create-server wizard.</p>
            </div>
            {onNavigate && <button onClick={() => onNavigate("games")} className="text-accent text-sm hover:underline">Manage Games →</button>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {games.map((game) => (
              <div key={game.id} className="bg-bg-secondary rounded-lg p-3 flex items-center gap-2">
                <span className="text-lg">{game.iconEmoji || "🎮"}</span>
                <span className="text-sm truncate">{game.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasGames && loaded && (
        <FriendlyEmpty icon="📦" title="No game templates installed" text="Install one or import your own template before creating servers." buttonLabel="Open Games" onClick={() => onNavigate?.("games")} />
      )}

      {hasServers && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h3 className="text-lg font-semibold">🎮 Your Servers ({servers.length})</h3>
              <p className="text-text-secondary text-sm">Quick actions — start, stop, or jump to full management.</p>
            </div>
            {onNavigate && <button onClick={() => onNavigate("servers")} className="text-accent text-sm hover:underline">Manage Servers →</button>}
          </div>
          <div className="space-y-2">
            {servers.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-bg-secondary rounded-lg p-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">{s.gameIcon || "🎮"}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs text-text-muted truncate">{s.gameName} {s.nodeName ? `on ${s.nodeName}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === "running" ? "bg-success/15 text-success" : "bg-bg-tertiary text-text-muted"}`}>{s.status}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {s.status === "running" ? (
                      <button onClick={() => quickAction(s.id, "stop")} className="px-2 py-1 bg-danger/15 text-danger rounded text-[10px] font-medium">⏹</button>
                    ) : (
                      <button onClick={() => quickAction(s.id, "start")} className="px-2 py-1 bg-success/15 text-success rounded text-[10px] font-medium">▶</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasServers && loaded && hasNodes && hasGames && (
        <FriendlyEmpty icon="🎮" title="No servers created yet" text="You already have nodes and game templates ready. The next step is creating your first server." buttonLabel="Open Servers" onClick={() => onNavigate?.("servers")} />
      )}

      {!loaded && (
        <div className="text-center py-8">
          <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm mt-2">Loading your dashboard...</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-text-muted text-xs uppercase tracking-wider">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          <p className="text-text-muted text-xs mt-1">{sub}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

function ProgressBar({ label, value, suffix, color }: { label: string; value: number; suffix: string; color?: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">{suffix}</span>
      </div>
      <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color || (value > 80 ? "bg-danger" : value > 60 ? "bg-warning" : "bg-accent")}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function QuickAction({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 hover:shadow-md transition-all">
      <span className="text-2xl block mb-2">{icon}</span>
      <p className="font-semibold mb-1">{title}</p>
      <p className="text-text-secondary text-sm">{desc}</p>
    </button>
  );
}

function FriendlyEmpty({ icon, title, text, buttonLabel, onClick }: { icon: string; title: string; text: string; buttonLabel?: string; onClick?: () => void }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
      <span className="text-4xl block mb-3">{icon}</span>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-text-secondary text-sm max-w-md mx-auto">{text}</p>
      {buttonLabel && onClick && (
        <button onClick={onClick} className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
