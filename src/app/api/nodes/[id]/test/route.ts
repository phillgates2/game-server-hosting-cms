import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { pingNodeAgent, NodeRpcError } from "@/lib/node-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/nodes/[id]/test — ping the node agent and report what answers
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.edit", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const nodeId = Number(id);
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return NextResponse.json({ error: "Invalid node id" }, { status: 400 });
  }

  try {
    const [node] = await db
      .select({ id: nodes.id, name: nodes.name, isLocal: nodes.isLocal, apiUrl: nodes.apiUrl, apiKey: nodes.apiKey })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });

    if (node.isLocal) {
      return NextResponse.json({ ok: true, local: true, message: "This is the panel's own machine — process control runs in-process, no agent needed." });
    }
    if (!node.apiUrl || !node.apiKey) {
      return NextResponse.json(
        { ok: false, error: "Set the node's API URL and API key first (the agent prints the port it listens on)." },
        { status: 400 }
      );
    }

    const res = await pingNodeAgent({ apiUrl: node.apiUrl, apiKey: node.apiKey });
    return NextResponse.json({
      ok: true,
      hostname: res.hostname ?? null,
      agentVersion: res.version ?? null,
      message: `Agent answered${res.hostname ? ` from ${res.hostname}` : ""}${res.version ? ` (v${res.version})` : ""}.`,
    });
  } catch (e: unknown) {
    const msg = e instanceof NodeRpcError ? e.message : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
