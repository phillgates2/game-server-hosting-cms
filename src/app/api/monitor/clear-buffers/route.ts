import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const FULL_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** Build an env object that keeps process.env intact but forces a broad PATH. */
function safeEnv() {
  return { ...process.env, PATH: FULL_PATH };
}

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

/** Detect the actual OS username running this Node.js process. */
async function getProcessUser(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/id", ["-un"], {
      timeout: 3000,
    });
    return stdout.trim();
  } catch {
    return process.env.USER || process.env.LOGNAME || "unknown";
  }
}

/**
 * Try to write a value to a /proc or /sys file using escalating methods.
 */
async function writeProc(
  filePath: string,
  value: string
): Promise<{ ok: boolean; method: string }> {
  // Method 1: Direct write (works when running as root)
  try {
    await writeFile(filePath, value, "utf-8");
    return { ok: true, method: "direct write (root)" };
  } catch {
    /* not root */
  }

  // Method 2: sudo tee
  try {
    const { stdout, stderr } = await execAsync(
      `printf '%s' '${value}' | /usr/bin/sudo -n /usr/bin/tee ${filePath}`,
      { env: safeEnv(), timeout: 10000 }
    );
    if (
      stderr &&
      (stderr.includes("password") || stderr.includes("sorry"))
    ) {
      throw new Error(stderr);
    }
    if (stdout.trim() === value) {
      return { ok: true, method: "sudo tee" };
    }
    return { ok: true, method: "sudo tee" };
  } catch {
    /* no sudo tee access */
  }

  // Method 3: sudo sh -c
  try {
    await execFileAsync(
      "/usr/bin/sudo",
      ["-n", "/bin/sh", "-c", `echo ${value} > ${filePath}`],
      { env: safeEnv(), timeout: 10000 }
    );
    return { ok: true, method: "sudo sh" };
  } catch {
    /* no sudo sh access */
  }

  // Method 4: sudo sysctl (only for vm.drop_caches)
  if (filePath === "/proc/sys/vm/drop_caches") {
    try {
      await execFileAsync(
        "/usr/bin/sudo",
        ["-n", "/usr/sbin/sysctl", "-w", `vm.drop_caches=${value}`],
        { env: safeEnv(), timeout: 10000 }
      );
      return { ok: true, method: "sudo sysctl" };
    } catch {
      /* no sysctl access */
    }
  }

  return { ok: false, method: "none" };
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
    await execFileAsync("/usr/bin/sync", [], { timeout: 10000 });
    actions.push("Filesystem synced to disk");
  } catch (e: unknown) {
    errors.push(
      `sync failed: ${e instanceof Error ? e.message : "unknown"}`
    );
  }

  // 2. Drop page cache, dentries, and inodes
  const dropResult = await writeProc("/proc/sys/vm/drop_caches", "3");
  if (dropResult.ok) {
    actions.push(
      `Dropped page cache, dentries, and inodes via ${dropResult.method}`
    );
  } else {
    const processUser = await getProcessUser();
    errors.push(
      `Cannot clear caches — the panel process runs as OS user '${processUser}'. ` +
        `Run this as root to fix:\n` +
        `echo '${processUser} ALL=(ALL) NOPASSWD: /usr/bin/tee /proc/sys/vm/drop_caches, /usr/sbin/sysctl vm.drop_caches=*, /usr/sbin/swapoff, /usr/sbin/swapon' | sudo tee /etc/sudoers.d/gsm-panel && sudo chmod 440 /etc/sudoers.d/gsm-panel`
    );
  }

  // 3. Clear swap
  try {
    const { stdout: swapInfo } = await execAsync(
      "swapon --show --noheadings 2>/dev/null || true",
      { env: safeEnv(), timeout: 5000 }
    );
    if (swapInfo.trim()) {
      try {
        await execFileAsync(
          "/usr/bin/sudo",
          ["-n", "/usr/sbin/swapoff", "-a"],
          { env: safeEnv(), timeout: 30000 }
        );
        await execFileAsync(
          "/usr/bin/sudo",
          ["-n", "/usr/sbin/swapon", "-a"],
          { env: safeEnv(), timeout: 30000 }
        );
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

  // 4. Compact memory (kernel 4.6+) — optional
  const compactResult = await writeProc("/proc/sys/vm/compact_memory", "1");
  if (compactResult.ok) {
    actions.push(`Memory compaction triggered via ${compactResult.method}`);
  }

  // Small delay to let the kernel finish freeing pages
  await new Promise((resolve) => setTimeout(resolve, 500));

  const after = await getMemStats();

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
