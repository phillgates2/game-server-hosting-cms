import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function replaceTemplateVariables(input: string, variables: Record<string, unknown>) {
  return input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function buildVariables(server: {
  name: string;
  installPath: string;
  port: number;
  queryPort: number | null;
  rconPort: number | null;
  variables: unknown;
  config: unknown;
}) {
  const storedVariables = asRecord(server.variables);
  const config = asRecord(server.config);

  return {
    ...config,
    ...storedVariables,
    SERVER_NAME: storedVariables.SERVER_NAME ?? server.name,
    INSTALL_PATH: storedVariables.INSTALL_PATH ?? server.installPath,
    PORT: storedVariables.PORT ?? server.port,
    QUERY_PORT: storedVariables.QUERY_PORT ?? server.queryPort ?? server.port + 1,
    RCON_PORT: storedVariables.RCON_PORT ?? server.rconPort ?? server.port + 2,
    MAX_PLAYERS: storedVariables.MAX_PLAYERS ?? config.MAX_PLAYERS ?? 32,
    MAX_RAM: storedVariables.MAX_RAM ?? config.MAX_RAM ?? 4,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        name: gameServers.name,
        installPath: gameServers.installPath,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        rconPort: gameServers.rconPort,
        variables: gameServers.variables,
        config: gameServers.config,
        nodeId: gameServers.nodeId,
        gameName: gameDefinitions.name,
        installScript: gameDefinitions.installScript,
        nodeName: nodes.name,
        nodeIsLocal: nodes.isLocal,
        nodeApiUrl: nodes.apiUrl,
        nodeApiKey: nodes.apiKey,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!server.installScript) {
      return NextResponse.json({ error: "This game has no install script" }, { status: 400 });
    }

    await db
      .update(gameServers)
      .set({ status: "installing", updatedAt: new Date() })
      .where(eq(gameServers.id, server.id));

    // Remote node
    if (!server.nodeIsLocal) {
      if (server.nodeApiUrl) {
        try {
          const res = await fetch(`${server.nodeApiUrl.replace(/\/$/, "")}/install`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(server.nodeApiKey ? { "X-API-Key": server.nodeApiKey } : {}),
            },
            body: JSON.stringify({ serverId: server.id }),
          });

          if (!res.ok) {
            const text = await res.text();
            await db.update(gameServers).set({ status: "install_failed", updatedAt: new Date() }).where(eq(gameServers.id, server.id));
            return NextResponse.json({ error: `Remote node install failed: ${text}` }, { status: 502 });
          }

          return NextResponse.json({ ok: true, message: "Remote node installation started" });
        } catch (e: unknown) {
          await db.update(gameServers).set({ status: "install_failed", updatedAt: new Date() }).where(eq(gameServers.id, server.id));
          return NextResponse.json({ error: `Remote node error: ${e instanceof Error ? e.message : "Unknown"}` }, { status: 502 });
        }
      }

      await db.update(gameServers).set({ status: "install_failed", updatedAt: new Date() }).where(eq(gameServers.id, server.id));
      return NextResponse.json(
        { error: "Remote node installation requires a node agent API URL. Use a local node for direct installs." },
        { status: 400 }
      );
    }

    // Build variables and script
    const variables = buildVariables(server);
    const script = replaceTemplateVariables(server.installScript, variables);

    const fullScript = `#!/usr/bin/env bash
set -e

echo "=== GameServer Manager Install ==="
echo "Game: ${server.gameName || "Unknown"}"
echo "Server: ${server.name}"
echo "Path: ${server.installPath}"
echo "Node: ${server.nodeName || "Local"}"
echo ""

# Create install directory
mkdir -p "${server.installPath}"

# --- Begin game install script ---
${script}
# --- End game install script ---

echo ""
echo "=== Installation Complete ==="
`;

    // Ensure install path exists
    try {
      await mkdir(server.installPath, { recursive: true });
    } catch {
      // may already exist
    }

    const tempDir = await mkdtemp(join(tmpdir(), "gsm-install-"));
    const scriptPath = join(tempDir, "install.sh");

    try {
      await writeFile(scriptPath, fullScript, "utf8");
      await chmod(scriptPath, 0o755);

      // Build env string for the shell
      const envVars = Object.entries(variables)
        .map(([k, v]) => `${k}=${JSON.stringify(String(v ?? ""))}`)
        .join(" ");

      // Use exec() which runs through the system shell (/bin/sh)
      // This is guaranteed to work on all Linux systems
      const { stdout, stderr } = await execAsync(
        `${envVars} sh "${scriptPath}"`,
        {
          timeout: 1000 * 60 * 45, // 45 minutes
          maxBuffer: 1024 * 1024 * 10, // 10 MB
          cwd: server.installPath,
          env: {
            ...process.env,
            HOME: process.env.HOME || "/root",
            PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            ...Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, String(v ?? "")])),
          },
        }
      );

      await db
        .update(gameServers)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(gameServers.id, server.id));

      return NextResponse.json({
        ok: true,
        message: `${server.gameName || "Game"} files installed for ${server.name}`,
        output: stdout.slice(-8000),
        errorOutput: stderr.slice(-8000),
      });
    } catch (e: unknown) {
      await db
        .update(gameServers)
        .set({ status: "install_failed", updatedAt: new Date() })
        .where(eq(gameServers.id, server.id));

      const err = e as { message?: string; stdout?: string; stderr?: string };
      return NextResponse.json(
        {
          error: err.message || "Install failed",
          output: err.stdout?.slice(-8000) || "",
          errorOutput: err.stderr?.slice(-8000) || "",
        },
        { status: 500 }
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
