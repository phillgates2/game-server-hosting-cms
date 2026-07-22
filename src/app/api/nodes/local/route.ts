import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { readFile, mkdir, access, constants } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { hostname, homedir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

// POST /api/nodes/local - Create local node (this server)
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    // Check if local node already exists
    const existing = await db.select().from(nodes).where(eq(nodes.isLocal, true)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: "Local node already exists" }, { status: 409 });
    }

    // Get system info
    const systemHostname = hostname();
    let ipv4 = "127.0.0.1";
    let ipv6 = "::1";
    let totalRam = 16384;
    let totalDisk = 100000;

    // Choose a sensible writable default install path.
    // If the panel runs as root, keep /opt/gameservers.
    // Otherwise prefer ~/gameservers so installs work out of the box.
    const homePath = homedir();
    const isRootUser = process.getuid?.() === 0;
    const preferredGameServerPath = isRootUser
      ? "/opt/gameservers"
      : join(homePath || "/home", "gameservers");
    try {
      // Get primary IPv4
      const { stdout: ipOut } = await execAsync("hostname -I | awk '{print $1}'");
      ipv4 = ipOut.trim() || "127.0.0.1";

      // Get IPv6
      try {
        const if6 = await readFile("/proc/net/if_inet6", "utf-8");
        const lines = if6.trim().split("\n").filter((l) => !l.includes("lo"));
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          if (parts[0]) {
            ipv6 = parts[0].match(/.{1,4}/g)?.join(":") || "::1";
          }
        }
      } catch {
        // IPv6 not available
      }

      // Get total RAM
      const meminfo = await readFile("/proc/meminfo", "utf-8");
      const memMatch = meminfo.match(/MemTotal:\s+(\d+)/);
      if (memMatch) {
        totalRam = Math.round(parseInt(memMatch[1]) / 1024);
      }

      // Get total disk
      const { stdout: dfOut } = await execAsync("df -m / | tail -1 | awk '{print $2}'");
      totalDisk = parseInt(dfOut.trim()) || 100000;
    } catch {
      // Use defaults
    }

    // Ensure the local game server path exists and is writable if possible.
    let finalGameServerPath = preferredGameServerPath;
    try {
      await mkdir(preferredGameServerPath, { recursive: true });
      await access(preferredGameServerPath, constants.W_OK);
    } catch {
      // Fall back to /tmp if home/opt path is not writable for some reason.
      finalGameServerPath = "/tmp/gameservers";
      try {
        await mkdir(finalGameServerPath, { recursive: true });
      } catch {
        // ignore; the install route will return a clear error later if needed
      }
    }

    const [node] = await db
      .insert(nodes)
      .values({
        name: "Local Server",
        description: "This server (automatically created)",
        hostname: systemHostname,
        ipv4,
        ipv6,
        sshPort: 22,
        sshUser: "root",
        isLocal: true,
        isDefault: true,
        status: "online",
        maxRamMb: totalRam,
        maxDiskMb: totalDisk,
        gameServerPath: finalGameServerPath,
        steamcmdPath: "/opt/steamcmd",
        location: "Local",
        provider: isRootUser ? "Self-hosted (root)" : "Self-hosted (user)",
        lastHeartbeat: new Date(),
      })
      .returning();

    return NextResponse.json({ node }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
