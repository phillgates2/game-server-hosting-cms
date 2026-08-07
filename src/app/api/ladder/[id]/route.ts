import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leagueLadderEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

function normalizeTeamTag(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 10) : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "ladder.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: auth.userId };

    if (body.season !== undefined) update.season = String(body.season || "S1").trim().slice(0, 64);
    if (body.teamName !== undefined) update.teamName = String(body.teamName || "").trim();
    if (body.tag !== undefined) update.tag = normalizeTeamTag(body.tag);
    if (body.wins !== undefined) update.wins = Number(body.wins || 0);
    if (body.losses !== undefined) update.losses = Number(body.losses || 0);
    if (body.draws !== undefined) update.draws = Number(body.draws || 0);
    if (body.points !== undefined) update.points = Number(body.points || 0);
    if (body.streak !== undefined) update.streak = Number(body.streak || 0);
    if (body.logoEmoji !== undefined) update.logoEmoji = String(body.logoEmoji || "🎯").slice(0, 8);
    if (body.notes !== undefined) update.notes = body.notes ? String(body.notes) : null;

    if (update.teamName !== undefined && !String(update.teamName)) {
      return NextResponse.json({ error: "teamName cannot be empty" }, { status: 400 });
    }

    const [entry] = await db
      .update(leagueLadderEntries)
      .set(update)
      .where(eq(leagueLadderEntries.id, Number(id)))
      .returning();

    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ entry });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "ladder.delete"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [deleted] = await db
      .delete(leagueLadderEntries)
      .where(eq(leagueLadderEntries.id, Number(id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
