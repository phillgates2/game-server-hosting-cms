import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, nodeMetrics } from "@/db/schema";
import { eq } from "drizzle-orm";

// POST /api/nodes/[id]/heartbeat - Node sends heartbeat with metrics
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  // Verify API key from node
  const apiKey = req.headers.get("x-api-key");
  
  try {
    const [node] = await db
      .select({ id: nodes.id, apiKey: nodes.apiKey })
      .from(nodes)
      .where(eq(nodes.id, Number(id)))
      .limit(1);

    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    // Validate API key if set
    if (node.apiKey && node.apiKey !== apiKey) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const body = await req.json();
    const {
      cpuPercent,
      cpuLoad1,
      cpuLoad5,
      cpuLoad15,
      ramUsedMb,
      ramTotalMb,
      ramBufferMb,
      ramCachedMb,
      diskUsedMb,
      diskTotalMb,
      networkRxMb,
      networkTxMb,
      serverCount,
      ipv6Enabled,
    } = body;

    // Update node status and heartbeat
    await db
      .update(nodes)
      .set({
        status: "online",
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, Number(id)));

    // Insert metrics
    await db.insert(nodeMetrics).values({
      nodeId: Number(id),
      cpuPercent,
      cpuLoad1,
      cpuLoad5,
      cpuLoad15,
      ramUsedMb,
      ramTotalMb,
      ramBufferMb,
      ramCachedMb,
      diskUsedMb,
      diskTotalMb,
      networkRxMb,
      networkTxMb,
      serverCount,
      ipv6Enabled,
    });

    return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
