import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";

const execAsync = promisify(exec);

async function getMemStats() {
  try {
    const meminfo = await readFile("/proc/meminfo", "utf-8");
    const parse = (key: string): number => {
      const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? Math.round(parseInt(match[1]) / 1024) : 0;
    };
    return {
      totalMb: parse("MemTotal"),
      freeMb: parse("MemFree"),
      availableMb: parse("MemAvailable"),
      buffersMb: parse("Buffers"),
      cachedMb: parse("Cached"),
      slabReclaimableMb: parse("SReclaimable"),
      swapTotalMb: parse("SwapTotal"),
      swapFreeMb: parse("SwapFree"),
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const before = await getMemStats();
  const actions: string[] = [];
  const errors: string[] = [];

  // 1. Sync all filesystem buffers to disk
  try {
    await execAsync("sync");
    actions.push("Filesystem synced to disk");
  } catch (e: unknown) {
    errors.push(`sync failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  // 2. Drop page cache, dentries, and inodes
  // echo 3 > /proc/sys/vm/drop_caches needs root.
  // Using writeFile directly is more reliable than exec with shell redirect.
  try {
    await writeFile("/proc/sys/vm/drop_caches", "3", "utf-8");
    actions.push("Dropped page cache, dentries, and inodes (level 3)");
  } catch {
    // writeFile failed (no root), try exec with sudo
    try {
      await execAsync("echo 3 | sudo tee /proc/sys/vm/drop_caches > /dev/null 2>&1");
      actions.push("Dropped page cache, dentries, and inodes via sudo (level 3)");
    } catch {
      // Try without sudo as last resort
      try {
        await execAsync("sh -c 'echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null");
        actions.push("Dropped caches via sh redirect");
      } catch {
        errors.push("Cannot write to /proc/sys/vm/drop_caches — panel must run as root or have sudo access");
      }
    }
  }

  // 3. Clear swap (swapoff + swapon forces all swap contents back to RAM then clears)
  try {
    const { stdout: swapInfo } = await execAsync("swapon --show --noheadings 2>/dev/null || true");
    if (swapInfo.trim()) {
      await execAsync("sudo swapoff -a && sudo swapon -a 2>/dev/null");
      actions.push("Swap cleared (swapoff + swapon)");
    } else {
      actions.push("No swap configured — skipped");
    }
  } catch {
    // Swap clear is optional
    actions.push("Swap clear skipped (requires sudo)");
  }

  // 4. Compact memory (kernel 4.6+)
  try {
    await writeFile("/proc/sys/vm/compact_memory", "1", "utf-8");
    actions.push("Memory compaction triggered");
  } catch {
    // Optional, requires root
  }

  const after = await getMemStats();

  // Calculate what was actually freed
  let freedMb = 0;
  let freedBuffersMb = 0;
  let freedCachedMb = 0;
  if (before && after) {
    freedMb = after.availableMb - before.availableMb;
    freedBuffersMb = before.buffersMb - after.buffersMb;
    freedCachedMb = before.cachedMb - after.cachedMb;
  }

  const success = errors.length === 0;

  return NextResponse.json({
    ok: success,
    actions,
    errors,
    before: before
      ? {
          freeMb: before.freeMb,
          availableMb: before.availableMb,
          buffersMb: before.buffersMb,
          cachedMb: before.cachedMb,
          slabReclaimableMb: before.slabReclaimableMb,
        }
      : null,
    after: after
      ? {
          freeMb: after.freeMb,
          availableMb: after.availableMb,
          buffersMb: after.buffersMb,
          cachedMb: after.cachedMb,
          slabReclaimableMb: after.slabReclaimableMb,
        }
      : null,
    freedMb: Math.max(freedMb, 0),
    freedBuffersMb: Math.max(freedBuffersMb, 0),
    freedCachedMb: Math.max(freedCachedMb, 0),
    message: success
      ? `Cleared ${Math.max(freedBuffersMb + freedCachedMb, 0)} MB of buffers/cache. ${Math.max(freedMb, 0)} MB more available.`
      : `Partial clear. ${errors.join(". ")}`,
  });
}
