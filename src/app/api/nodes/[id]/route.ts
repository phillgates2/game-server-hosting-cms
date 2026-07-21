import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { isValidIP } from "@/lib/ipv6";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const nodeId = parseInt(id, 10);
  const result = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  if (result.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ node: result[0] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const nodeId = parseInt(id, 10);
  const body = await request.json();

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.ipAddress !== undefined) {
    if (!isValidIP(body.ipAddress)) {
      return NextResponse.json({ error: "Invalid IPv4 address" }, { status: 400 });
    }
    updates.ipAddress = body.ipAddress;
  }
  if (body.ip6Address !== undefined) {
    if (body.ip6Address && !isValidIP(body.ip6Address)) {
      return NextResponse.json({ error: "Invalid IPv6 address" }, { status: 400 });
    }
    updates.ip6Address = body.ip6Address || null;
  }
  if (body.ip6Enabled !== undefined) updates.ip6Enabled = Boolean(body.ip6Enabled);
  if (body.port !== undefined) updates.port = body.port;
  if (body.maxSlots !== undefined) updates.maxSlots = body.maxSlots;
  if (body.status !== undefined) updates.status = body.status;
  if (body.location !== undefined) updates.location = body.location;

  const result = await db.update(nodes).set(updates).where(eq(nodes.id, nodeId)).returning();
  if (result.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ node: result[0] });
}
