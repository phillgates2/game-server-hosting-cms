import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { serverPresets, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { inArray } from "drizzle-orm";
import { validatePresetImport } from "@/lib/server-presets";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/presets/import — { presets: [{ name, description?, gameId, variables? }] }
// Every item is validated exactly like a single preset save, then created.
// Items referencing unknown games are skipped and reported, not fatal.
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const valid = validatePresetImport(body);
    if (!valid.ok || !valid.value) {
      return NextResponse.json({ error: valid.error || "Invalid import" }, { status: 400 });
    }
    const presets = valid.value;

    // Drop items whose game does not exist on this panel — they could never
    // be applied. One query instead of one per preset.
    const wantedGames = Array.from(new Set(presets.map((p) => p.gameId)));
    const games = await db
      .select({ id: gameDefinitions.id })
      .from(gameDefinitions)
      .where(inArray(gameDefinitions.id, wantedGames));
    const knownGames = new Set(games.map((g) => g.id));

    const importable = presets.filter((p) => knownGames.has(p.gameId));
    const skippedNoGame = presets.length - importable.length;

    const created = importable.length
      ? await db
          .insert(serverPresets)
          .values(
            importable.map((p) => ({
              userId: auth.userId,
              name: p.name,
              description: p.description,
              gameId: p.gameId,
              variables: p.variables,
            }))
          )
          .returning({ id: serverPresets.id })
      : [];

    return NextResponse.json({
      imported: created.length,
      skippedUnknownGame: skippedNoGame,
      total: presets.length,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not import presets", 500);
  }
}
