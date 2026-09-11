import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { serverPresets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/presets/[id] — creator or admin
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const presetId = Number(id);
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return NextResponse.json({ error: "Invalid preset id" }, { status: 400 });
  }

  try {
    const [preset] = await db
      .select({ id: serverPresets.id, userId: serverPresets.userId })
      .from(serverPresets)
      .where(eq(serverPresets.id, presetId))
      .limit(1);
    if (!preset) return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    if (auth.role !== "admin" && preset.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.delete(serverPresets).where(eq(serverPresets.id, presetId));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not delete the preset", 500);
  }
}
