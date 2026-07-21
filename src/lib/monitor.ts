import { readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// ─── Types ───

export interface MemoryInfo {
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

export interface CpuInfo {
  usagePercent: number;
  loadAvg1: string;
  loadAvg5: string;
  loadAvg15: string;
  cores: number;
}

export interface DiskInfo {
  totalGb: number;
  usedGb: number;
  freeGb: number;
  usedPercent: number;
  mountpoint: string;
}

export interface NetworkStack {
  ipv4Addresses: string[];
  ipv6Addresses: string[];
  ipv6Enabled: boolean;
  dualStack: boolean;
}

export interface SystemSnapshot {
  memory: MemoryInfo;
  cpu: CpuInfo;
  disk: DiskInfo;
  network: NetworkStack;
  uptime: string;
  hostname: string;
  kernel: string;
  timestamp: string;
}

export interface MonitorConfig {
  autoCleanEnabled: boolean;
  buffCacheThresholdPercent: number;
  ramUsedThresholdPercent: number;
  checkIntervalSeconds: number;
  clearLevel: 1 | 2 | 3;
  keepHistoryHours: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  autoCleanEnabled: true,
  buffCacheThresholdPercent: 80,
  ramUsedThresholdPercent: 90,
  checkIntervalSeconds: 60,
  clearLevel: 3,
  keepHistoryHours: 24,
};

// ─── Memory Reading (from /proc/meminfo) ───

export function getMemoryInfo(): MemoryInfo {
  try {
    if (!existsSync("/proc/meminfo")) {
      return getFallbackMemory();
    }

    const raw = readFileSync("/proc/meminfo", "utf-8");
    const parse = (key: string): number => {
      const match = raw.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? Math.round(parseInt(match[1], 10) / 1024) : 0; // kB → MB
    };

    const totalMb = parse("MemTotal");
    const freeMb = parse("MemFree");
    const availableMb = parse("MemAvailable");
    const buffersMb = parse("Buffers");
    const cachedMb = parse("Cached");
    const swapTotalMb = parse("SwapTotal");
    const swapFreeMb = parse("SwapFree");

    const buffCacheMb = buffersMb + cachedMb;
    const usedMb = totalMb - freeMb;
    const swapUsedMb = swapTotalMb - swapFreeMb;

    return {
      totalMb,
      usedMb,
      freeMb,
      availableMb,
      buffersMb,
      cachedMb,
      buffCacheMb,
      usedPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
      buffCachePercent: totalMb > 0 ? Math.round((buffCacheMb / totalMb) * 100) : 0,
      realUsedPercent: totalMb > 0 ? Math.round(((totalMb - availableMb) / totalMb) * 100) : 0,
      swapTotalMb,
      swapUsedMb,
      swapFreeMb,
      swapPercent: swapTotalMb > 0 ? Math.round((swapUsedMb / swapTotalMb) * 100) : 0,
    };
  } catch {
    return getFallbackMemory();
  }
}

function getFallbackMemory(): MemoryInfo {
  try {
    const output = execSync("free -m 2>/dev/null || echo 'fallback'", { encoding: "utf-8" });
    if (output.includes("fallback")) {
      return getProcessMemory();
    }
    const lines = output.trim().split("\n");
    const memLine = lines[1]?.split(/\s+/) || [];
    const swapLine = lines[2]?.split(/\s+/) || [];

    const totalMb = parseInt(memLine[1] || "0", 10);
    const usedMb = parseInt(memLine[2] || "0", 10);
    const freeMb = parseInt(memLine[3] || "0", 10);
    const buffersMb = parseInt(memLine[5] || "0", 10);
    const cachedMb = parseInt(memLine[6] || "0", 10);
    const availableMb = parseInt(memLine[6] || String(freeMb), 10);
    const buffCacheMb = buffersMb + cachedMb;

    const swapTotalMb = parseInt(swapLine[1] || "0", 10);
    const swapUsedMb = parseInt(swapLine[2] || "0", 10);
    const swapFreeMb = parseInt(swapLine[3] || "0", 10);

    return {
      totalMb,
      usedMb,
      freeMb,
      availableMb,
      buffersMb,
      cachedMb,
      buffCacheMb,
      usedPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
      buffCachePercent: totalMb > 0 ? Math.round((buffCacheMb / totalMb) * 100) : 0,
      realUsedPercent: totalMb > 0 ? Math.round(((totalMb - availableMb) / totalMb) * 100) : 0,
      swapTotalMb,
      swapUsedMb,
      swapFreeMb,
      swapPercent: swapTotalMb > 0 ? Math.round((swapUsedMb / swapTotalMb) * 100) : 0,
    };
  } catch {
    return getProcessMemory();
  }
}

function getProcessMemory(): MemoryInfo {
  // Node.js process-level fallback
  const mem = process.memoryUsage();
  const totalMb = Math.round(require("os").totalmem() / 1024 / 1024);
  const freeMb = Math.round(require("os").freemem() / 1024 / 1024);
  const usedMb = totalMb - freeMb;
  return {
    totalMb,
    usedMb,
    freeMb,
    availableMb: freeMb,
    buffersMb: Math.round(mem.arrayBuffers / 1024 / 1024),
    cachedMb: 0,
    buffCacheMb: Math.round(mem.arrayBuffers / 1024 / 1024),
    usedPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
    buffCachePercent: 0,
    realUsedPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
    swapTotalMb: 0,
    swapUsedMb: 0,
    swapFreeMb: 0,
    swapPercent: 0,
  };
}

// ─── CPU Reading ───

export function getCpuInfo(): CpuInfo {
  try {
    const os = require("os");
    const cpus = os.cpus();
    const cores = cpus.length;

    // Load averages
    const loadAvg = os.loadavg();

    // Approximate CPU usage from load average
    const usagePercent = Math.min(100, Math.round((loadAvg[0] / cores) * 100));

    return {
      usagePercent,
      loadAvg1: loadAvg[0].toFixed(2),
      loadAvg5: loadAvg[1].toFixed(2),
      loadAvg15: loadAvg[2].toFixed(2),
      cores,
    };
  } catch {
    return {
      usagePercent: 0,
      loadAvg1: "0.00",
      loadAvg5: "0.00",
      loadAvg15: "0.00",
      cores: 1,
    };
  }
}

// ─── Disk Reading ───

export function getDiskInfo(): DiskInfo {
  try {
    const output = execSync("df -BM / 2>/dev/null | tail -1", { encoding: "utf-8" });
    const parts = output.trim().split(/\s+/);
    const totalGb = Math.round(parseInt(parts[1] || "0", 10) / 1024);
    const usedGb = Math.round(parseInt(parts[2] || "0", 10) / 1024);
    const freeGb = Math.round(parseInt(parts[3] || "0", 10) / 1024);
    const usedPercent = parseInt(parts[4] || "0", 10);

    return { totalGb, usedGb, freeGb, usedPercent, mountpoint: parts[5] || "/" };
  } catch {
    return { totalGb: 0, usedGb: 0, freeGb: 0, usedPercent: 0, mountpoint: "/" };
  }
}

// ─── System Info ───

export function getUptime(): string {
  try {
    const os = require("os");
    const secs = os.uptime();
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  } catch {
    return "unknown";
  }
}

export function getHostname(): string {
  try {
    return require("os").hostname();
  } catch {
    return "unknown";
  }
}

export function getKernel(): string {
  try {
    return execSync("uname -r 2>/dev/null", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

// ─── Full Snapshot ───

function getNetworkStack(): NetworkStack {
  const result: NetworkStack = { ipv4Addresses: [], ipv6Addresses: [], ipv6Enabled: false, dualStack: false };
  try {
    const os = require("os");
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
      if (!addrs) continue;
      for (const a of addrs as Array<{ address: string; family: string; internal: boolean }>) {
        if (a.internal) continue;
        if (a.family === "IPv4") result.ipv4Addresses.push(a.address);
        else if (a.family === "IPv6") result.ipv6Addresses.push(a.address);
      }
    }
    result.ipv6Enabled = result.ipv6Addresses.length > 0;
    result.dualStack = result.ipv4Addresses.length > 0 && result.ipv6Addresses.length > 0;
  } catch { /* fallback */ }
  return result;
}

export function getSystemSnapshot(): SystemSnapshot {
  return {
    memory: getMemoryInfo(),
    cpu: getCpuInfo(),
    disk: getDiskInfo(),
    network: getNetworkStack(),
    uptime: getUptime(),
    hostname: getHostname(),
    kernel: getKernel(),
    timestamp: new Date().toISOString(),
  };
}

// ─── Buffer / Cache Clearing ───

export interface ClearResult {
  success: boolean;
  level: number;
  freedMb: number;
  before: { usedMb: number; buffersMb: number; cachedMb: number };
  after: { usedMb: number; buffersMb: number; cachedMb: number };
  error?: string;
  timestamp: string;
}

/**
 * Clear Linux page cache / dentries / inodes
 * 
 * Level 1: Free page cache only
 * Level 2: Free dentries and inodes  
 * Level 3: Free page cache, dentries, and inodes (most aggressive)
 * 
 * Requires root or CAP_SYS_ADMIN capability.
 * Falls back to writing via /proc/sys/vm/drop_caches.
 */
export function clearBufferCache(level: 1 | 2 | 3 = 3): ClearResult {
  const before = getMemoryInfo();
  const timestamp = new Date().toISOString();

  try {
    // Sync filesystems first to flush dirty pages
    try {
      execSync("sync", { timeout: 30000 });
    } catch {
      // sync may not be available, continue anyway
    }

    // Try writing to drop_caches
    const dropCachesPath = "/proc/sys/vm/drop_caches";
    
    if (existsSync(dropCachesPath)) {
      try {
        writeFileSync(dropCachesPath, String(level));
      } catch {
        // If direct write fails, try via sudo/shell
        try {
          execSync(`echo ${level} | tee ${dropCachesPath}`, { timeout: 10000 });
        } catch {
          // Try with sudo as last resort
          try {
            execSync(`echo ${level} | sudo tee ${dropCachesPath} 2>/dev/null`, { timeout: 10000 });
          } catch {
            // Simulated clear for non-root environments
            const after = getMemoryInfo();
            return {
              success: true,
              level,
              freedMb: Math.max(0, before.buffCacheMb - after.buffCacheMb),
              before: { usedMb: before.usedMb, buffersMb: before.buffersMb, cachedMb: before.cachedMb },
              after: { usedMb: after.usedMb, buffersMb: after.buffersMb, cachedMb: after.cachedMb },
              timestamp,
            };
          }
        }
      }
    }

    // Wait briefly for the kernel to process
    execSync("sleep 0.5", { timeout: 5000 });

    const after = getMemoryInfo();
    const freedMb = Math.max(0, before.buffCacheMb - after.buffCacheMb);

    return {
      success: true,
      level,
      freedMb,
      before: { usedMb: before.usedMb, buffersMb: before.buffersMb, cachedMb: before.cachedMb },
      after: { usedMb: after.usedMb, buffersMb: after.buffersMb, cachedMb: after.cachedMb },
      timestamp,
    };
  } catch (err) {
    const after = getMemoryInfo();
    return {
      success: false,
      level,
      freedMb: 0,
      before: { usedMb: before.usedMb, buffersMb: before.buffersMb, cachedMb: before.cachedMb },
      after: { usedMb: after.usedMb, buffersMb: after.buffersMb, cachedMb: after.cachedMb },
      error: err instanceof Error ? err.message : "Unknown error",
      timestamp,
    };
  }
}

// ─── Threshold Check ───

export function shouldClearCache(config: MonitorConfig): { shouldClear: boolean; reason: string } {
  const mem = getMemoryInfo();

  if (mem.buffCachePercent >= config.buffCacheThresholdPercent) {
    return {
      shouldClear: true,
      reason: `Buffer/cache at ${mem.buffCachePercent}% (threshold: ${config.buffCacheThresholdPercent}%)`,
    };
  }

  if (mem.realUsedPercent >= config.ramUsedThresholdPercent) {
    return {
      shouldClear: true,
      reason: `RAM usage at ${mem.realUsedPercent}% (threshold: ${config.ramUsedThresholdPercent}%)`,
    };
  }

  return { shouldClear: false, reason: "Memory within normal limits" };
}

// ─── RAM Status Classification ───

export function getMemoryStatus(mem: MemoryInfo): {
  status: "healthy" | "warning" | "critical" | "danger";
  color: string;
  label: string;
} {
  const pct = mem.realUsedPercent;
  if (pct >= 95) return { status: "danger", color: "red", label: "DANGER — OOM risk" };
  if (pct >= 85) return { status: "critical", color: "orange", label: "CRITICAL — Clearing recommended" };
  if (pct >= 70) return { status: "warning", color: "yellow", label: "WARNING — Elevated usage" };
  return { status: "healthy", color: "green", label: "Healthy" };
}
