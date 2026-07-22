import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// GET /api/games/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [game] = await db.select().from(gameDefinitions).where(eq(gameDefinitions.id, Number(id))).limit(1);
    if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ game });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// PATCH /api/games/[id] — Edit an installed game definition
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "games.install"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.engine !== undefined) update.engine = body.engine;
    if (body.defaultPort !== undefined) update.defaultPort = Number(body.defaultPort);
    if (body.steamAppId !== undefined) update.steamAppId = body.steamAppId || null;
    if (body.installScript !== undefined) update.installScript = body.installScript;
    if (body.startCommand !== undefined) update.startCommand = body.startCommand;
    if (body.stopCommand !== undefined) update.stopCommand = body.stopCommand || null;
    if (body.configFiles !== undefined) update.configFiles = body.configFiles;
    if (body.defaultConfig !== undefined) update.defaultConfig = body.defaultConfig;
    if (body.supportsIpv6 !== undefined) update.supportsIpv6 = body.supportsIpv6;
    if (body.iconEmoji !== undefined) update.iconEmoji = body.iconEmoji;

    const [updated] = await db.update(gameDefinitions).set(update).where(eq(gameDefinitions.id, Number(id))).returning();
    return NextResponse.json({ game: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// POST /api/games — Create a fully custom game definition (not from template)
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "games.install"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, slug, engine, defaultPort, installScript, startCommand } = body;

    if (!name || !slug || !defaultPort || !installScript || !startCommand) {
      return NextResponse.json({ error: "name, slug, defaultPort, installScript, startCommand required" }, { status: 400 });
    }

    const finalSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    const existing = await db.select().from(gameDefinitions).where(eq(gameDefinitions.slug, finalSlug)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: "A game with this slug already exists" }, { status: 409 });
    }

    const [game] = await db.insert(gameDefinitions).values({
      slug: finalSlug,
      name,
      engine: engine || null,
      defaultPort: Number(defaultPort),
      steamAppId: body.steamAppId || null,
      installScript,
      startCommand,
      stopCommand: body.stopCommand || null,
      configFiles: body.configFiles || {},
      defaultConfig: body.defaultConfig || {},
      supportsIpv6: body.supportsIpv6 || false,
      iconEmoji: body.iconEmoji || "🎮",
    }).returning();

    return NextResponse.json({ game }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
