import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leagueLadderEntries } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { asc, desc, eq } from "drizzle-orm";

function normalizeTeamTag(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 10) : null;
}

function normalizeSeason(value: string | null | undefined) {
  const trimmed = (value || "S1").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : "S1";
}

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "ladder.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const season = normalizeSeason(url.searchParams.get("season"));
    const standings = await db
      .select()
      .from(leagueLadderEntries)
      .where(eq(leagueLadderEntries.season, season))
      .orderBy(desc(leagueLadderEntries.points), desc(leagueLadderEntries.wins), asc(leagueLadderEntries.losses), asc(leagueLadderEntries.teamName));

    const seasons = await db
      .select({ season: leagueLadderEntries.season })
      .from(leagueLadderEntries)
      .orderBy(desc(leagueLadderEntries.season));

    const uniqueSeasons = Array.from(new Set(seasons.map((s) => s.season)));

    return NextResponse.json({
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
  if (!auth || !(await hasPermission(auth.userId, "ladder.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const teamName = String(body.teamName || "").trim();
    if (!teamName) return NextResponse.json({ error: "teamName required" }, { status: 400 });

    const wins = Number(body.wins || 0);
    const losses = Number(body.losses || 0);
    const draws = Number(body.draws || 0);
    const points = Number(body.points ?? wins * 3 + draws);
    const streak = Number(body.streak || 0);

    const [created] = await db.insert(leagueLadderEntries).values({
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
      createdBy: auth.userId,
      updatedBy: auth.userId,
    }).returning();

    return NextResponse.json({ entry: created }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
