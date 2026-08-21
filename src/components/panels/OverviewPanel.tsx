"use client";

import { useEffect, useState, useCallback } from "react";
import { movePanelInOrder, type DashboardPanelId } from "./dashboardLayoutUtils";

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

interface ActivityEntry {
  id: number;
  action: string;
  details: string | null;
  createdAt: string;
  username: string | null;
}

export default function OverviewPanel({ user, onNavigate }: { user: AuthUser; onNavigate?: (tab: OverviewTab) => void }) {
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [nodeList, setNodeList] = useState<NodeRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panelOrder, setPanelOrder] = useState<DashboardPanelId[]>(["quick-start", "stats", "actions", "health", "nodes", "games", "servers"]);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<DashboardPanelId, boolean>>({
    "quick-start": false,
    stats: false,
    actions: false,
    health: false,
    nodes: false,
    games: false,
    servers: false,
  });

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [monRes, srvRes, gameRes, nodeRes] = await Promise.allSettled([
        fetch("/api/monitor"),
        fetch("/api/servers"),
        fetch("/api/games"),
        fetch("/api/nodes"),
      ]);

      const failures: string[] = [];

      if (monRes.status === "fulfilled" && monRes.value.ok) {
        setMonitor(await monRes.value.json());
      } else if (monRes.status === "fulfilled") {
        failures.push("monitor");
      } else {
        failures.push("monitor");
      }

      if (srvRes.status === "fulfilled" && srvRes.value.ok) {
        setServers((await srvRes.value.json()).servers || []);
      } else {
        failures.push("servers");
      }

      if (gameRes.status === "fulfilled" && gameRes.value.ok) {
        setGames((await gameRes.value.json()).games || []);
      } else {
        failures.push("games");
      }

      if (nodeRes.status === "fulfilled" && nodeRes.value.ok) {
        setNodeList((await nodeRes.value.json()).nodes || []);
      } else {
        failures.push("nodes");
      }

      if (failures.length > 0) {
        setLoadError("Some dashboard data could not be refreshed. Check your connection or permissions and try again.");
      } else {
        setLoadError(null);
      }

      setLastUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      console.error("OverviewPanel load error:", e);
      setLoadError("The overview could not be refreshed. Please try again in a moment.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/audit-log?limit=5");
        if (res.ok) {
          const data = await res.json();
          setRecentActivity(data.entries || []);
        }
      } catch {
        setRecentActivity([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const onlineServers = servers.filter((s) => s.status === "running").length;
  const onlineNodes = nodeList.filter((n) => n.status === "online").length;
  const hasNodes = nodeList.length > 0;
  const hasGames = games.length > 0;
  const hasServers = servers.length > 0;
  const offlineNodes = nodeList.filter((n) => n.status !== "online").length;
  const failedInstalls = servers.filter((s) => s.status === "install_failed").length;
  const attentionItems = [
    ...(offlineNodes > 0 ? [`${offlineNodes} node${offlineNodes === 1 ? "" : "s"} ${offlineNodes === 1 ? "is" : "are"} offline.`] : []),
    ...(failedInstalls > 0 ? [`${failedInstalls} server${failedInstalls === 1 ? "" : "s"} ${failedInstalls === 1 ? "has" : "have"} an install failure.`] : []),
    ...(hasServers && onlineServers === 0 ? ["No servers are currently running."] : []),
  ];

  const togglePanel = (panelId: DashboardPanelId) => {
    setCollapsedPanels((prev) => ({ ...prev, [panelId]: !prev[panelId] }));
  };

  const movePanel = (panelId: DashboardPanelId, direction: -1 | 1) => {
    setPanelOrder((prev) => movePanelInOrder(prev, panelId, direction));
  };

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

  const panelSections: Record<DashboardPanelId, React.ReactElement> = {
    "quick-start": (
      <DashboardSection key="quick-start" title="🚀 Quick Start Checklist" description="New to the panel? Follow these steps in order." onToggle={() => togglePanel("quick-start")} collapsed={collapsedPanels["quick-start"]} onMove={(direction) => movePanel("quick-start", direction)}>
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
      </DashboardSection>
    ),
    stats: (
      <DashboardSection key="stats" title="📊 Snapshot" description="The current health of your infrastructure at a glance." onToggle={() => togglePanel("stats")} collapsed={collapsedPanels.stats} onMove={(direction) => movePanel("stats", direction)}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon="🖥️" label="Nodes" value={`${onlineNodes}/${nodeList.length}`} sub="Online nodes" color="text-accent" />
          <StatCard icon="🎮" label="Servers" value={`${onlineServers}/${servers.length}`} sub="Running" color="text-success" />
          <StatCard icon="📦" label="Games" value={games.length.toString()} sub="Installed" color="text-purple" />
          <StatCard icon="💾" label="RAM" value={monitor ? `${monitor.memory.usedPercent}%` : "..."} sub={monitor ? `${monitor.memory.usedMb}/${monitor.memory.totalMb} MB` : "Loading..."} color={monitor && monitor.memory.usedPercent > 80 ? "text-danger" : "text-success"} />
        </div>
      </DashboardSection>
    ),
    actions: (
      <DashboardSection key="actions" title="⚡ Quick Actions" description="Jump to the tasks that matter most." onToggle={() => togglePanel("actions")} collapsed={collapsedPanels.actions} onMove={(direction) => movePanel("actions", direction)}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickAction icon="+" title="Create Server" desc="Launch the guided setup wizard." onClick={() => onNavigate?.("servers")} />
          <QuickAction icon="📂" title="Open Files" desc="Edit configs, worlds, mods, and plugins." onClick={() => onNavigate?.("files")} />
          <QuickAction icon="🖥️" title="Open Console" desc="Watch startup logs and runtime output." onClick={() => onNavigate?.("servers")} />
          <QuickAction icon="🔍" title="Run Audit" desc="Verify templates, binaries, and live installs." onClick={() => onNavigate?.("audit")} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ShortcutButton label="Nodes" icon="🖥️" onClick={() => onNavigate?.("nodes")} />
          <ShortcutButton label="Games" icon="📦" onClick={() => onNavigate?.("games")} />
          <ShortcutButton label="Monitor" icon="📈" onClick={() => onNavigate?.("monitor")} />
          <ShortcutButton label="Users" icon="👥" onClick={() => onNavigate?.("users")} />
          <ShortcutButton label="Roles" icon="🔑" onClick={() => onNavigate?.("roles")} />
        </div>
      </DashboardSection>
    ),
    health: (
      <DashboardSection key="health" title="🩺 System Health" description="Use this to spot overloaded nodes or high cache usage at a glance." onToggle={() => togglePanel("health")} collapsed={collapsedPanels.health} onMove={(direction) => movePanel("health", direction)}>
        {monitor ? (
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
        ) : <div className="text-sm text-text-secondary">Monitoring data is still loading.</div>}
      </DashboardSection>
    ),
    nodes: (
      <DashboardSection key="nodes" title="🖥️ Nodes" description="Where your game servers run." onToggle={() => togglePanel("nodes")} collapsed={collapsedPanels.nodes} onMove={(direction) => movePanel("nodes", direction)}>
        {nodeList.length > 0 ? (
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
        ) : <FriendlyEmpty icon="🖥️" title="No nodes configured" text="Add a Local Node first so the panel has somewhere to install and run game servers." buttonLabel="Open Nodes" onClick={() => onNavigate?.("nodes")} />}
      </DashboardSection>
    ),
    games: (
      <DashboardSection key="games" title="📦 Installed Games" description="Templates currently available in the create-server wizard." onToggle={() => togglePanel("games")} collapsed={collapsedPanels.games} onMove={(direction) => movePanel("games", direction)}>
        {hasGames ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {games.map((game) => (
              <div key={game.id} className="bg-bg-secondary rounded-lg p-3 flex items-center gap-2">
                <span className="text-lg">{game.iconEmoji || "🎮"}</span>
                <span className="text-sm truncate">{game.name}</span>
              </div>
            ))}
          </div>
        ) : <FriendlyEmpty icon="📦" title="No game templates installed" text="Install one or import your own template before creating servers." buttonLabel="Open Games" onClick={() => onNavigate?.("games")} />}
      </DashboardSection>
    ),
    servers: (
      <DashboardSection key="servers" title="🎮 Server Health" description="Quickly see which servers need attention and which are healthy." onToggle={() => togglePanel("servers")} collapsed={collapsedPanels.servers} onMove={(direction) => movePanel("servers", direction)}>
        {hasServers ? (
          <div className="space-y-3">
            {servers.slice(0, 6).map((s) => (
              <div key={s.id} className="rounded-xl border border-border bg-bg-secondary/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg">{s.gameIcon || "🎮"}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <p className="text-xs text-text-muted truncate">{s.gameName} {s.nodeName ? `on ${s.nodeName}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === "running" ? "bg-success/15 text-success" : s.status === "install_failed" ? "bg-danger/15 text-danger" : "bg-bg-tertiary text-text-muted"}`}>{s.status}</span>
                    <div className="flex gap-1">
                      {s.status === "running" ? (
                        <button onClick={() => quickAction(s.id, "stop")} className="px-2 py-1 bg-danger/15 text-danger rounded text-[10px] font-medium">⏹</button>
                      ) : (
                        <button onClick={() => quickAction(s.id, "start")} className="px-2 py-1 bg-success/15 text-success rounded text-[10px] font-medium">▶</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-3">
                  <div className="rounded-lg bg-bg-card px-2 py-2">Status: <span className="font-medium text-text-primary">{s.status}</span></div>
                  <div className="rounded-lg bg-bg-card px-2 py-2">Node: <span className="font-medium text-text-primary">{s.nodeName || "—"}</span></div>
                  <div className="rounded-lg bg-bg-card px-2 py-2">Game: <span className="font-medium text-text-primary">{s.gameName || "—"}</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : <FriendlyEmpty icon="🎮" title="No servers created yet" text="You already have nodes and game templates ready. The next step is creating your first server." buttonLabel="Open Servers" onClick={() => onNavigate?.("servers")} />}
      </DashboardSection>
    ),
  };

  return (
    <div className="animate-fade-in panel-view space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-text-muted">Mission Control</p>
          <h2 className="heading-font text-2xl font-bold uppercase tracking-[0.08em]">Welcome back, {user.username} 👋</h2>
          <p className="text-text-secondary text-sm mt-1">Everything important is summarized here so you can jump straight into the next task.</p>
        </div>
        <button onClick={() => { setLoaded(false); void loadData(); }} className="inline-flex items-center gap-2 self-start rounded-lg gaming-chip px-3 py-2 text-sm text-text-secondary transition-colors hover:border-accent/30 hover:text-accent">
          <span>↻</span>
          <span>{lastUpdated ? `Updated ${lastUpdated}` : "Refresh"}</span>
        </button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>{loadError}</p>
            <button onClick={() => { setLoaded(false); void loadData(); }} className="rounded-lg border border-warning/30 bg-bg-card px-3 py-1.5 text-xs font-medium text-warning">Retry</button>
          </div>
        </div>
      )}

      {panelOrder.map((panelId) => panelSections[panelId])}

      {(attentionItems.length > 0 || recentActivity.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="gaming-surface rounded-xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="heading-font text-lg font-semibold uppercase tracking-[0.06em]">⚠️ Needs attention</h3>
                <p className="text-sm text-text-secondary">Issues that are worth checking before the next deployment window.</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-text-secondary">
              {attentionItems.length > 0 ? attentionItems.map((item) => <li key={item} className="rounded-lg bg-bg-secondary px-3 py-2 border border-border/60">{item}</li>) : <li className="rounded-lg bg-bg-secondary px-3 py-2 border border-border/60">Everything looks healthy right now.</li>}
            </ul>
          </div>
          <div className="gaming-surface rounded-xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="heading-font text-lg font-semibold uppercase tracking-[0.06em]">🕒 Recent activity</h3>
                <p className="text-sm text-text-secondary">The latest admin and server actions from the panel.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {recentActivity.length > 0 ? recentActivity.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border bg-bg-secondary/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text-primary">{entry.action}</p>
                    <span className="text-[11px] text-text-muted">{formatRelativeTime(entry.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{entry.details || (entry.username ? `By ${entry.username}` : "Panel activity")}</p>
                </div>
              )) : <p className="rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-secondary">No recent activity yet.</p>}
            </div>
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

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMins = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="gaming-surface rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-text-muted text-xs uppercase tracking-wider">{label}</p>
          <p className={`heading-font text-2xl font-bold mt-1 ${color}`}>{value}</p>
          <p className="text-text-muted text-xs mt-1">{sub}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

function DashboardSection({ title, description, children, collapsed, onToggle, onMove }: { title: string; description: string; children: React.ReactNode; collapsed?: boolean; onToggle: () => void; onMove: (direction: -1 | 1) => void }) {
  return (
    <div className="gaming-surface rounded-xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="heading-font text-lg font-semibold uppercase tracking-[0.06em]">{title}</h3>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onMove(-1)} className="rounded-lg gaming-chip px-2 py-1 text-xs text-text-secondary hover:border-accent/30">↑</button>
          <button onClick={() => onMove(1)} className="rounded-lg gaming-chip px-2 py-1 text-xs text-text-secondary hover:border-accent/30">↓</button>
          <button onClick={onToggle} className="rounded-lg gaming-chip px-2 py-1 text-xs text-text-secondary hover:border-accent/30">{collapsed ? "Expand" : "Collapse"}</button>
        </div>
      </div>
      {!collapsed && children}
    </div>
  );
}

function ShortcutButton({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 rounded-full gaming-chip px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent/30 hover:text-accent">
      <span>{icon}</span>
      <span>{label}</span>
    </button>
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
    <button onClick={onClick} className="gaming-surface rounded-xl p-5 text-left hover:border-accent/30 hover:-translate-y-0.5 transition-all">
      <span className="text-2xl block mb-2">{icon}</span>
      <p className="heading-font font-semibold mb-1 uppercase tracking-[0.05em]">{title}</p>
      <p className="text-text-secondary text-sm">{desc}</p>
    </button>
  );
}

function FriendlyEmpty({ icon, title, text, buttonLabel, onClick }: { icon: string; title: string; text: string; buttonLabel?: string; onClick?: () => void }) {
  return (
    <div className="gaming-surface rounded-xl p-8 text-center">
      <span className="text-4xl block mb-3">{icon}</span>
      <h3 className="heading-font font-semibold mb-1 uppercase tracking-[0.05em]">{title}</h3>
      <p className="text-text-secondary text-sm max-w-md mx-auto">{text}</p>
      {buttonLabel && onClick && (
        <button onClick={onClick} className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-slate-950 rounded-lg text-sm font-bold uppercase tracking-[0.05em]">
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
