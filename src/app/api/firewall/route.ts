import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listManagedRules, allowServerPorts, denyServerPorts } from "@/lib/firewall";
import { execFile } from "node:child_process";

function ufwStatus(): Promise<string> {
  return new Promise((resolve) => {
    execFile("ufw", ["status", "numbered"], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolve("UFW is not available or not installed.");
        return;
      }
      resolve(stdout || "");
    });
  });
}

/**
 * GET /api/firewall — View firewall status and panel-managed rules.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const [status, managedRules] = await Promise.all([
      ufwStatus(),
      listManagedRules(),
    ]);

    return NextResponse.json({ status, managedRules });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/firewall — Manually add or remove a port rule.
 * Admin only.
 *
 * Body: { action: "allow" | "deny", port: number, protocol?: "tcp" | "udp" | "both", comment?: string }
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action, port, comment } = body;

    if (!action || !port) {
      return NextResponse.json({ error: "action and port are required" }, { status: 400 });
    }

    const portNum = Number(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return NextResponse.json({ error: "Invalid port number" }, { status: 400 });
    }

    if (action === "allow") {
      await allowServerPorts(0, comment || "Manual rule", { port: portNum });
      return NextResponse.json({ ok: true, message: `Port ${portNum} allowed` });
    } else if (action === "deny") {
      await denyServerPorts({ port: portNum });
      return NextResponse.json({ ok: true, message: `Port ${portNum} rules removed` });
    } else {
      return NextResponse.json({ error: "action must be 'allow' or 'deny'" }, { status: 400 });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
