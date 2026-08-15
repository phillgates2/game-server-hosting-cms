import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";

const execAsync = promisify(exec);

// Use absolute paths so child_process.exec works regardless of PATH
const SUDO = "/usr/bin/sudo";
const TEE = "/usr/bin/tee";
const SYSCTL = "/usr/sbin/sysctl";
const SYNC = "/usr/bin/sync";
const SWAPOFF = "/usr/sbin/swapoff";
const SWAPON = "/usr/sbin/swapon";

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

/**
 * Try multiple methods to drop caches, from most to least privileged.
 * Returns { ok, method, error? }.
 */
async function dropCaches(): Promise<{ ok: boolean; method: string; error?: string }> {
  // Method 1: direct write (only works as root)
  try {
    await writeFile("/proc/sys/vm/drop_caches", "3", "utf-8");
    return { ok: true, method: "direct write (root)" };
  } catch { /* not root */ }

  // Method 2: sudo tee (absolute paths, capture stderr)
  try {
    const { stderr } = await execAsync(`echo 3 | ${SUDO} -n ${TEE} /proc/sys/vm/drop_caches`, {
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      timeout: 10000,
    });
    if (stderr && stderr.includes("password")) throw new Error(stderr);
    return { ok: true, method: "sudo tee" };
  } catch (e) {
    // fall through
    void e;
  }

  // Method 3: sudo sh -c (absolute path)
  try {
    await execAsync(`${SUDO} -n /bin/sh -c 'echo 3 > /proc/sys/vm/drop_caches'`, {
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      timeout: 10000,
    });
    return { ok: true, method: "sudo sh" };
  } catch { /* no sudo access */ }

  // Method 4: sysctl
  try {
    await execAsync(`${SUDO} -n ${SYSCTL} -w vm.drop_caches=3`, {
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      timeout: 10000,
    });
    return { ok: true, method: "sudo sysctl" };
  } catch { /* no sudo access */ }

  // All methods failed — find out why
  let diagMsg = "";
  try {
    const { stdout } = await execAsync(`${SUDO} -n true 2>&1 || echo SUDO_FAIL`, {
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      timeout: 5000,
    });
    if (stdout.includes("SUDO_FAIL")) {
      diagMsg = "sudo requires a password for this user";
    }
  } catch {
    diagMsg = "sudo not available";
  }

  return {
    ok: false,
    method: "none",
    error: diagMsg || "All drop_caches methods failed",
  };
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "monitor.clear_cache"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const before = await getMemStats();
  const actions: string[] = [];
  const errors: string[] = [];

  // 1. Sync all filesystem buffers to disk
  try {
    await execAsync(SYNC, { timeout: 10000 });
    actions.push("Filesystem synced to disk");
  } catch (e: unknown) {
    errors.push(`sync failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  // 2. Drop page cache, dentries, and inodes
  const dropResult = await dropCaches();
  if (dropResult.ok) {
    actions.push(`Dropped page cache, dentries, and inodes via ${dropResult.method}`);
  } else {
    const user = process.env.USER || "unknown";
    errors.push(
      `Cannot clear caches (${dropResult.error || "no method succeeded"}). ` +
      `Run this as root to fix:  echo '${user} ALL=(ALL) NOPASSWD: ${TEE} /proc/sys/vm/drop_caches, ${SYSCTL}, ${SWAPOFF}, ${SWAPON}' | sudo tee /etc/sudoers.d/gsm-panel`
    );
  }

  // 3. Clear swap (swapoff + swapon forces all swap contents back to RAM then clears)
  try {
    const { stdout: swapInfo } = await execAsync("swapon --show --noheadings 2>/dev/null || true", {
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      timeout: 5000,
    });
    if (swapInfo.trim()) {
      try {
        await execAsync(`${SUDO} -n ${SWAPOFF} -a && ${SUDO} -n ${SWAPON} -a`, {
          env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
          timeout: 30000,
        });
        actions.push("Swap cleared (swapoff + swapon)");
      } catch {
        actions.push("Swap clear skipped (requires sudo for swapoff/swapon)");
      }
    } else {
      actions.push("No swap configured — skipped");
    }
  } catch {
    actions.push("Swap check skipped");
  }

  // 4. Compact memory (kernel 4.6+)
  try {
    await writeFile("/proc/sys/vm/compact_memory", "1", "utf-8");
    actions.push("Memory compaction triggered");
  } catch {
    try {
      await execAsync(`${SUDO} -n /bin/sh -c 'echo 1 > /proc/sys/vm/compact_memory'`, {
        env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
        timeout: 10000,
      });
      actions.push("Memory compaction triggered via sudo");
    } catch {
      // Optional, not an error
    }
  }

  // Small delay to let the kernel finish freeing
  await new Promise((resolve) => setTimeout(resolve, 500));

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
