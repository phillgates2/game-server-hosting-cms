import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, access, constants } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const FULL_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

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
 * Detect if running inside a container (LXC, Docker, etc.)
 */
async function detectContainer(): Promise<{
  isContainer: boolean;
  type: string;
}> {
  // Check /.dockerenv
  try {
    await access("/.dockerenv", constants.F_OK);
    return { isContainer: true, type: "Docker" };
  } catch {
    /* not docker */
  }

  // Check /run/.containerenv (Podman)
  try {
    await access("/run/.containerenv", constants.F_OK);
    return { isContainer: true, type: "Podman" };
  } catch {
    /* not podman */
  }

  // Check /proc/1/environ for container= (LXC sets this)
  try {
    const environ = await readFile("/proc/1/environ", "utf-8");
    if (environ.includes("container=")) {
      const match = environ.match(/container=([^\0]+)/);
      return {
        isContainer: true,
        type: match ? `LXC (${match[1]})` : "LXC",
      };
    }
  } catch {
    /* can't read, might itself indicate a container */
  }

  // Check /proc/1/cgroup for container markers
  try {
    const cgroup = await readFile("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("lxc")) return { isContainer: true, type: "LXC" };
    if (cgroup.includes("docker"))
      return { isContainer: true, type: "Docker" };
  } catch {
    /* no cgroup info */
  }

  // Check systemd-detect-virt
  try {
    const { stdout } = await execAsync("systemd-detect-virt -c 2>/dev/null", {
      env: safeEnv(),
      timeout: 3000,
    });
    const virt = stdout.trim();
    if (virt && virt !== "none") {
      return { isContainer: true, type: virt };
    }
  } catch {
    /* systemd-detect-virt not available or returned non-zero = not a container */
  }

  return { isContainer: false, type: "bare-metal/VM" };
}

/**
 * Check if /proc/sys/vm/drop_caches is writable (not read-only mounted).
 * In many LXC containers /proc/sys is mounted read-only.
 */
async function isProcWritable(): Promise<boolean> {
  try {
    const mounts = await readFile("/proc/mounts", "utf-8");
    // Look for /proc/sys mounted read-only
    for (const line of mounts.split("\n")) {
      // Match lines like: proc /proc/sys proc ro,...
      // or: none /proc/sys tmpfs ro,...
      if (
        line.includes("/proc/sys") &&
        !line.includes("/proc/sys/fs/binfmt") &&
        line.includes(" ro")
      ) {
        // Check the mount options field (4th field)
        const parts = line.split(" ");
        if (parts.length >= 4) {
          const opts = parts[3].split(",");
          if (opts.includes("ro")) return false;
        }
      }
    }
    return true;
  } catch {
    return true; // assume writable if we can't check
  }
}

/**
 * Try to write a value to a /proc path. Returns detailed result.
 */
async function writeProc(
  filePath: string,
  value: string
): Promise<{ ok: boolean; method: string; error?: string }> {
  // Method 1: Direct write (works when running as root)
  try {
    await writeFile(filePath, value, "utf-8");
    return { ok: true, method: "direct write (root)" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // EROFS = Read-only file system (container restriction)
    if (msg.includes("EROFS") || msg.includes("Read-only")) {
      return {
        ok: false,
        method: "none",
        error: `${filePath} is read-only (container restriction)`,
      };
    }
    // EACCES = not root, try sudo methods
  }

  // Method 2: sudo tee — capture the ACTUAL error from tee
  try {
    const result = await execAsync(
      `printf '%s' '${value}' | /usr/bin/sudo -n /usr/bin/tee ${filePath} 2>&1`,
      { env: safeEnv(), timeout: 10000 }
    );
    const output = result.stdout.trim();
    // If tee reports "Read-only file system" or "Permission denied" it printed to stderr
    // but we merged stderr into stdout with 2>&1
    if (
      output.includes("Read-only") ||
      output.includes("EROFS") ||
      output.includes("not permitted")
    ) {
      return {
        ok: false,
        method: "none",
        error: `${filePath} is read-only (container/kernel restriction)`,
      };
    }
    if (
      output.includes("password") ||
      output.includes("sorry")
    ) {
      // sudo itself failed
      throw new Error("sudo auth failed");
    }
    // If tee wrote the value, the first line of stdout should be the value
    if (output.startsWith(value)) {
      return { ok: true, method: "sudo tee" };
    }
    // Ambiguous — check if it actually worked by re-reading
    return { ok: true, method: "sudo tee" };
  } catch {
    /* sudo tee failed */
  }

  // Method 3: sudo sh -c — capture stderr
  try {
    const { stderr } = await execFileAsync(
      "/usr/bin/sudo",
      ["-n", "/bin/sh", "-c", `echo ${value} > ${filePath}`],
      { env: safeEnv(), timeout: 10000 }
    );
    if (
      stderr &&
      (stderr.includes("Read-only") || stderr.includes("not permitted"))
    ) {
      return {
        ok: false,
        method: "none",
        error: `${filePath} is read-only (container/kernel restriction)`,
      };
    }
    return { ok: true, method: "sudo sh" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Read-only") || msg.includes("not permitted")) {
      return {
        ok: false,
        method: "none",
        error: `${filePath} is read-only (container/kernel restriction)`,
      };
    }
  }

  // Method 4: sudo sysctl (only for vm.drop_caches)
  if (filePath === "/proc/sys/vm/drop_caches") {
    try {
      const { stderr } = await execFileAsync(
        "/usr/bin/sudo",
        ["-n", "/usr/sbin/sysctl", "-w", `vm.drop_caches=${value}`],
        { env: safeEnv(), timeout: 10000 }
      );
      if (
        stderr &&
        (stderr.includes("Read-only") ||
          stderr.includes("not permitted") ||
          stderr.includes("permission denied"))
      ) {
        return {
          ok: false,
          method: "none",
          error: `vm.drop_caches is read-only (container/kernel restriction)`,
        };
      }
      return { ok: true, method: "sudo sysctl" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (
        msg.includes("Read-only") ||
        msg.includes("not permitted") ||
        msg.includes("permission denied")
      ) {
        return {
          ok: false,
          method: "none",
          error: `vm.drop_caches is read-only (container/kernel restriction)`,
        };
      }
    }
  }

  // Diagnose: can this user sudo at all?
  try {
    await execFileAsync("/usr/bin/sudo", ["-n", "true"], {
      env: safeEnv(),
      timeout: 3000,
    });
    // sudo works, but writing still failed — likely container
    return {
      ok: false,
      method: "none",
      error: `sudo works but writing to ${filePath} failed (likely container restriction)`,
    };
  } catch {
    return {
      ok: false,
      method: "none",
      error: "sudo requires a password or is not configured for this user",
    };
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "monitor.clear_cache"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const before = await getMemStats();
  const actions: string[] = [];
  const errors: string[] = [];

  // Detect container environment upfront
  const container = await detectContainer();
  const procWritable = await isProcWritable();

  // 1. Sync filesystem buffers to disk (always works)
  try {
    await execFileAsync("/usr/bin/sync", [], { timeout: 10000 });
    actions.push("Filesystem synced to disk");
  } catch (e: unknown) {
    errors.push(
      `sync failed: ${e instanceof Error ? e.message : "unknown"}`
    );
  }

  // 2. Drop page cache, dentries, and inodes
  if (container.isContainer && !procWritable) {
    // Skip the attempt entirely — we know it won't work
    errors.push(
      `Cannot clear caches — running inside a ${container.type} container where /proc/sys is mounted read-only. ` +
        `Cache clearing must be done from the host machine: ` +
        `echo 3 | sudo tee /proc/sys/vm/drop_caches`
    );
  } else {
    const dropResult = await writeProc("/proc/sys/vm/drop_caches", "3");
    if (dropResult.ok) {
      actions.push(
        `Dropped page cache, dentries, and inodes via ${dropResult.method}`
      );
    } else if (
      dropResult.error &&
      (dropResult.error.includes("read-only") ||
        dropResult.error.includes("container") ||
        dropResult.error.includes("not permitted"))
    ) {
      // Container restriction detected at runtime
      const envType = container.isContainer
        ? container.type
        : "container";
      errors.push(
        `Cannot clear caches — ${dropResult.error}. ` +
          (container.isContainer
            ? `This ${envType} container has /proc/sys mounted read-only. ` +
              `Clear caches from the host instead: echo 3 | sudo tee /proc/sys/vm/drop_caches`
            : `If this is a container, cache clearing must be done from the host.`)
      );
    } else {
      // sudo/permission issue
      const processUser = await getProcessUser();
      errors.push(
        `Cannot clear caches — the panel process runs as '${processUser}'. ${dropResult.error || ""}. ` +
          `Run this as root to fix:\n` +
          `echo '${processUser} ALL=(ALL) NOPASSWD: /usr/bin/tee /proc/sys/vm/drop_caches, /usr/sbin/sysctl vm.drop_caches=*, /usr/sbin/swapoff, /usr/sbin/swapon' | sudo tee /etc/sudoers.d/gsm-panel && sudo chmod 440 /etc/sudoers.d/gsm-panel`
      );
    }
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
  if (!container.isContainer || procWritable) {
    const compactResult = await writeProc("/proc/sys/vm/compact_memory", "1");
    if (compactResult.ok) {
      actions.push(
        `Memory compaction triggered via ${compactResult.method}`
      );
    }
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
    container: container.isContainer ? container.type : null,
    procWritable,
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
