import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, leagueLadderEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { parseLadderStat, ladderStatError, MAX_LADDER_COUNT, MAX_LADDER_POINTS } from "@/lib/ladder-stats";

function normalizeTeamTag(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 10) : null;
}

function normalizeSeason(value: string | null | undefined) {
  const trimmed = (value || "S1").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : "S1";
}

async function ensureLadderSchema() {
  await db.execute(sql`
    ALTER TABLE league_ladder_entries
    ADD COLUMN IF NOT EXISTS game_id INTEGER REFERENCES game_definitions(id)
  `);
  await db.execute(sql`
    ALTER TABLE league_ladder_entries
    ADD COLUMN IF NOT EXISTS ladder_name VARCHAR(128)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS league_ladder_entries_game_season_idx
    ON league_ladder_entries (game_id, season)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS league_ladder_entries_ladder_name_idx
    ON league_ladder_entries (ladder_name, season)
  `);
}

/**
 * Build a filter for a specific ladder scope.
 * A ladder is identified by EITHER a gameId OR a ladderName (standalone ladder).
 * If neither is provided, returns entries with no game AND no ladder name (legacy).
 */
function ladderScopeFilter(gameId: number | null, ladderName: string | null, season?: string) {
  const conditions = [];

  if (gameId !== null) {
    conditions.push(eq(leagueLadderEntries.gameId, gameId));
  } else if (ladderName) {
    conditions.push(eq(leagueLadderEntries.ladderName, ladderName));
  } else {
    conditions.push(isNull(leagueLadderEntries.gameId));
    conditions.push(isNull(leagueLadderEntries.ladderName));
  }

  if (season) {
    conditions.push(eq(leagueLadderEntries.season, season));
  }

  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

/**
 * GET /api/ladder — Public read access
 *
 * Query params:
 *   ?gameId=123       — filter by installed game
 *   ?ladder=MyLadder  — filter by standalone ladder name
 *   ?season=S1        — filter by season
 *
 * Returns all available ladders (from games + standalone) so the UI can
 * show selector tabs.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureLadderSchema();

    const url = new URL(req.url);
    const requestedSeason = url.searchParams.get("season");
    const requestedGameIdStr = url.searchParams.get("gameId");
    const requestedLadder = url.searchParams.get("ladder");

    const requestedGameId = requestedGameIdStr
      ? (Number.isInteger(Number(requestedGameIdStr)) && Number(requestedGameIdStr) > 0 ? Number(requestedGameIdStr) : null)
      : null;

    // ── Discover all available ladders ────────────────────────────────────
    // 1. Ladders from installed games
    const games = await db
      .select({ id: gameDefinitions.id, slug: gameDefinitions.slug, name: gameDefinitions.name, iconEmoji: gameDefinitions.iconEmoji })
      .from(gameDefinitions)
      .orderBy(asc(gameDefinitions.name));

    // 2. Standalone ladders (entries with ladder_name set, no game_id)
    const standaloneLadders = await db
      .selectDistinct({ ladderName: leagueLadderEntries.ladderName })
      .from(leagueLadderEntries)
      .where(and(
        isNull(leagueLadderEntries.gameId),
        sql`${leagueLadderEntries.ladderName} IS NOT NULL AND ${leagueLadderEntries.ladderName} != ''`
      ))
      .orderBy(asc(leagueLadderEntries.ladderName));

    // Build unified ladder list for the UI
    interface LadderOption { type: "game" | "standalone"; id: number | null; name: string; icon: string }
    const ladders: LadderOption[] = [];

    // Add game-based ladders (only if they have entries)
    for (const g of games) {
      const [count] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(leagueLadderEntries)
        .where(eq(leagueLadderEntries.gameId, g.id));
      if (count && count.c > 0) {
        ladders.push({ type: "game", id: g.id, name: g.name, icon: g.iconEmoji || "🎮" });
      }
    }

    // Add standalone ladders
    for (const sl of standaloneLadders) {
      if (sl.ladderName) {
        ladders.push({ type: "standalone", id: null, name: sl.ladderName, icon: "🏆" });
      }
    }

    // ── Determine which ladder to show ────────────────────────────────────
    let activeGameId: number | null = null;
    let activeLadderName: string | null = null;

    if (requestedGameId !== null) {
      activeGameId = requestedGameId;
    } else if (requestedLadder) {
      activeLadderName = requestedLadder;
    } else if (ladders.length > 0) {
      // Default to first available ladder
      const first = ladders[0];
      if (first.type === "game") activeGameId = first.id;
      else activeLadderName = first.name;
    }

    // ── Get seasons for the active ladder ─────────────────────────────────
    const seasonsRaw = await db
      .selectDistinct({ season: leagueLadderEntries.season })
      .from(leagueLadderEntries)
      .where(ladderScopeFilter(activeGameId, activeLadderName))
      .orderBy(desc(leagueLadderEntries.season));

    const seasons = seasonsRaw.map((s) => s.season);
    const season = requestedSeason && seasons.includes(requestedSeason)
      ? requestedSeason
      : (seasons[0] || normalizeSeason(requestedSeason));

    // ── Get standings ─────────────────────────────────────────────────────
    const standings = await db
      .select()
      .from(leagueLadderEntries)
      .where(ladderScopeFilter(activeGameId, activeLadderName, season))
      .orderBy(
        desc(leagueLadderEntries.points),
        desc(leagueLadderEntries.wins),
        asc(leagueLadderEntries.losses),
        asc(leagueLadderEntries.teamName)
      );

    return NextResponse.json({
      ladders,
      activeGameId,
      activeLadderName,
      season,
      seasons,
      standings: standings.map((entry, idx) => ({ ...entry, rank: idx + 1 })),
      // Legacy compat
      gameId: activeGameId,
      games,
    });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

/**
 * POST /api/ladder — Create a new ladder entry
 *
 * Body must include EITHER:
 *   { gameId: 123, ... }         — entry under an installed game's ladder
 *   { ladderName: "My Ladder", ... } — entry under a standalone ladder
 *
 * This means you can create ladders without installing any game templates.
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  const canCreate = auth && ((await hasPermission(auth.userId, "ladder.create")) || (await hasPermission(auth.userId, "ladder.create.entry")));
  if (!canCreate) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await ensureLadderSchema();

    const body = await req.json();
    const teamName = String(body.teamName || "").trim().slice(0, 128);
    if (!teamName) return NextResponse.json({ error: "teamName required" }, { status: 400 });

    // Determine ladder scope: gameId OR ladderName (at least one required)
    let gameId: number | null = null;
    let ladderName: string | null = null;

    if (body.gameId !== undefined && body.gameId !== null && body.gameId !== "") {
      const gid = Number(body.gameId);
      if (!Number.isInteger(gid) || gid <= 0) {
        return NextResponse.json({ error: "Invalid gameId" }, { status: 400 });
      }
      // Verify game exists
      const [game] = await db
        .select({ id: gameDefinitions.id })
        .from(gameDefinitions)
        .where(eq(gameDefinitions.id, gid))
        .limit(1);
      if (!game) {
        return NextResponse.json({ error: "Game not found" }, { status: 404 });
      }
      gameId = gid;
    } else if (body.ladderName) {
      ladderName = String(body.ladderName).trim().slice(0, 128);
      if (!ladderName) {
        return NextResponse.json({ error: "ladderName cannot be empty" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Either gameId or ladderName is required" }, { status: 400 });
    }

    // Number() alone let "abc" through as NaN, "1.5" as a float, negatives
    // and int4-overflowing values — each a 500 or silently corrupt standings.
    const wins = parseLadderStat(body.wins, 0, MAX_LADDER_COUNT);
    const losses = parseLadderStat(body.losses, 0, MAX_LADDER_COUNT);
    const draws = parseLadderStat(body.draws, 0, MAX_LADDER_COUNT);
    const streak = parseLadderStat(body.streak, 0, MAX_LADDER_COUNT);
    if (wins === null || losses === null || draws === null || streak === null) {
      const field = wins === null ? "wins" : losses === null ? "losses" : draws === null ? "draws" : "streak";
      return NextResponse.json({ error: ladderStatError(field) }, { status: 400 });
    }
    const points = parseLadderStat(body.points, wins * 3 + draws, MAX_LADDER_POINTS);
    if (points === null) {
      return NextResponse.json({ error: ladderStatError("points", MAX_LADDER_POINTS) }, { status: 400 });
    }

    const [created] = await db.insert(leagueLadderEntries).values({
      gameId,
      ladderName,
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
    return apiError(e, "Failed", 500);
  }
}
