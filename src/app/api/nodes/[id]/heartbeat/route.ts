import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, nodeMetrics } from "@/db/schema";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/lib/api-error";

/** Constant-time compare so the key cannot be recovered by timing. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

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

    // A node with no configured key previously accepted heartbeats from anyone,
    // letting an unauthenticated caller forge node status and flood the metrics
    // table. Require the key to be configured and to match.
    if (!node.apiKey) {
      return NextResponse.json(
        { error: "Node has no API key configured. Set one before sending heartbeats." },
        { status: 401 }
      );
    }
    if (!apiKey || !secretsMatch(node.apiKey, apiKey)) {
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
    return apiError(e, "Unknown error", 500);
  }
}
