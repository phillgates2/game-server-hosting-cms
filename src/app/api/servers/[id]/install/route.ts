import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { mkdtemp, writeFile, chmod, rm, mkdir, access, constants, stat, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { getTemplateBySlug, getExpectedArtifactsBySlug, type TemplateVariable } from "@/db/seeds";
import { renderConfigFile, resolveConfigFiles } from "@/lib/config-render";
import { apiError } from "@/lib/api-error";

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

async function ensurePortForwardRule(port: number, targetIp: string) {
  if (!port || port < 1 || port > 65535) return false;

  const protocols: Array<"tcp" | "udp"> = ["tcp", "udp"];
  for (const protocol of protocols) {
    try {
      await execFile("iptables", ["-t", "nat", "-C", "PREROUTING", "-p", protocol, "--dport", String(port), "-j", "DNAT", "--to-destination", `${targetIp}:${port}`]);
      continue;
    } catch {
      // Rule does not exist yet.
    }

    try {
      await execFile("iptables", ["-t", "nat", "-A", "PREROUTING", "-p", protocol, "--dport", String(port), "-j", "DNAT", "--to-destination", `${targetIp}:${port}`]);
      await execFile("iptables", ["-t", "nat", "-A", "POSTROUTING", "-p", protocol, "-d", targetIp, "--dport", String(port), "-j", "MASQUERADE"]);
      await execFile("iptables", ["-A", "FORWARD", "-p", protocol, "-d", targetIp, "--dport", String(port), "-m", "state", "--state", "NEW,ESTABLISHED,RELATED", "-j", "ACCEPT"]);
    } catch {
      // Ignore failures when iptables is unavailable or the host does not permit the change.
    }
  }

  try {
    await execFile("netfilter-persistent", ["save"]);
  } catch {
    // Ignore if persistence tooling is unavailable.
  }

  return true;
}

async function applyServerPortForwarding(server: { nodeIsLocal?: boolean | null; port: number; queryPort: number | null; rconPort: number | null }) {
  if (!server.nodeIsLocal) return [];

  const targetIp = "127.0.0.1";
  const ports = Array.from(new Set([server.port, server.queryPort, server.rconPort].filter((port): port is number => typeof port === "number" && port > 0 && port <= 65535)));
  const applied: number[] = [];

  for (const port of ports) {
    if (await ensurePortForwardRule(port, targetIp)) {
      applied.push(port);
    }
  }

  return applied;
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

// Recursively substitute {{VAR}} placeholders in config values so generated
// config files never contain raw template tokens.
function substituteConfigValues(input: unknown, variables: Record<string, unknown>): unknown {
  if (typeof input === "string") return replaceTemplateVariables(input, variables);
  if (Array.isArray(input)) return input.map((v) => substituteConfigValues(v, variables));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = substituteConfigValues(v, variables);
    }
    return out;
  }
  return input;
}

