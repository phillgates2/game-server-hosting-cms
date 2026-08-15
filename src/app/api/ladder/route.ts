import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, leagueLadderEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

function normalizeTeamTag(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 10) : null;
}

function normalizeSeason(value: string | null | undefined) {
  const trimmed = (value || "S1").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : "S1";
}

function normalizeGameId(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function ladderScopeFilter(gameId: number | null, season?: string) {
  if (gameId === null) {
    return season
      ? and(isNull(leagueLadderEntries.gameId), eq(leagueLadderEntries.season, season))
      : isNull(leagueLadderEntries.gameId);
  }

  return season
    ? and(eq(leagueLadderEntries.gameId, gameId), eq(leagueLadderEntries.season, season))
    : eq(leagueLadderEntries.gameId, gameId);
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

export async function GET(req: NextRequest) {
  // Ladder standings are publicly readable — no auth required

  try {
    await ensureLadderSchema();

    const url = new URL(req.url);
    const requestedSeason = normalizeSeason(url.searchParams.get("season"));
    const requestedGameId = normalizeGameId(url.searchParams.get("gameId"));

    const games = await db
      .select({ id: gameDefinitions.id, slug: gameDefinitions.slug, name: gameDefinitions.name, iconEmoji: gameDefinitions.iconEmoji })
      .from(gameDefinitions)
      .orderBy(asc(gameDefinitions.name));

    const gameId = requestedGameId ?? games[0]?.id ?? null;

    const seasons = await db
      .select({ season: leagueLadderEntries.season })
      .from(leagueLadderEntries)
      .where(ladderScopeFilter(gameId))
      .orderBy(desc(leagueLadderEntries.season));

    const uniqueSeasons = Array.from(new Set(seasons.map((s) => s.season)));
    const season = uniqueSeasons.includes(requestedSeason)
      ? requestedSeason
      : (uniqueSeasons[0] || requestedSeason);

    const standings = await db
      .select()
      .from(leagueLadderEntries)
      .where(ladderScopeFilter(gameId, season))
      .orderBy(desc(leagueLadderEntries.points), desc(leagueLadderEntries.wins), asc(leagueLadderEntries.losses), asc(leagueLadderEntries.teamName));

    return NextResponse.json({
      gameId,
      games,
      season,
      seasons: uniqueSeasons,
      standings: standings.map((entry, idx) => ({
        ...entry,
        rank: idx + 1,
      })),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  const canCreate = auth && ((await hasPermission(auth.userId, "ladder.create")) || (await hasPermission(auth.userId, "ladder.create.entry")));
  if (!canCreate) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await ensureLadderSchema();

    const body = await req.json();
    const teamName = String(body.teamName || "").trim();
    if (!teamName) return NextResponse.json({ error: "teamName required" }, { status: 400 });

    const gameId = normalizeGameId(body.gameId);
    if (gameId === null) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const [game] = await db
      .select({ id: gameDefinitions.id })
      .from(gameDefinitions)
      .where(eq(gameDefinitions.id, gameId))
      .limit(1);
    if (!game) {
      return NextResponse.json({ error: "Invalid gameId" }, { status: 400 });
    }

    const wins = Number(body.wins || 0);
    const losses = Number(body.losses || 0);
    const draws = Number(body.draws || 0);
    const points = Number(body.points ?? wins * 3 + draws);
    const streak = Number(body.streak || 0);

    const [created] = await db.insert(leagueLadderEntries).values({
      gameId,
      season: normalizeSeason(body.season),
      teamName,
      tag: normalizeTeamTag(body.tag),
      wins,
      losses,
      draws,
      points,
      streak,
      logoEmoji: String(body.logoEmoji || "🎯").slice(0, 8),
      notes: body.notes ? String(body.notes) : null,
      createdBy: auth!.userId,
      updatedBy: auth!.userId,
    }).returning();

    return NextResponse.json({ entry: created }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
