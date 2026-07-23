import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// POST /api/games/custom — Create a fully custom game definition
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "games.install"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, slug, engine, defaultPort, steamAppId, installScript, startCommand, stopCommand, configFiles, defaultConfig, supportsIpv6, iconEmoji } = body;

    if (!name || !slug || !defaultPort || !installScript || !startCommand) {
      return NextResponse.json({ error: "Name, slug, default port, install script, and start command are required" }, { status: 400 });
    }

    const finalSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "");

    const existing = await db.select().from(gameDefinitions).where(eq(gameDefinitions.slug, finalSlug)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: `Slug "${finalSlug}" already exists` }, { status: 409 });
    }

    const [game] = await db.insert(gameDefinitions).values({
      slug: finalSlug,
      name,
      engine: engine || null,
      defaultPort: Number(defaultPort),
      steamAppId: steamAppId || null,
      installScript,
      startCommand,
      stopCommand: stopCommand || null,
      configFiles: configFiles || {},
      defaultConfig: defaultConfig || {},
      supportsIpv6: supportsIpv6 || false,
      iconEmoji: iconEmoji || "🎮",
    }).returning();

    return NextResponse.json({ game }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
