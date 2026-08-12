import { execFile } from "node:child_process";

/**
 * Firewall (UFW) helper — automatically manages port rules when game servers
 * are created, updated, or deleted.
 *
 * All operations are fire-and-forget best-effort. A missing `ufw` binary or
 * insufficient permissions will never crash the panel; the error is silently
 * logged so the admin can notice and adjust manually.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function ufw(args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile("ufw", args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr || stdout || error.message;
        console.warn(`[firewall] ufw ${args.join(" ")} → ${msg.trim()}`);
        resolve({ ok: false, output: msg });
        return;
      }
      resolve({ ok: true, output: (stdout || "").trim() });
    });
  });
}

interface ServerPorts {
  port: number;
  queryPort?: number | null;
  rconPort?: number | null;
}

/** Build the UFW comment string for a server so we can find the rules later. */
function comment(serverName: string, serverId: number): string {
  return `GSM:${serverId} ${serverName}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Allow all ports for a newly created or updated game server.
 * Opens both TCP and UDP for the game port, query port, and RCON port.
 */
export async function allowServerPorts(
  serverId: number,
  serverName: string,
  ports: ServerPorts,
): Promise<void> {
  const label = comment(serverName, serverId);
  const uniquePorts = new Set<number>();

  uniquePorts.add(ports.port);
  if (ports.queryPort && ports.queryPort !== ports.port) {
    uniquePorts.add(ports.queryPort);
  }
  if (ports.rconPort && ports.rconPort !== ports.port && ports.rconPort !== ports.queryPort) {
    uniquePorts.add(ports.rconPort);
  }

  for (const p of uniquePorts) {
    // Allow TCP + UDP for each port
    await ufw(["allow", `${p}/tcp`, "comment", label]);
    await ufw(["allow", `${p}/udp`, "comment", label]);
  }
}

/**
 * Remove firewall rules for a game server that is being deleted.
 * Uses `ufw delete allow` to cleanly remove the rules by port.
 */
export async function denyServerPorts(
  ports: ServerPorts,
): Promise<void> {
  const uniquePorts = new Set<number>();

  uniquePorts.add(ports.port);
  if (ports.queryPort && ports.queryPort !== ports.port) {
    uniquePorts.add(ports.queryPort);
  }
  if (ports.rconPort && ports.rconPort !== ports.port && ports.rconPort !== ports.queryPort) {
    uniquePorts.add(ports.rconPort);
  }

  for (const p of uniquePorts) {
    // Delete both TCP and UDP rules (--force skips the confirmation prompt)
    await ufw(["--force", "delete", "allow", `${p}/tcp`]);
    await ufw(["--force", "delete", "allow", `${p}/udp`]);
  }
}

/**
 * When a server's ports change (via PATCH), remove the old rules and add new ones.
 */
export async function updateServerPorts(
  serverId: number,
  serverName: string,
  oldPorts: ServerPorts,
  newPorts: ServerPorts,
): Promise<void> {
  // Collect ports that were removed or changed
  const oldSet = new Set<number>();
  oldSet.add(oldPorts.port);
  if (oldPorts.queryPort) oldSet.add(oldPorts.queryPort);
  if (oldPorts.rconPort) oldSet.add(oldPorts.rconPort);

  const newSet = new Set<number>();
  newSet.add(newPorts.port);
  if (newPorts.queryPort) newSet.add(newPorts.queryPort);
  if (newPorts.rconPort) newSet.add(newPorts.rconPort);

  // Remove ports that are no longer used
  for (const p of oldSet) {
    if (!newSet.has(p)) {
      await ufw(["--force", "delete", "allow", `${p}/tcp`]);
      await ufw(["--force", "delete", "allow", `${p}/udp`]);
    }
  }

  // Add ports that are new
  const label = comment(serverName, serverId);
  for (const p of newSet) {
    if (!oldSet.has(p)) {
      await ufw(["allow", `${p}/tcp`, "comment", label]);
      await ufw(["allow", `${p}/udp`, "comment", label]);
    }
  }
}

/**
 * List all UFW rules that were added by the panel (contain "GSM:" in the comment).
 * Useful for the admin UI.
 */
export async function listManagedRules(): Promise<string[]> {
  const { ok, output } = await ufw(["status", "verbose"]);
  if (!ok) return [];

  return output
    .split("\n")
    .filter((line) => line.includes("GSM:"))
    .map((line) => line.trim());
}
