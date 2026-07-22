import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { mkdtemp, writeFile, chmod, rm, mkdir, access, constants, stat } from "fs/promises";
import { tmpdir, homedir } from "os";
import { basename, dirname, join } from "path";
import { spawn, type ChildProcess } from "child_process";
import { getTemplateBySlug } from "@/db/seeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Find a working bash binary (NOT sh — game scripts use bash-isms like &>)
async function findBash(): Promise<string> {
  const candidates = [
    "/usr/bin/bash",
    "/bin/bash",
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
  // Fallback: try sh paths, but scripts may have issues
  for (const p of ["/usr/bin/sh", "/bin/sh"]) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // next
    }
  }
  return "bash"; // bare name — let the OS find it via PATH
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

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function renderConfigFile(filePath: string, config: Record<string, unknown>) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) {
    return `${JSON.stringify(config, null, 2)}\n`;
  }
  if (lower.endsWith(".xml")) {
    const items = Object.entries(config)
      .map(([k, v]) => `  <setting key="${k}">${String(v)}</setting>`)
      .join("\n");
    return `<settings>\n${items}\n</settings>\n`;
  }
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return `${Object.entries(config).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n`;
  }
  if (lower.endsWith(".cfg") || lower.endsWith(".conf") || lower.endsWith(".ini") || lower.endsWith(".properties") || lower.endsWith(".dat")) {
    return `${Object.entries(config).map(([k, v]) => `${k}=${String(v)}`).join("\n")}\n`;
  }
  return `${Object.entries(config).map(([k, v]) => `${k}=${String(v)}`).join("\n")}\n`;
}

