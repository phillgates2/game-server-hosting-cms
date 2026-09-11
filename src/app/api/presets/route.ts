import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { serverPresets, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { desc, eq } from "drizzle-orm";
import { validatePresetInput } from "@/lib/server-presets";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/presets — list every preset with its game
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select({
        id: serverPresets.id,
        userId: serverPresets.userId,
        name: serverPresets.name,
        description: serverPresets.description,
        gameId: serverPresets.gameId,
        variables: serverPresets.variables,
        createdAt: serverPresets.createdAt,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
        gameIcon: gameDefinitions.iconEmoji,
      })
      .from(serverPresets)
      .leftJoin(gameDefinitions, eq(serverPresets.gameId, gameDefinitions.id))
      .orderBy(desc(serverPresets.createdAt))
      .limit(200);

    return NextResponse.json({
      presets: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        gameId: r.gameId,
        variables: r.variables ?? {},
        gameName: r.gameName,
        gameIcon: r.gameIcon,
        mine: r.userId === auth.userId,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not list presets", 500);
  }
}

// POST /api/presets — save a setup for reuse
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

    const valid = validatePresetInput(body);
    if (!valid.ok || !valid.value) {
      return NextResponse.json({ error: valid.error || "Invalid preset" }, { status: 400 });
    }

    // The game must exist — a preset for a deleted template is dead weight
    // that would fail at apply time.
    const [game] = await db
      .select({ id: gameDefinitions.id })
      .from(gameDefinitions)
      .where(eq(gameDefinitions.id, valid.value.gameId))
      .limit(1);
    if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

    const [created] = await db
      .insert(serverPresets)
      .values({
        userId: auth.userId,
        name: valid.value.name,
        description: valid.value.description,
        gameId: valid.value.gameId,
        variables: valid.value.variables,
      })
      .returning({ id: serverPresets.id, name: serverPresets.name });

    return NextResponse.json({ ok: true, preset: created });
  } catch (e: unknown) {
    return apiError(e, "Could not save the preset", 500);
  }
}
