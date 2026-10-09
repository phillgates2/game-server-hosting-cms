import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { readFile } from "node:fs/promises";
import { statfs } from "node:fs/promises";

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

async function getMemoryInfo(): Promise<MemInfo> {
  try {
    const meminfo = await readFile("/proc/meminfo", "utf-8");
    const parse = (key: string): number => {
      const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? parseInt(match[1]) / 1024 : 0;
    };

    const totalMb = parse("MemTotal");
    const freeMb = parse("MemFree");
    const buffersMb = parse("Buffers");
    const cachedMb = parse("Cached");
    const availableMb = parse("MemAvailable");
    const swapTotalMb = parse("SwapTotal");
    const swapFreeMb = parse("SwapFree");
    const usedMb = totalMb - freeMb - buffersMb - cachedMb;

    return {
      totalMb: Math.round(totalMb),
      usedMb: Math.round(usedMb),
      freeMb: Math.round(freeMb),
      buffersMb: Math.round(buffersMb),
      cachedMb: Math.round(cachedMb),
      availableMb: Math.round(availableMb),
      bufferPercent: totalMb > 0 ? Math.round(((buffersMb + cachedMb) / totalMb) * 100) : 0,
      usedPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
      swapTotalMb: Math.round(swapTotalMb),
      swapUsedMb: Math.round(swapTotalMb - swapFreeMb),
    };
  } catch {
    return {
      totalMb: 0, usedMb: 0, freeMb: 0, buffersMb: 0, cachedMb: 0,
      availableMb: 0, bufferPercent: 0, usedPercent: 0, swapTotalMb: 0, swapUsedMb: 0,
    };
  }
}

async function getCpuInfo() {
  try {
    // Read procfs directly: the dashboard polls this every few seconds, and a
    // shell per poll is needless process churn.
    const stdout = await readFile("/proc/loadavg", "utf-8");
    const parts = stdout.trim().split(/\s+/);
    return {
      load1: parseFloat(parts[0]),
      load5: parseFloat(parts[1]),
      load15: parseFloat(parts[2]),
    };
  } catch {
    return { load1: 0, load5: 0, load15: 0 };
  }
}

async function getDiskInfo() {
  try {
    // statfs instead of spawning `df` on every poll. Same figures as `df -m /`:
    // "Use%" is used / (used + available), rounded up like coreutils does.
    const st = await statfs("/");
    const blockMb = st.bsize / (1024 * 1024);
    const totalMb = Math.round(st.blocks * blockMb);
    const availableMb = Math.round(st.bavail * blockMb);
    const usedMb = Math.round((st.blocks - st.bfree) * blockMb);
    const denom = usedMb + availableMb;
    return {
      totalMb,
      usedMb,
      availableMb,
      usedPercent: denom > 0 ? Math.ceil((usedMb * 100) / denom) : 0,
    };
  } catch {
    return { totalMb: 0, usedMb: 0, availableMb: 0, usedPercent: 0 };
  }
}

async function getNetworkInfo() {
  try {
    const content = await readFile("/proc/net/dev", "utf-8");
    const lines = content.split("\n").filter((l) => l.includes(":") && !l.includes("lo:"));
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of lines) {
      const parts = line.split(":")[1]?.trim().split(/\s+/);
      if (parts) {
        rxBytes += parseInt(parts[0]) || 0;
        txBytes += parseInt(parts[8]) || 0;
      }
    }
    return {
      rxMb: Math.round(rxBytes / 1024 / 1024),
      txMb: Math.round(txBytes / 1024 / 1024),
    };
  } catch {
    return { rxMb: 0, txMb: 0 };
  }
}

async function getIpv6Status() {
  try {
    const content = await readFile("/proc/net/if_inet6", "utf-8");
    const addresses = content
      .trim()
      .split("\n")
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { address: parts[0], iface: parts[5] };
      })
      .filter((a) => a.iface !== "lo");
    return { enabled: addresses.length > 0, addresses };
  } catch {
    return { enabled: false, addresses: [] };
  }
}

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "monitor.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const [memory, cpu, disk, network, ipv6] = await Promise.all([
    getMemoryInfo(),
    getCpuInfo(),
    getDiskInfo(),
    getNetworkInfo(),
    getIpv6Status(),
  ]);

  return NextResponse.json({
    memory,
    cpu,
    disk,
    network,
    ipv6,
    timestamp: new Date().toISOString(),
  });
}
