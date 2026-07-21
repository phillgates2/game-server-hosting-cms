"use client";

import { useEffect, useState } from "react";

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
}

interface GameRow {
  id: number;
  name: string;
  slug: string;
  iconEmoji: string | null;
}

export default function OverviewPanel({ user }: { user: AuthUser }) {
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);

  useEffect(() => {
    fetch("/api/monitor").then((r) => r.json()).then((d) => setMonitor(d)).catch(() => {});
    fetch("/api/servers").then((r) => r.json()).then((d) => setServers(d.servers || [])).catch(() => {});
    fetch("/api/games").then((r) => r.json()).then((d) => setGames(d.games || [])).catch(() => {});
  }, []);

  const onlineServers = servers.filter((s) => s.status === "running").length;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {user.username} 👋</h2>
        <p className="text-text-secondary text-sm mt-1">Here&apos;s your server hosting overview</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="🖥️"
          label="Total Servers"
          value={servers.length.toString()}
          sub={`${onlineServers} online`}
          color="text-accent"
        />
        <StatCard
          icon="🎮"
          label="Games Available"
          value={games.length.toString()}
          sub="Installable"
          color="text-purple"
        />
        <StatCard
          icon="💾"
          label="RAM Usage"
          value={monitor ? `${monitor.memory.usedPercent}%` : "..."}
          sub={monitor ? `${monitor.memory.usedMb}/${monitor.memory.totalMb} MB` : "Loading"}
          color="text-success"
        />
        <StatCard
          icon="🌐"
          label="IPv6"
          value={monitor?.ipv6?.enabled ? "Enabled" : "Disabled"}
          sub="Network protocol"
          color="text-warning"
        />
      </div>

      {/* System health */}
      {monitor && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">System Health</h3>
            <div className="space-y-4">
              <ProgressBar label="CPU Load" value={Math.min(monitor.cpu.load1 * 25, 100)} suffix={monitor.cpu.load1.toFixed(2)} />
              <ProgressBar label="RAM" value={monitor.memory.usedPercent} suffix={`${monitor.memory.usedPercent}%`} />
              <ProgressBar label="RAM Buffers/Cache" value={monitor.memory.bufferPercent} suffix={`${monitor.memory.bufferPercent}%`} color="bg-warning" />
              <ProgressBar label="Disk" value={monitor.disk.usedPercent || 0} suffix={`${monitor.disk.usedPercent || 0}%`} />
            </div>
          </div>

          <div className="bg-bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Available Games</h3>
            <div className="space-y-2">
              {games.map((game) => (
                <div key={game.id} className="flex items-center gap-3 p-3 bg-bg-secondary rounded-lg">
                  <span className="text-xl">{game.iconEmoji || "🎮"}</span>
                  <div>
                    <p className="text-sm font-medium">{game.name}</p>
                    <p className="text-xs text-text-muted">{game.slug}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent servers */}
      {servers.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Your Servers</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted border-b border-border">
                  <th className="text-left pb-3 font-medium">Server</th>
                  <th className="text-left pb-3 font-medium">Game</th>
                  <th className="text-left pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="py-3">
                      <span className="text-lg mr-2">{s.gameIcon || "🎮"}</span>
                      {s.name}
                    </td>
                    <td className="py-3 text-text-secondary">{s.gameName}</td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          s.status === "running"
                            ? "bg-success/15 text-success"
                            : s.status === "installing"
                            ? "bg-warning/15 text-warning"
                            : "bg-danger/15 text-danger"
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
