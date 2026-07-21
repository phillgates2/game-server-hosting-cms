"use client";

import { useEffect, useState, useCallback } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

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

export default function OverviewPanel({ user }: { user: AuthUser }) {
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

      if (monRes.status === "fulfilled" && monRes.value.ok) {
        setMonitor(await monRes.value.json());
      }
      if (srvRes.status === "fulfilled" && srvRes.value.ok) {
        const d = await srvRes.value.json();
        setServers(d.servers || []);
      }
      if (gameRes.status === "fulfilled" && gameRes.value.ok) {
        const d = await gameRes.value.json();
        setGames(d.games || []);
      }
      if (nodeRes.status === "fulfilled" && nodeRes.value.ok) {
        const d = await nodeRes.value.json();
        setNodeList(d.nodes || []);
      }
    } catch (e) {
      console.error("OverviewPanel load error:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onlineServers = servers.filter((s) => s.status === "running").length;
  const onlineNodes = nodeList.filter((n) => n.status === "online").length;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {user.username} 👋</h2>
        <p className="text-text-secondary text-sm mt-1">Here&apos;s your server hosting overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🖥️" label="Nodes" value={`${onlineNodes}/${nodeList.length}`} sub="Online nodes" color="text-accent" />
        <StatCard icon="🎮" label="Servers" value={`${onlineServers}/${servers.length}`} sub="Running" color="text-success" />
        <StatCard icon="📦" label="Games" value={games.length.toString()} sub="Installed" color="text-purple" />
        <StatCard
          icon="💾"
          label="RAM"
          value={monitor ? `${monitor.memory.usedPercent}%` : "..."}
          sub={monitor ? `${monitor.memory.usedMb}/${monitor.memory.totalMb} MB` : "Loading..."}
          color={monitor && monitor.memory.usedPercent > 80 ? "text-danger" : "text-success"}
        />
      </div>

      {/* Health bars */}
      {monitor && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">System Health</h3>
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

      {/* Nodes summary */}
      {nodeList.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">🖥️ Nodes</h3>
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

      {/* No nodes warning */}
      {loaded && nodeList.length === 0 && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-6 text-center">
          <span className="text-3xl block mb-2">🖥️</span>
          <h3 className="font-semibold text-warning mb-1">No Nodes Configured</h3>
          <p className="text-text-secondary text-sm">Go to the Nodes panel and click &quot;Add Local Node&quot; to get started</p>
        </div>
      )}

      {/* Games installed */}
      {games.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">📦 Installed Games ({games.length})</h3>
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

      {/* No games warning */}
      {loaded && games.length === 0 && (
        <div className="bg-accent/15 border border-accent/30 rounded-xl p-6 text-center">
          <span className="text-3xl block mb-2">📦</span>
          <h3 className="font-semibold text-accent mb-1">No Games Installed</h3>
          <p className="text-text-secondary text-sm">Go to the Games panel, Templates tab, to install games</p>
        </div>
      )}

      {/* Servers list */}
      {servers.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">🎮 Your Servers ({servers.length})</h3>
          <div className="space-y-2">
            {servers.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-bg-secondary rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{s.gameIcon || "🎮"}</span>
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-text-muted">{s.gameName} {s.nodeName ? `on ${s.nodeName}` : ""}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  s.status === "running" ? "bg-success/15 text-success" : "bg-bg-tertiary text-text-muted"
                }`}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {!loaded && (
        <div className="text-center py-8">
          <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm mt-2">Loading data...</p>
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
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            color || (value > 80 ? "bg-danger" : value > 60 ? "bg-warning" : "bg-accent")
          }`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}
