import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Get server with game info and node info
    const [server] = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        installPath: gameServers.installPath,
        status: gameServers.status,
        nodeId: gameServers.nodeId,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
        installScript: gameDefinitions.installScript,
        defaultPort: gameDefinitions.defaultPort,
        config: gameDefinitions.defaultConfig,
        nodeName: nodes.name,
        nodeIsLocal: nodes.isLocal,
        nodeHostname: nodes.hostname,
        nodeSshUser: nodes.sshUser,
        nodeSshPort: nodes.sshPort,
        nodeSshKeyPath: nodes.sshKeyPath,
        nodeGameServerPath: nodes.gameServerPath,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    if (!server.installScript) {
      return NextResponse.json({ error: "No install script available for this game" }, { status: 400 });
    }

    // Update status to installing
    await db
      .update(gameServers)
      .set({ status: "installing", updatedAt: new Date() })
      .where(eq(gameServers.id, Number(id)));

    // Create install script temp file
    const scriptPath = `/tmp/gsm-install-${server.gameSlug}-${Date.now()}.sh`;
    const installDir = server.installPath;

    // Process the install script - it uses {{INSTALL_PATH}} as the first arg
    // The template scripts expect INSTALL_DIR="$1" as the first parameter
    const script = `#!/bin/bash
set -e
exec > >(tee -a /tmp/gsm-install-${server.gameSlug}-${Date.now()}.log) 2>&1

echo "=== GameServer Manager Install ==="
echo "Game: ${server.gameName}"
echo "Server: ${server.name}"
echo "Path: ${installDir}"
echo "Node: ${server.nodeName || 'Local'}"
echo ""

${server.installScript}
`;

    const fs = await import("fs");
    fs.writeFileSync(scriptPath, script, "utf8");
    fs.chmodSync(scriptPath, 0o755);

    // Run the install script
    let output = "";
    let success = false;

    try {
      // Ensure install directory exists
      mkdirSync(installDir, { recursive: true });

      // Run the install script, passing the install directory as argument
      const result = await execAsync(`bash ${scriptPath} "${installDir}"`, {
        timeout: 300000, // 5 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB output
      });
      output = result.stdout + result.stderr;
      success = true;

      // Update server status to stopped (ready to start)
      await db
        .update(gameServers)
        .set({
          status: "stopped",
          config: server.config || {},
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, Number(id)));
    } catch (e: unknown) {
      const error = e as { stdout?: string; stderr?: string; message?: string };
      output = (error.stdout || "") + "\n" + (error.stderr || "") + "\n" + (error.message || "");
      success = false;

      // Update server status to error
      await db
        .update(gameServers)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(gameServers.id, Number(id)));
    }

    // Clean up temp script
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      success,
      message: success
        ? `${server.gameName} server files installed successfully at ${installDir}`
        : `Installation completed with issues. Check the logs.`,
      output: output.slice(0, 5000), // Limit output size
      path: installDir,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";

    // Reset status on error
    try {
      await db
        .update(gameServers)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(gameServers.id, Number(id)));
    } catch {
      // ignore
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
