import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { buildDeployScript, deployPreflight, shellQuote, sshPrefix, scpPrefix } from "@/lib/node-deploy";
import { pingNodeAgent } from "@/lib/node-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AGENT_PORT = 8787;
const SSH_TIMEOUT_MS = 120_000;

function runCommand(cmd: string, args: string[], opts: { stdin?: string; env?: Record<string, string> }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectP(new Error(`${cmd} timed out after ${SSH_TIMEOUT_MS / 1000}s`));
    }, SSH_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectP(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code: code ?? -1, stdout, stderr });
    });
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

// POST /api/nodes/[id]/deploy — copy the agent over SSH and start it
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const nodeId = Number(id);
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return NextResponse.json({ error: "Invalid node id" }, { status: 400 });
  }

  try {
    const [node] = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });
    if (node.isLocal) {
      return NextResponse.json({ error: "The local node runs in-process — nothing to deploy." }, { status: 400 });
    }

    const pre = deployPreflight(node);
    if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: 400 });

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      /* all fields optional */
    }
    const agentPort = Number(body.agentPort) > 0 ? Math.min(65535, Math.floor(Number(body.agentPort))) : DEFAULT_AGENT_PORT;
    const serversRoot = typeof body.serversRoot === "string" && body.serversRoot.trim()
      ? body.serversRoot.trim()
      : node.gameServerPath || "/opt/gameservers";

    // The agent and the panel share one secret; mint one if the node has none.
    let apiKey = node.apiKey?.trim() || "";
    if (!apiKey) {
      apiKey = randomBytes(24).toString("hex");
      await db.update(nodes).set({ apiKey, updatedAt: new Date() }).where(eq(nodes.id, node.id));
    }

    const sshTarget = `${node.sshUser}@${node.hostname}`;
    const sshPort = node.sshPort ?? 22;
    const auth = { keyPath: node.sshKeyPath, password: node.sshPassword };
    const sshP = sshPrefix(sshPort, auth);
    const scpP = scpPrefix(sshPort, auth);

    // 1. Make the target dir and copy the agent.
    const agentFile = join(/* turbopackIgnore: true */ process.cwd(), "agent", "gsm-agent.mjs");
    const mkdirFirst = await runCommand(sshP.cmd, [...sshP.args, sshTarget, `mkdir -p ${shellQuote("gsm-agent")}`], { env: sshP.env });
    if (mkdirFirst.code !== 0) {
      return NextResponse.json({ error: `SSH failed: ${(mkdirFirst.stderr || mkdirFirst.stdout).slice(-400)}` }, { status: 502 });
    }
    const scp = await runCommand(scpP.cmd, [...scpP.args, agentFile, `${sshTarget}:gsm-agent/gsm-agent.mjs`], { env: scpP.env });
    if (scp.code !== 0) {
      return NextResponse.json({ error: `Could not copy the agent: ${(scp.stderr || scp.stdout).slice(-400)}` }, { status: 502 });
    }

    // 2. Run the deploy script on the remote box (env file + systemd unit).
    const script = buildDeployScript({
      sshUser: node.sshUser!,
      hostname: node.hostname,
      sshPort: node.sshPort ?? 22,
      agentKey: apiKey,
      agentPort,
      serversRoot,
      panelUrl: req.nextUrl.origin,
      nodeId: node.id,
    });
    const deploy = await runCommand(sshP.cmd, [...sshP.args, sshTarget, "bash", "-s"], { stdin: script, env: sshP.env });
    if (deploy.code !== 0) {
      return NextResponse.json({ error: `Remote deploy failed: ${(deploy.stderr || deploy.stdout).slice(-400)}` }, { status: 502 });
    }

    // 3. Remember how to reach the agent when the operator has not set a URL.
    const apiUrl = node.apiUrl?.trim() || `http://${node.ipv4 || node.hostname}:${agentPort}`;
    if (!node.apiUrl?.trim()) {
      await db.update(nodes).set({ apiUrl, updatedAt: new Date() }).where(eq(nodes.id, node.id));
    }

    // 4. Best-effort confirmation (the agent may need a couple of seconds).
    let agentOk = false;
    let agentVersion: string | null = null;
    for (let i = 0; i < 4 && !agentOk; i++) {
      try {
        const ping = await pingNodeAgent({ apiUrl, apiKey });
        agentOk = true;
        agentVersion = ping.version ?? null;
      } catch {
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }

    return NextResponse.json({
      ok: true,
      deployed: true,
      agentReachable: agentOk,
      agentVersion,
      apiUrl,
      message: agentOk
        ? `Agent deployed and answering${agentVersion ? ` (v${agentVersion})` : ""} at ${apiUrl}.`
        : `Agent deployed, but the panel could not reach ${apiUrl} yet — check the port/firewall, then use Test Connection.`,
      output: deploy.stdout.slice(-500),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
