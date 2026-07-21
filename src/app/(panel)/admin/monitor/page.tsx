"use client";

import { useEffect, useState, useCallback } from "react";

interface MemoryInfo {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  availableMb: number;
  buffersMb: number;
  cachedMb: number;
  buffCacheMb: number;
  usedPercent: number;
  buffCachePercent: number;
  realUsedPercent: number;
  swapTotalMb: number;
  swapUsedMb: number;
  swapFreeMb: number;
  swapPercent: number;
}

interface CpuInfo {
  usagePercent: number;
  loadAvg1: string;
  loadAvg5: string;
  loadAvg15: string;
  cores: number;
}

interface DiskInfo {
  totalGb: number;
  usedGb: number;
  freeGb: number;
  usedPercent: number;
  mountpoint: string;
}

interface NetworkStack {
  ipv4Addresses: string[];
  ipv6Addresses: string[];
  ipv6Enabled: boolean;
  dualStack: boolean;
}

interface MonitorData {
  snapshot: {
    memory: MemoryInfo;
    cpu: CpuInfo;
    disk: DiskInfo;
    network: NetworkStack;
    uptime: string;
    hostname: string;
    kernel: string;
    timestamp: string;
  };
  memStatus: { status: string; color: string; label: string };
  thresholdCheck: { shouldClear: boolean; reason: string };
  config: {
    autoCleanEnabled: boolean;
    buffCacheThresholdPercent: number;
    ramUsedThresholdPercent: number;
    checkIntervalSeconds: number;
    clearLevel: number;
    keepHistoryHours: number;
  };
  history: Array<{
    usedRam: number;
    buffersRam: number;
    cachedRam: number;
    cpuUsage: number;
    createdAt: string;
  }>;
}

interface ClearEvent {
  id: number;
  trigger: string;
  ramBeforeMb: number;
  buffersBeforeMb: number;
  cachedBeforeMb: number;
  ramAfterMb: number | null;
  buffersAfterMb: number | null;
  cachedAfterMb: number | null;
  freedMb: number | null;
  clearLevel: number;
  status: string;
  errorLog: string | null;
  createdAt: string;
}

const statusColorMap: Record<string, string> = {
  green: "text-green-400",
  yellow: "text-yellow-400",
  orange: "text-orange-400",
  red: "text-red-400",
};

const statusBgMap: Record<string, string> = {
  green: "bg-green-500/10 border-green-500/30",
  yellow: "bg-yellow-500/10 border-yellow-500/30",
  orange: "bg-orange-500/10 border-orange-500/30",
  red: "bg-red-500/10 border-red-500/30",
};

const statusGlowMap: Record<string, string> = {
  green: "shadow-green-500/20",
  yellow: "shadow-yellow-500/20",
  orange: "shadow-orange-500/20",
  red: "shadow-red-500/20",
};

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function RingGauge({ percent, color, size = 120, strokeWidth = 10, label, value }: {
  percent: number;
  color: string;
  size?: number;
  strokeWidth?: number;
  label: string;
  value: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const gradientColors: Record<string, [string, string]> = {
    green: ["#22c55e", "#16a34a"],
    yellow: ["#eab308", "#ca8a04"],
    orange: ["#f97316", "#ea580c"],
    red: ["#ef4444", "#dc2626"],
    blue: ["#3b82f6", "#2563eb"],
    purple: ["#8b5cf6", "#7c3aed"],
    cyan: ["#06b6d4", "#0891b2"],
  };
  const [c1, c2] = gradientColors[color] || gradientColors.blue;
  const id = `gauge-${label.replace(/\s+/g, "-")}`;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id}>
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1f2a42" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={`url(#${id})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-2xl font-bold text-white">{percent}%</span>
        <span className="text-xs text-dark-400">{value}</span>
      </div>
      <span className="text-sm text-dark-300 mt-2">{label}</span>
    </div>
  );
}