async function materializeServerFiles(options: {
  installPath: string;
  gameName: string;
  startCommand?: string | null;
  stopCommand?: string | null;
  configFiles?: Record<string, string> | null;
  defaultConfig?: Record<string, unknown> | null;
  variables: Record<string, unknown>;
}) {
  const generated: string[] = [];

  // Environment file
  const envPath = join(options.installPath, "gsm-server.env");
  const envBody = Object.entries(options.variables)
    .map(([k, v]) => `${k}=${JSON.stringify(String(v ?? ""))}`)
    .join("\n") + "\n";
  await writeFile(envPath, envBody, "utf8");
  generated.push("gsm-server.env");

  // Start script
  if (options.startCommand) {
    const startPath = join(options.installPath, "gsm-start.sh");
    const startBody = `#!/usr/bin/env bash\nset -e\ncd ${JSON.stringify(options.installPath)}\n${replaceTemplateVariables(options.startCommand, options.variables)}\n`;
    await writeFile(startPath, startBody, "utf8");
    await chmod(startPath, 0o755);
    generated.push("gsm-start.sh");
  }

  // Stop script
  if (options.stopCommand) {
    const stopPath = join(options.installPath, "gsm-stop.sh");
    const stopBody = `#!/usr/bin/env bash\nset -e\ncd ${JSON.stringify(options.installPath)}\n${replaceTemplateVariables(options.stopCommand, options.variables)}\n`;
    await writeFile(stopPath, stopBody, "utf8");
    await chmod(stopPath, 0o755);
    generated.push("gsm-stop.sh");
  }

  // Config files (create if missing)
  const configFiles = options.configFiles || {};
  const defaultConfig = options.defaultConfig || {};
  for (const configPath of Object.keys(configFiles)) {
    const absolute = join(options.installPath, configPath);
    await mkdir(dirname(absolute), { recursive: true });
    if (!(await exists(absolute))) {
      const body = renderConfigFile(configPath, defaultConfig);
      await writeFile(absolute, body, "utf8");
      generated.push(configPath);
    }
  }

  // Human-readable readme/start guide in server dir
  const readmePath = join(options.installPath, "GSM-README.txt");
  const readmeBody = [
    `GameServer Manager generated files for ${options.gameName}`,
    "",
    "Generated files:",
    ...generated.map((g) => `- ${g}`),
    "",
    "Typical usage:",
    options.startCommand ? "- Start: ./gsm-start.sh" : "- Start command not defined",
    options.stopCommand ? "- Stop:  ./gsm-stop.sh" : "- Stop command not defined",
    "",
    "Variables are stored in gsm-server.env",
  ].join("\n") + "\n";
  await writeFile(readmePath, readmeBody, "utf8");
  generated.push("GSM-README.txt");

  return generated;
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
        gameSlug: gameDefinitions.slug,
        installScript: gameDefinitions.installScript,
        startCommand: gameDefinitions.startCommand,
        stopCommand: gameDefinitions.stopCommand,
        configFiles: gameDefinitions.configFiles,
        defaultConfig: gameDefinitions.defaultConfig,
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

    const latestTemplate = server.gameSlug ? getTemplateBySlug(server.gameSlug) : undefined;
    const installScriptSource = latestTemplate?.installScript || server.installScript;
    const startCommandSource = latestTemplate?.startCommand || server.startCommand;
    const stopCommandSource = latestTemplate?.stopCommand || server.stopCommand;
    const configFilesSource = (latestTemplate?.configFiles || asRecord(server.configFiles)) as Record<string, string>;
    const defaultConfigSource = (latestTemplate?.defaultConfig || asRecord(server.defaultConfig)) as Record<string, unknown>;

    if (!installScriptSource) {
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

    // Resolve install path, auto-falling back for existing local nodes created with /opt/gameservers.
    let effectiveInstallPath = server.installPath;
    const isRootUser = process.getuid?.() === 0;
    if (server.nodeIsLocal && !isRootUser && effectiveInstallPath.startsWith("/opt/gameservers")) {
      effectiveInstallPath = join(homedir() || "/home", "gameservers", basename(effectiveInstallPath));
      // Persist the migrated path so future installs/starts use the writable location.
      await db
        .update(gameServers)
        .set({ installPath: effectiveInstallPath, updatedAt: new Date() })
        .where(eq(gameServers.id, server.id));
    }

    // Build variables and script
    const variables = buildVariables({ ...server, installPath: effectiveInstallPath });
    const script = replaceTemplateVariables(installScriptSource, variables);

    const fullScript = `#!/usr/bin/env bash
set -e

echo "=== GameServer Manager Install ==="
echo "Game: ${(server.gameName || "Unknown").replace(/"/g, '\\"')}"
echo "Server: ${server.name.replace(/"/g, '\\"')}"
echo "Path: ${effectiveInstallPath}"
echo "Node: ${(server.nodeName || "Local").replace(/"/g, '\\"')}"
echo ""

# Create and enter install directory
mkdir -p "${effectiveInstallPath}"
cd "${effectiveInstallPath}"
echo "Working directory: $(pwd)"
echo ""

# --- Begin game install script ---
${script}
# --- End game install script ---

echo ""
echo "=== Installation Complete ==="
`;

    // Find bash on this system (game scripts use bash syntax)
    const shellPath = await findBash();

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
      await mkdir(effectiveInstallPath, { recursive: true });
    } catch (mkdirErr: unknown) {
      const msg = mkdirErr instanceof Error ? mkdirErr.message : "Unknown";
      return NextResponse.json({
        error: `Cannot create install directory "${effectiveInstallPath}": ${msg}`,
        output: "",
        errorOutput:
          `This usually means the node path is not writable by the panel user.\n\n` +
          `Recommended fix:\n` +
          `  mkdir -p ${effectiveInstallPath}\n\n` +
          `Or, if you still want to use /opt:\n` +
          `  sudo mkdir -p /opt/gameservers\n` +
          `  sudo chown -R $USER:$USER /opt/gameservers\n`,
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

      const generatedFiles = await materializeServerFiles({
        installPath: effectiveInstallPath,
        gameName: server.gameName || "Game",
        startCommand: startCommandSource,
        stopCommand: stopCommandSource,
        configFiles: configFilesSource,
        defaultConfig: defaultConfigSource,
        variables,
      });

      await db
        .update(gameServers)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(gameServers.id, server.id));

      return NextResponse.json({
        ok: true,
        message: `${server.gameName || "Game"} files installed for ${server.name}`,
        output: `${stdout}\n\nGenerated files:\n${generatedFiles.map((f) => `- ${f}`).join("\n")}`.slice(-8000),
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
