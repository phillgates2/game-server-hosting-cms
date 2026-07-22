import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { mkdtemp, writeFile, chmod, rm, mkdir, access, constants } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Find a working shell binary
async function findShell(): Promise<string> {
  const candidates = [
    "/usr/bin/bash",
    "/bin/bash",
    "/usr/bin/sh",
    "/bin/sh",
    "/usr/local/bin/bash",
  ];
  for (const p of candidates) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // next
    }
  }
  return "sh"; // bare name — let the OS find it via PATH
}

// Run a script file and collect output
function runScript(
  shellPath: string,
  scriptPath: string,
  options: { cwd: string; env: Record<string, string>; timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const child: ChildProcess = spawn(shellPath, [scriptPath], {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        reject(new Error(`Install timed out after ${options.timeout / 1000}s`));
      }
    }, options.timeout);

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("error", (err: Error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code: number | null) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const err = new Error(`Script exited with code ${code}`);
          (err as unknown as Record<string, unknown>).stdout = stdout;
          (err as unknown as Record<string, unknown>).stderr = stderr;
          reject(err);
        }
      }
    });
  });
}

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

    const fullScript = `#!/usr/bin/env sh
set -e

echo "=== GameServer Manager Install ==="
echo "Game: ${(server.gameName || "Unknown").replace(/"/g, '\\"')}"
echo "Server: ${server.name.replace(/"/g, '\\"')}"
echo "Path: ${server.installPath}"
echo "Node: ${(server.nodeName || "Local").replace(/"/g, '\\"')}"
echo ""

# Create and enter install directory
mkdir -p "${server.installPath}"
cd "${server.installPath}"
echo "Working directory: $(pwd)"
echo ""

# --- Begin game install script ---
${script}
# --- End game install script ---

echo ""
echo "=== Installation Complete ==="
`;

    // Find a shell that exists on this system
    const shellPath = await findShell();

    // Verify the shell actually exists before proceeding
    try {
      await access(shellPath, constants.X_OK);
    } catch {
      return NextResponse.json({
        error: `Shell not found at any standard path. Checked: /usr/bin/bash, /bin/bash, /usr/bin/sh, /bin/sh. Please install bash.`,
        output: "",
        errorOutput: `Tried shell: ${shellPath}`,
      }, { status: 500 });
    }

    // Create install directory — if this fails, report it clearly
    try {
      await mkdir(server.installPath, { recursive: true });
    } catch (mkdirErr: unknown) {
      const msg = mkdirErr instanceof Error ? mkdirErr.message : "Unknown";
      return NextResponse.json({
        error: `Cannot create install directory "${server.installPath}": ${msg}`,
        output: "",
        errorOutput:
          `This usually means the node path is not writable by the panel user.\n\n` +
          `Recommended fix:\n` +
          `  sudo mkdir -p ${server.installPath}\n` +
          `  sudo chown -R $USER:$USER ${server.installPath}\n\n` +
          `For future local nodes, use a writable path like ~/gameservers instead of /opt/gameservers.`,
      }, { status: 500 });
    }

    const tempDir = await mkdtemp(join(tmpdir(), "gsm-install-"));
    const scriptPath = join(tempDir, "install.sh");

    try {
      await writeFile(scriptPath, fullScript, "utf8");
      await chmod(scriptPath, 0o755);

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOME: process.env.HOME || "/root",
        PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      };
      for (const [k, v] of Object.entries(variables)) {
        env[k] = String(v ?? "");
      }

      // Use tempDir as cwd since we know it exists.
      // The script itself cd's into the install path.
      const { stdout, stderr } = await runScript(shellPath, scriptPath, {
        cwd: tempDir,
        env,
        timeout: 1000 * 60 * 45, // 45 min
      });

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
