import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
    const { stdout } = await execAsync("cat /proc/loadavg");
    const parts = stdout.trim().split(" ");
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
    const { stdout } = await execAsync("df -m / | tail -1");
    const parts = stdout.trim().split(/\s+/);
    return {
      totalMb: parseInt(parts[1]),
      usedMb: parseInt(parts[2]),
      availableMb: parseInt(parts[3]),
      usedPercent: parseInt(parts[4]),
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