// Wizard checkboxes round-trip as "true"/"false", but engines like id Tech 3
// (Wolfenstein: ET) treat any non-numeric string as 0. For checkbox variables
// whose template default is numeric ("0"/"1"), normalize to "0"/"1".
function normalizeTemplateBooleans(variables: Record<string, unknown>, defs?: TemplateVariable[]) {
  if (!defs || defs.length === 0) return;
  for (const def of defs) {
    if (def.field_type !== "checkbox") continue;
    if (def.default_value !== "0" && def.default_value !== "1") continue;
    const raw = variables[def.env_variable];
    if (raw === undefined || raw === null || raw === "") {
      variables[def.env_variable] = def.default_value;
      continue;
    }
    const s = String(raw).trim().toLowerCase();
    variables[def.env_variable] = s === "true" || s === "yes" || s === "on" || s === "1" ? "1" : "0";
  }
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
    const startBody = `#!/usr/bin/env bash\nset -e\ncd ${JSON.stringify(options.installPath)}\nexec >> ${JSON.stringify(join(options.installPath, "gsm-server.log"))} 2>&1\necho "\\n=== GSM Server Start — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="\n${replaceTemplateVariables(options.startCommand, options.variables)}\n`;
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

  // Config files (create if missing).
  //
  // A template may ship several config files with different contents — the
  // per-file values come from `defaultConfig.__files`, keyed by the same path
  // used in `configFiles`. Templates without __files write the same option set
  // into every file they declare.
  //
  // Both the target path and the config values may contain {{VAR}} tokens —
  // substitute them, otherwise generated configs contain literal placeholders
  // (e.g. Don't Starve Together's DoNotStarveTogether/{{CLUSTER_NAME}} folder).
  const configFiles = options.configFiles || {};
  const byFile = resolveConfigFiles(configFiles, options.defaultConfig || {});

  for (const [rawPath, rawValues] of Object.entries(byFile)) {
    const configPath = replaceTemplateVariables(rawPath, options.variables);
    // Skip unresolved tokens and paths whose tokenized folder vanished (e.g. {{ET_MOD}} unset).
    if (!configPath || configPath.includes("{{") || configPath.startsWith("/")) continue;

    const values = substituteConfigValues(rawValues, options.variables) as Record<string, unknown>;
    const absolute = join(options.installPath, configPath);
    await mkdir(dirname(absolute), { recursive: true });
    if (!(await exists(absolute))) {
      // Render using the *template* path so __gsm_format and the file extension
      // are both resolved against what the template declared.
      const body = renderConfigFile(rawPath, values);
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

async function pathPatternExists(installPath: string, pattern: string): Promise<boolean> {
  // alternative paths: a|b
  if (pattern.includes("|")) {
    const alts = pattern.split("|").map((s) => s.trim()).filter(Boolean);
    for (const alt of alts) {
      if (await pathPatternExists(installPath, alt)) return true;
    }
    return false;
  }

  // simple exact path
  if (!pattern.includes("*")) {
    return exists(join(installPath, pattern));
  }

  // support wildcard in final filename segment only
  const dir = dirname(pattern);
  const base = basename(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const rx = new RegExp(`^${base}$`);
  const fullDir = join(installPath, dir === "." ? "" : dir);
  try {
    const entries = await readdir(fullDir);
    return entries.some((name: string) => rx.test(name));
  } catch {
    return false;
  }
}

async function verifyInstalledArtifacts(installPath: string, renderedStartCommand: string, explicitArtifacts: string[] = []) {
  const checks: string[] = [];
  const missing: string[] = [];

  if (explicitArtifacts.length > 0) {
    for (const artifact of explicitArtifacts) {
      checks.push(artifact);
      if (!(await pathPatternExists(installPath, artifact))) missing.push(artifact);
    }
    return { checks, missing };
  }

  // Fallback heuristic for custom/imported templates
  const jarMatch = renderedStartCommand.match(/-jar\s+([^\s]+)/);
  if (jarMatch) {
    const jarPath = jarMatch[1].replace(/^\.\//, "");
    checks.push(jarPath);
    if (!(await exists(join(installPath, jarPath)))) missing.push(jarPath);
  }

  const execMatches = [
    ...renderedStartCommand.matchAll(/(?:^|&&|then)\s*(?:[A-Z0-9_]+=\S+\s+)*\.\/([^\s;]+)/g),
  ].map((m) => m[1]);

  const uniqueExecs = [...new Set(execMatches)];
  for (const rel of uniqueExecs) {
    const normalized = rel.replace(/^\.\//, "");
    checks.push(normalized);
    if (!(await exists(join(installPath, normalized)))) missing.push(normalized);
  }

  return { checks, missing };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.install"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
    normalizeTemplateBooleans(variables, latestTemplate?.variables);
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

      const forwardedPorts = await applyServerPortForwarding(server);
      const renderedStartCommand = startCommandSource ? replaceTemplateVariables(startCommandSource, variables) : "";
      const explicitArtifacts = server.gameSlug ? getExpectedArtifactsBySlug(server.gameSlug) : [];
      const verification = await verifyInstalledArtifacts(effectiveInstallPath, renderedStartCommand, explicitArtifacts);

      if (verification.missing.length > 0) {
        await db
          .update(gameServers)
          .set({ status: "install_failed", updatedAt: new Date() })
          .where(eq(gameServers.id, server.id));

        return NextResponse.json({
          error: `Install finished, but expected runtime files are missing: ${verification.missing.join(", ")}`,
          output: `${stdout}\n\nGenerated files:\n${generatedFiles.map((f) => `- ${f}`).join("\n")}\n\nVerification checks:\n${verification.checks.map((c) => `- ${c}`).join("\n")}`.slice(-8000),
          errorOutput: stderr.slice(-8000),
        }, { status: 500 });
      }

      await db
        .update(gameServers)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(gameServers.id, server.id));

      return NextResponse.json({
        ok: true,
        message: `${server.gameName || "Game"} files installed for ${server.name}${forwardedPorts.length ? ` and forwarded ports ${forwardedPorts.join(", ")}` : ""}`,
        output: `${stdout}\n\nGenerated files:\n${generatedFiles.map((f) => `- ${f}`).join("\n")}\n\nVerified runtime files:\n${verification.checks.map((c) => `- ${c}`).join("\n")}${forwardedPorts.length ? `\n\nForwarded ports: ${forwardedPorts.join(", ")}` : ""}`.slice(-8000),
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
    return apiError(e, "Unknown error", 500);
  }
}
