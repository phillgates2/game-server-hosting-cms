import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, leagueLadderEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

function normalizeTeamTag(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 10) : null;
}

function normalizeGameId(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

async function ensureLadderSchema() {
  await db.execute(sql`
    ALTER TABLE league_ladder_entries
    ADD COLUMN IF NOT EXISTS game_id INTEGER REFERENCES game_definitions(id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS league_ladder_entries_game_season_idx
    ON league_ladder_entries (game_id, season)
  `);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const canEditBase = (await hasPermission(auth.userId, "ladder.edit")) || (await hasPermission(auth.userId, "ladder.edit.entry"));
  if (!canEditBase) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await ensureLadderSchema();

    const body = await req.json();
    const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: auth.userId };

    const canSeason = (await hasPermission(auth.userId, "ladder.season")) || (await hasPermission(auth.userId, "ladder.season.manage"));
    const canStats = (await hasPermission(auth.userId, "ladder.edit.stats")) || canEditBase;
    const canNotes = (await hasPermission(auth.userId, "ladder.edit.notes")) || canEditBase;
    const canGame = (await hasPermission(auth.userId, "ladder.manage.games")) || canEditBase;

    if (body.season !== undefined) {
      if (!canSeason) return NextResponse.json({ error: "Permission denied for season updates" }, { status: 403 });
      update.season = String(body.season || "S1").trim().slice(0, 64);
    }

    if (body.gameId !== undefined) {
      if (!canGame) return NextResponse.json({ error: "Permission denied for game updates" }, { status: 403 });

      const gameId = normalizeGameId(body.gameId);
      if (gameId === null) {
        return NextResponse.json({ error: "Invalid gameId" }, { status: 400 });
      }
      const [game] = await db
        .select({ id: gameDefinitions.id })
        .from(gameDefinitions)
        .where(eq(gameDefinitions.id, gameId))
        .limit(1);
      if (!game) {
        return NextResponse.json({ error: "Invalid gameId" }, { status: 400 });
      }
      update.gameId = gameId;
    }

    if (body.teamName !== undefined) update.teamName = String(body.teamName || "").trim();
    if (body.tag !== undefined) update.tag = normalizeTeamTag(body.tag);
    if (body.wins !== undefined) {
      if (!canStats) return NextResponse.json({ error: "Permission denied for stat updates" }, { status: 403 });
      update.wins = Number(body.wins || 0);
    }
    if (body.losses !== undefined) {
      if (!canStats) return NextResponse.json({ error: "Permission denied for stat updates" }, { status: 403 });
      update.losses = Number(body.losses || 0);
    }
    if (body.draws !== undefined) {
      if (!canStats) return NextResponse.json({ error: "Permission denied for stat updates" }, { status: 403 });
      update.draws = Number(body.draws || 0);
    }
    if (body.points !== undefined) {
      if (!canStats) return NextResponse.json({ error: "Permission denied for stat updates" }, { status: 403 });
      update.points = Number(body.points || 0);
    }
    if (body.streak !== undefined) {
      if (!canStats) return NextResponse.json({ error: "Permission denied for stat updates" }, { status: 403 });
      update.streak = Number(body.streak || 0);
    }
    if (body.logoEmoji !== undefined) update.logoEmoji = String(body.logoEmoji || "🎯").slice(0, 8);
    if (body.notes !== undefined) {
      if (!canNotes) return NextResponse.json({ error: "Permission denied for notes updates" }, { status: 403 });
      update.notes = body.notes ? String(body.notes) : null;
    }

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
    return apiError(e, "Failed", 500);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !((await hasPermission(auth.userId, "ladder.delete")) || (await hasPermission(auth.userId, "ladder.delete.entry")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await ensureLadderSchema();

    const [deleted] = await db
      .delete(leagueLadderEntries)
      .where(eq(leagueLadderEntries.id, Number(id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}
