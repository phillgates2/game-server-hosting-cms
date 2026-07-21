"use client";

import { useEffect, useState, useCallback } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface MemInfo {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  buffersMb: number;
  cachedMb: number;
  availableMb: number;
  bufferPercent: number;
  usedPercent: number;
  swapTotalMb: number;
  swapUsedMb: number;
}

interface MonitorData {
  memory: MemInfo;
  cpu: { load1: number; load5: number; load15: number };
  disk: { totalMb: number; usedMb: number; availableMb: number; usedPercent: number };
  network: { rxMb: number; txMb: number };
  ipv6: { enabled: boolean; addresses: { address: string; iface: string }[] };
  timestamp: string;
}

interface HistoryEntry {
  timestamp: string;
  usedPercent: number;
  bufferPercent: number;
  cpuLoad: number;
}

export default function MonitorPanel({ user }: { user: AuthUser }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [bufferThreshold] = useState(80);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor");
      const d = await res.json();
      setData(d);

      setHistory((prev) => {
        const entry: HistoryEntry = {
          timestamp: new Date().toLocaleTimeString(),
          usedPercent: d.memory?.usedPercent || 0,
          bufferPercent: d.memory?.bufferPercent || 0,
          cpuLoad: d.cpu?.load1 || 0,
        };
        const newHist = [...prev, entry].slice(-30);
        return newHist;
      });

      // Auto-clear buffers if threshold exceeded
      if (d.memory?.bufferPercent > bufferThreshold) {
        setClearMsg("⚠️ Buffer/cache exceeds threshold! Consider clearing.");
      }
    } catch {
      // ignore
    }
  }, [bufferThreshold]);

  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, fetchData]);

  async function clearBuffers() {
    setClearing(true);
    setClearMsg("");
    try {
      const res = await fetch("/api/monitor/clear-buffers", { method: "POST" });
      const d = await res.json();

      const lines: string[] = [];

      if (d.actions?.length) {
        lines.push("Actions performed:");
        d.actions.forEach((a: string) => lines.push(`  ✅ ${a}`));
      }
      if (d.errors?.length) {
        lines.push("Errors:");
        d.errors.forEach((e: string) => lines.push(`  ❌ ${e}`));
      }
      if (d.before && d.after) {
        lines.push("");
        lines.push(`Before → After:`);
        lines.push(`  Buffers: ${d.before.buffersMb} MB → ${d.after.buffersMb} MB (freed ${d.freedBuffersMb} MB)`);
        lines.push(`  Cached:  ${d.before.cachedMb} MB → ${d.after.cachedMb} MB (freed ${d.freedCachedMb} MB)`);
        lines.push(`  Available: ${d.before.availableMb} MB → ${d.after.availableMb} MB (+${d.freedMb} MB)`);
      }

      if (lines.length > 0) {
        setClearMsg(lines.join("\n"));
      } else {
        setClearMsg(d.message || "Done");
      }

      setTimeout(() => fetchData(), 1000);
    } catch {
      setClearMsg("Failed to clear buffers — network error");
    } finally {
      setClearing(false);
    }
  }

  if (!data) {
    return (
      <div className="animate-fade-in flex items-center justify-center p-12">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-text-secondary text-sm">Loading system metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Server Monitor</h2>
          <p className="text-text-secondary text-sm">Real-time system resource monitoring with buffer management</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              autoRefresh ? "bg-success/15 text-success" : "bg-bg-secondary text-text-muted"
            }`}
          >
            {autoRefresh ? "● Live" : "○ Paused"}
          </button>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 bg-bg-secondary hover:bg-bg-hover text-text-secondary rounded-lg text-xs font-medium transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="CPU Load" value={data.cpu.load1.toFixed(2)} icon="⚡" color={data.cpu.load1 > 4 ? "text-danger" : "text-accent"} />
        <MetricCard label="RAM Used" value={`${data.memory.usedPercent}%`} icon="💾" color={data.memory.usedPercent > 80 ? "text-danger" : "text-success"} />
        <MetricCard label="Buffers/Cache" value={`${data.memory.bufferPercent}%`} icon="📦" color={data.memory.bufferPercent > bufferThreshold ? "text-danger" : "text-warning"} />
        <MetricCard label="Disk Used" value={`${data.disk.usedPercent}%`} icon="💿" color={data.disk.usedPercent > 80 ? "text-danger" : "text-accent"} />
      </div>

      {/* RAM Details + Buffer Management */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">🧠 Memory Details</h3>
          <div className="space-y-3">
            <MemRow label="Total RAM" value={`${data.memory.totalMb} MB`} />
            <MemRow label="Used" value={`${data.memory.usedMb} MB`} color="text-accent" />
            <MemRow label="Free" value={`${data.memory.freeMb} MB`} color="text-success" />
            <MemRow label="Buffers" value={`${data.memory.buffersMb} MB`} color="text-warning" />
            <MemRow label="Cached" value={`${data.memory.cachedMb} MB`} color="text-warning" />
            <MemRow label="Available" value={`${data.memory.availableMb} MB`} color="text-success" />
            <div className="border-t border-border pt-3 mt-3">
              <MemRow label="Swap Total" value={`${data.memory.swapTotalMb} MB`} />
              <MemRow label="Swap Used" value={`${data.memory.swapUsedMb} MB`} color="text-purple" />
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">📦 Buffer/Cache Management</h3>
          <div className="space-y-4">
            {/* Buffer visualization */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-secondary">Buffer/Cache Usage</span>
                <span className={data.memory.bufferPercent > bufferThreshold ? "text-danger font-bold" : "text-text-muted"}>
                  {data.memory.bufferPercent}% (threshold: {bufferThreshold}%)
                </span>
              </div>
              <div className="h-6 bg-bg-secondary rounded-full overflow-hidden relative">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.memory.bufferPercent > bufferThreshold ? "bg-danger pulse-glow" : "bg-warning"
                  }`}
                  style={{ width: `${data.memory.bufferPercent}%` }}
                />
                <div
                  className="absolute top-0 h-full w-0.5 bg-danger"
                  style={{ left: `${bufferThreshold}%` }}
                  title={`Threshold: ${bufferThreshold}%`}
                />
              </div>
            </div>

            <div className="bg-bg-secondary rounded-lg p-4 text-xs text-text-secondary space-y-1">
              <p><strong>Buffers:</strong> {data.memory.buffersMb} MB — Kernel filesystem metadata caches</p>
              <p><strong>Cached:</strong> {data.memory.cachedMb} MB — Page cache for files read from disk</p>
              <p className="text-text-muted mt-2">
                High buffer/cache usage is usually fine — Linux uses free memory for caching. 
                Clear only when game servers need more available RAM.
              </p>
            </div>

            {user.role === "admin" && (
              <button
                onClick={clearBuffers}
                disabled={clearing}
                className="w-full py-3 bg-warning/15 hover:bg-warning/25 text-warning rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {clearing ? "Clearing..." : "🧹 Clear Buffers & Page Cache"}
              </button>
            )}

            {clearMsg && (
              <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap">
                {clearMsg}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History chart (text-based) */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">📊 Resource History (Last 30 samples)</h3>
        <div className="overflow-x-auto">
          <div className="flex items-end gap-1 h-32 min-w-[600px]">
            {history.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                <div
                  className="w-full bg-accent/80 rounded-t transition-all"
                  style={{ height: `${h.usedPercent * 1.2}px` }}
                  title={`RAM: ${h.usedPercent}%`}
                />
                <div
                  className="w-full bg-warning/60 rounded-t transition-all"
                  style={{ height: `${h.bufferPercent * 0.6}px` }}
                  title={`Buffer: ${h.bufferPercent}%`}
                />
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-bg-primary border border-border px-2 py-1 rounded text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  {h.timestamp} | RAM: {h.usedPercent}% | Buf: {h.bufferPercent}%
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-text-muted mt-1">
            <span>{history[0]?.timestamp || ""}</span>
            <div className="flex gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-accent rounded-sm inline-block" /> RAM</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-warning rounded-sm inline-block" /> Buffer</span>
            </div>
            <span>{history[history.length - 1]?.timestamp || ""}</span>
          </div>
        </div>
      </div>

      {/* Network & IPv6 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">🌐 Network</h3>
          <div className="space-y-3">
            <MemRow label="Data Received" value={`${data.network.rxMb} MB`} color="text-success" />
            <MemRow label="Data Sent" value={`${data.network.txMb} MB`} color="text-accent" />
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">🌐 IPv6 Status</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${data.ipv6.enabled ? "bg-success" : "bg-danger"}`} />
              <span className="text-sm">{data.ipv6.enabled ? "IPv6 Enabled" : "IPv6 Not Available"}</span>
            </div>
            {data.ipv6.addresses?.length > 0 && (
              <div className="space-y-1 mt-2">
                {data.ipv6.addresses.map((addr, i) => (
                  <div key={i} className="text-xs text-text-muted font-mono bg-bg-secondary p-2 rounded">
                    {addr.iface}: {addr.address}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-muted text-xs">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

function MemRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className={color || "text-text-primary"}>{value}</span>
    </div>
  );
}