function MiniBar({ percent, color, height = 6 }: { percent: number; color: string; height?: number }) {
  const colorMap: Record<string, string> = {
    green: "from-green-500 to-green-600",
    yellow: "from-yellow-500 to-yellow-600",
    orange: "from-orange-500 to-orange-600",
    red: "from-red-500 to-red-600",
    blue: "from-blue-500 to-blue-600",
    purple: "from-purple-500 to-purple-600",
    cyan: "from-cyan-500 to-cyan-600",
    brand: "from-brand-500 to-brand-600",
  };
  return (
    <div className="w-full bg-dark-700 rounded-full overflow-hidden" style={{ height }}>
      <div
        className={`h-full bg-gradient-to-r ${colorMap[color] || colorMap.blue} rounded-full transition-all duration-700`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [events, setEvents] = useState<ClearEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [configEdit, setConfigEdit] = useState(false);
  const [configForm, setConfigForm] = useState({
    autoCleanEnabled: true,
    buffCacheThresholdPercent: 80,
    ramUsedThresholdPercent: 90,
    checkIntervalSeconds: 60,
    clearLevel: 3,
    keepHistoryHours: 24,
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"live" | "history" | "settings">("live");

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, eventsRes] = await Promise.all([
        fetch("/api/monitor/status"),
        fetch("/api/monitor/history"),
      ]);
      const statusData = await statusRes.json();
      const eventsData = await eventsRes.json();
      setData(statusData);
      setEvents(eventsData.events || []);
      if (statusData.config) {
        setConfigForm(statusData.config);
      }
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const handleClearCache = async (level: number) => {
    setClearing(true);
    setClearResult(null);
    try {
      const res = await fetch("/api/monitor/clear-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, trigger: "manual" }),
      });
      const d = await res.json();
      if (d.result) {
        setClearResult(
          d.result.success
            ? `✅ Cleared ${d.result.freedMb} MB (Level ${level})`
            : `⚠️ Clear attempted — ${d.result.error || "see logs"}`
        );
      }
      await fetchData();
    } catch {
      setClearResult("❌ Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      await fetch("/api/monitor/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configForm),
      });
      setConfigEdit(false);
      await fetchData();
    } catch {
      // error
    } finally {
      setConfigSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dark-300">Loading system monitor...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-16 text-dark-300">Failed to load monitor data</div>;
  }

  const { snapshot, memStatus, thresholdCheck, config } = data;
  const mem = snapshot.memory;
  const cpu = snapshot.cpu;
  const disk = snapshot.disk;

  const ramColor = mem.realUsedPercent >= 90 ? "red" : mem.realUsedPercent >= 70 ? "orange" : mem.realUsedPercent >= 50 ? "yellow" : "green";
  const bufferColor = mem.buffCachePercent >= 80 ? "red" : mem.buffCachePercent >= 60 ? "orange" : mem.buffCachePercent >= 40 ? "yellow" : "green";

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Server Monitor</h1>
          <p className="text-dark-300 mt-1">{snapshot.hostname} • {snapshot.kernel} • Up {snapshot.uptime}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
              autoRefresh ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-dark-600 text-dark-300"
            }`}
          >
            {autoRefresh ? "● Live" : "○ Paused"}
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-white rounded-xl text-sm transition-all"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Alert Banner */}
      {thresholdCheck.shouldClear && (
        <div className={`mb-6 p-4 rounded-xl border flex items-center justify-between ${statusBgMap[memStatus.color]} shadow-lg ${statusGlowMap[memStatus.color]}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{memStatus.color === "red" ? "🚨" : "⚠️"}</span>
            <div>
              <div className={`font-bold ${statusColorMap[memStatus.color]}`}>{memStatus.label}</div>
              <div className="text-sm text-dark-300">{thresholdCheck.reason}</div>
            </div>
          </div>
          <button
            onClick={() => handleClearCache(config.clearLevel)}
            disabled={clearing}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 animate-pulse-glow"
          >
            {clearing ? "Clearing..." : "🧹 Clear Now"}
          </button>
        </div>
      )}

      {clearResult && (
        <div className="mb-6 p-4 bg-brand-500/10 border border-brand-500/30 rounded-xl text-brand-400 text-sm flex items-center justify-between">
          <span>{clearResult}</span>
          <button onClick={() => setClearResult(null)} className="text-dark-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-dark-800 rounded-xl p-1 w-fit">
        {(["live", "history", "settings"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize ${
              activeTab === tab ? "bg-brand-500 text-white" : "text-dark-300 hover:text-white"
            }`}
          >
            {tab === "live" ? "📊 Live Monitor" : tab === "history" ? "📜 Clear History" : "⚙️ Settings"}
          </button>
        ))}
      </div>

      {/* ═══ LIVE TAB ═══ */}
      {activeTab === "live" && (
        <>
          {/* Gauges Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[
              { percent: mem.realUsedPercent, color: ramColor, label: "RAM Used", value: `${formatMb(mem.totalMb - mem.availableMb)} / ${formatMb(mem.totalMb)}` },
              { percent: mem.buffCachePercent, color: bufferColor, label: "Buffers + Cache", value: formatMb(mem.buffCacheMb) },
              { percent: cpu.usagePercent, color: cpu.usagePercent > 80 ? "red" : cpu.usagePercent > 50 ? "yellow" : "green", label: "CPU", value: `${cpu.cores} cores` },
              { percent: disk.usedPercent, color: disk.usedPercent > 90 ? "red" : disk.usedPercent > 70 ? "yellow" : "blue", label: "Disk", value: `${disk.usedGb}/${disk.totalGb} GB` },
            ].map((g, i) => (
              <div key={i} className="glass-card rounded-2xl p-6 flex justify-center relative">
                <RingGauge {...g} />
              </div>
            ))}
          </div>

          {/* Detailed RAM Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                🧠 RAM Breakdown
              </h3>

              {/* Stacked bar */}
              <div className="mb-6">
                <div className="w-full h-8 bg-dark-700 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-700"
                    style={{ width: `${Math.max(0, ((mem.totalMb - mem.availableMb - mem.buffCacheMb) / mem.totalMb) * 100)}%` }}
                    title="Active"
                  />
                  <div
                    className="h-full bg-gradient-to-r from-yellow-500 to-yellow-600 transition-all duration-700"
                    style={{ width: `${(mem.buffersMb / mem.totalMb) * 100}%` }}
                    title="Buffers"
                  />
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-700"
                    style={{ width: `${(mem.cachedMb / mem.totalMb) * 100}%` }}
                    title="Cached"
                  />
                  <div
                    className="h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-700 flex-1"
                    title="Free"
                  />
                </div>
                <div className="flex gap-4 mt-2 text-xs flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Active</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" /> Buffers</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-orange-500 inline-block" /> Cached</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Free</span>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { label: "Total", value: formatMb(mem.totalMb), pct: 100, color: "blue" },
                  { label: "Used (incl. buff/cache)", value: formatMb(mem.usedMb), pct: mem.usedPercent, color: "red" },
                  { label: "Buffers", value: formatMb(mem.buffersMb), pct: mem.totalMb > 0 ? (mem.buffersMb / mem.totalMb) * 100 : 0, color: "yellow" },
                  { label: "Cached", value: formatMb(mem.cachedMb), pct: mem.totalMb > 0 ? (mem.cachedMb / mem.totalMb) * 100 : 0, color: "orange" },
                  { label: "Available", value: formatMb(mem.availableMb), pct: mem.totalMb > 0 ? (mem.availableMb / mem.totalMb) * 100 : 0, color: "green" },
                  { label: "Free", value: formatMb(mem.freeMb), pct: mem.totalMb > 0 ? (mem.freeMb / mem.totalMb) * 100 : 0, color: "green" },
                ].map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-dark-300">{item.label}</span>
                      <span className="text-white font-medium">{item.value} <span className="text-dark-400">({Math.round(item.pct)}%)</span></span>
                    </div>
                    <MiniBar percent={item.pct} color={item.color} />
                  </div>
                ))}
              </div>

              {mem.swapTotalMb > 0 && (
                <div className="mt-6 pt-4 border-t border-dark-600">
                  <h4 className="text-sm font-semibold text-white mb-3">Swap</h4>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-dark-300">Used</span>
                    <span className="text-white">{formatMb(mem.swapUsedMb)} / {formatMb(mem.swapTotalMb)} ({mem.swapPercent}%)</span>
                  </div>
                  <MiniBar percent={mem.swapPercent} color={mem.swapPercent > 50 ? "red" : "purple"} />
                </div>
              )}
            </div>

            {/* Right column: Actions + System */}
            <div className="space-y-6">
              {/* Clear Actions */}
              <div className="glass-card rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  🧹 Buffer / Cache Control
                </h3>
                <p className="text-dark-300 text-sm mb-5">
                  Clear Linux page cache, dentries, and inodes to reclaim memory held in buffers. 
                  This runs <code className="text-accent-400">sync && echo N &gt; /proc/sys/vm/drop_caches</code>.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => handleClearCache(1)}
                    disabled={clearing}
                    className="p-4 bg-dark-700 hover:bg-dark-600 rounded-xl transition-all text-center disabled:opacity-50 group"
                  >
                    <div className="text-2xl mb-1 group-hover:scale-110 transition-transform">📄</div>
                    <div className="text-sm font-semibold text-white">Level 1</div>
                    <div className="text-xs text-dark-400 mt-1">Page cache</div>
                  </button>
                  <button
                    onClick={() => handleClearCache(2)}
                    disabled={clearing}
                    className="p-4 bg-dark-700 hover:bg-dark-600 rounded-xl transition-all text-center disabled:opacity-50 group"
                  >
                    <div className="text-2xl mb-1 group-hover:scale-110 transition-transform">📂</div>
                    <div className="text-sm font-semibold text-white">Level 2</div>
                    <div className="text-xs text-dark-400 mt-1">Dentries + Inodes</div>
                  </button>
                  <button
                    onClick={() => handleClearCache(3)}
                    disabled={clearing}
                    className="p-4 bg-gradient-to-b from-red-500/20 to-dark-700 hover:from-red-500/30 border border-red-500/20 rounded-xl transition-all text-center disabled:opacity-50 group"
                  >
                    <div className="text-2xl mb-1 group-hover:scale-110 transition-transform">💥</div>
                    <div className="text-sm font-bold text-white">Level 3</div>
                    <div className="text-xs text-dark-400 mt-1">All (aggressive)</div>
                  </button>
                </div>
                <div className="mt-4 p-3 bg-dark-800 rounded-lg text-xs text-dark-400">
                  <strong className="text-dark-300">Auto-clear:</strong>{" "}
                  {config.autoCleanEnabled ? (
                    <span className="text-green-400">Enabled</span>
                  ) : (
                    <span className="text-red-400">Disabled</span>
                  )}{" "}
                  — triggers at {config.buffCacheThresholdPercent}% buff/cache or {config.ramUsedThresholdPercent}% RAM
                </div>
              </div>

              {/* System Info */}
              <div className="glass-card rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-4">🖥️ System Info</h3>
                <div className="space-y-3">
                  {[
                    { label: "Hostname", value: snapshot.hostname },
                    { label: "Kernel", value: snapshot.kernel },
                    { label: "Uptime", value: snapshot.uptime },
                    { label: "CPU Cores", value: String(cpu.cores) },
                    { label: "Load Avg", value: `${cpu.loadAvg1} / ${cpu.loadAvg5} / ${cpu.loadAvg15}` },
                    { label: "Disk", value: `${disk.usedGb} / ${disk.totalGb} GB (${disk.mountpoint})` },
                  ].map((item, i) => (
                    <div key={i} className="flex justify-between py-2 border-b border-dark-700 last:border-0">
                      <span className="text-dark-300 text-sm">{item.label}</span>
                      <span className="text-white text-sm font-mono">{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Network Stack */}
                <div className="mt-4 pt-4 border-t border-dark-700">
                  <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    🔗 Network Stack
                    {snapshot.network.dualStack && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/20 text-green-400">DUAL-STACK</span>
                    )}
                  </h4>
                  <div className="space-y-2">
                    {snapshot.network.ipv4Addresses.map((ip, i) => (
                      <div key={`v4-${i}`} className="flex items-center gap-2 text-sm">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400">v4</span>
                        <code className="text-white font-mono">{ip}</code>
                      </div>
                    ))}
                    {snapshot.network.ipv6Addresses.length > 0 ? (
                      snapshot.network.ipv6Addresses.map((ip, i) => (
                        <div key={`v6-${i}`} className="flex items-center gap-2 text-sm">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-500/20 text-accent-400">v6</span>
                          <code className="text-accent-400 font-mono truncate" title={ip}>{ip}</code>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-dark-500/20 text-dark-400">v6</span>
                        <span className="text-dark-400 italic">Not available</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* History Sparkline */}
          {data.history.length > 1 && (
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-4">📈 RAM Usage Over Time</h3>
              <div className="h-40 flex items-end gap-px">
                {data.history.map((point, i) => {
                  const total = data.snapshot.memory.totalMb;
                  const usedPct = total > 0 ? (point.usedRam / total) * 100 : 0;
                  const bufPct = total > 0 ? ((point.buffersRam + point.cachedRam) / total) * 100 : 0;
                  const barColor = usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-orange-500" : "bg-brand-500";
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end gap-px" title={`Used: ${point.usedRam}MB | Buff: ${point.buffersRam + point.cachedRam}MB`}>
                      <div className={`${barColor} rounded-t-sm transition-all duration-300 min-h-[1px]`} style={{ height: `${Math.max(1, usedPct - bufPct)}%` }} />
                      <div className="bg-yellow-500/70 rounded-t-sm transition-all duration-300 min-h-[1px]" style={{ height: `${Math.max(1, bufPct)}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-dark-400 mt-2">
                <span>{data.history.length > 0 ? new Date(data.history[0].createdAt).toLocaleTimeString() : ""}</span>
                <div className="flex gap-4">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-brand-500 inline-block" /> Active</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500 inline-block" /> Buff/Cache</span>
                </div>
                <span>Now</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ HISTORY TAB ═══ */}
      {activeTab === "history" && (
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Cache Clear Event Log</h3>
          {events.length === 0 ? (
            <div className="text-center py-12 text-dark-300">
              <div className="text-4xl mb-3">📜</div>
              <p>No cache clear events recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-600">
                    <th className="text-left px-4 py-3 text-dark-400 font-medium">Time</th>
                    <th className="text-left px-4 py-3 text-dark-400 font-medium">Trigger</th>
                    <th className="text-left px-4 py-3 text-dark-400 font-medium">Level</th>
                    <th className="text-right px-4 py-3 text-dark-400 font-medium">Before (Buff)</th>
                    <th className="text-right px-4 py-3 text-dark-400 font-medium">After (Buff)</th>
                    <th className="text-right px-4 py-3 text-dark-400 font-medium">Freed</th>
                    <th className="text-center px-4 py-3 text-dark-400 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-dark-700 hover:bg-dark-700/50 transition-colors">
                      <td className="px-4 py-3 text-dark-300 whitespace-nowrap">{new Date(ev.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ev.trigger === "auto" ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400"
                        }`}>
                          {ev.trigger}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white font-mono">{ev.clearLevel}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatMb(ev.buffersBeforeMb + ev.cachedBeforeMb)}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{ev.buffersAfterMb != null && ev.cachedAfterMb != null ? formatMb(ev.buffersAfterMb + ev.cachedAfterMb) : "—"}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-400">
                        {ev.freedMb != null ? `${ev.freedMb} MB` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ev.status === "success" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                        }`}>
                          {ev.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {activeTab === "settings" && (
        <div className="max-w-2xl">
          <div className="glass-card rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-6">Auto-Clear Configuration</h3>

            <div className="space-y-6">
              {/* Toggle */}
              <div className="flex items-center justify-between p-4 bg-dark-700/50 rounded-xl">
                <div>
                  <div className="font-semibold text-white">Auto-Clear Enabled</div>
                  <div className="text-xs text-dark-400 mt-1">Automatically clear buffers when thresholds are exceeded</div>
                </div>
                <button
                  onClick={() => setConfigForm(f => ({ ...f, autoCleanEnabled: !f.autoCleanEnabled }))}
                  className={`w-14 h-7 rounded-full transition-all relative ${
                    configForm.autoCleanEnabled ? "bg-green-500" : "bg-dark-500"
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all ${
                    configForm.autoCleanEnabled ? "left-8" : "left-1"
                  }`} />
                </button>
              </div>

              {/* Thresholds */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Buffer/Cache Threshold: <span className="text-brand-400 font-bold">{configForm.buffCacheThresholdPercent}%</span>
                </label>
                <input
                  type="range"
                  min={10}
                  max={99}
                  value={configForm.buffCacheThresholdPercent}
                  onChange={e => setConfigForm(f => ({ ...f, buffCacheThresholdPercent: parseInt(e.target.value, 10) }))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-dark-400 mt-1">
                  <span>10%</span>
                  <span>Clear buffers when buff/cache exceeds this</span>
                  <span>99%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  RAM Used Threshold: <span className="text-brand-400 font-bold">{configForm.ramUsedThresholdPercent}%</span>
                </label>
                <input
                  type="range"
                  min={10}
                  max={99}
                  value={configForm.ramUsedThresholdPercent}
                  onChange={e => setConfigForm(f => ({ ...f, ramUsedThresholdPercent: parseInt(e.target.value, 10) }))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-dark-400 mt-1">
                  <span>10%</span>
                  <span>Clear when total RAM usage exceeds this</span>
                  <span>99%</span>
                </div>
              </div>

              {/* Clear Level */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">Clear Level</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { level: 1, label: "Page Cache", desc: "Safest option" },
                    { level: 2, label: "Dentries + Inodes", desc: "Moderate" },
                    { level: 3, label: "All", desc: "Most aggressive" },
                  ].map(opt => (
                    <button
                      key={opt.level}
                      onClick={() => setConfigForm(f => ({ ...f, clearLevel: opt.level }))}
                      className={`p-3 rounded-xl text-center transition-all ${
                        configForm.clearLevel === opt.level
                          ? "bg-brand-500/20 border-2 border-brand-500 text-brand-400"
                          : "bg-dark-700 border-2 border-transparent text-dark-300 hover:border-dark-400"
                      }`}
                    >
                      <div className="font-bold text-sm">Level {opt.level}</div>
                      <div className="text-xs mt-1">{opt.label}</div>
                      <div className="text-xs text-dark-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Interval */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Check Interval (seconds)</label>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={configForm.checkIntervalSeconds}
                  onChange={e => setConfigForm(f => ({ ...f, checkIntervalSeconds: parseInt(e.target.value, 10) || 60 }))}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              {/* History Retention */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Keep History (hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={configForm.keepHistoryHours}
                  onChange={e => setConfigForm(f => ({ ...f, keepHistoryHours: parseInt(e.target.value, 10) || 24 }))}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <button
              onClick={handleSaveConfig}
              disabled={configSaving}
              className="mt-6 w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {configSaving ? "Saving..." : "💾 Save Configuration"}
            </button>
          </div>

          {/* Cron Setup Guide */}
          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">⏰ Cron Job Setup</h3>
            <p className="text-dark-300 text-sm mb-4">
              Add this cron job to automatically check RAM and clear buffers on a schedule.
              The auto-check endpoint will respect your threshold settings above.
            </p>
            <div className="bg-dark-900 rounded-xl p-4 font-mono text-sm overflow-x-auto">
              <div className="text-dark-400"># Run every minute — checks thresholds and auto-clears if needed</div>
              <div className="text-accent-400">* * * * * curl -s http://localhost:3000/api/monitor/auto-check &gt; /dev/null 2&gt;&amp;1</div>
              <div className="text-dark-400 mt-3"># With optional secret for security</div>
              <div className="text-accent-400">* * * * * curl -s &quot;http://localhost:3000/api/monitor/auto-check?secret=YOUR_SECRET&quot; &gt; /dev/null</div>
            </div>
            <p className="text-dark-400 text-xs mt-3">
              Set <code className="text-accent-400">MONITOR_SECRET</code> in your .env to secure the endpoint.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
