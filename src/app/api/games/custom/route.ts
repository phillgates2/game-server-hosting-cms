import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError, isUniqueViolation } from "@/lib/api-error";
import { toValidSlug } from "@/lib/slug";

// POST /api/games/custom — Create a fully custom game definition
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || (!(await hasPermission(auth.userId, "games.create_custom")) && !(await hasPermission(auth.userId, "games.install")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, slug, engine, defaultPort, steamAppId, installScript, startCommand, stopCommand, configFiles, defaultConfig, supportsIpv6, iconEmoji } = body;

    if (!name || !slug || !defaultPort || !installScript || !startCommand) {
      return NextResponse.json({ error: "Name, slug, default port, install script, and start command are required" }, { status: 400 });
    }

    // Validate the normalized slug, not the raw input: "-" and "   " both
    // pass the required-field check above and then normalize to "".
    const finalSlug = toValidSlug(slug);
    if (!finalSlug) {
      return NextResponse.json(
        { error: "Slug must contain at least one letter or number" },
        { status: 400 }
      );
    }

    // Number() alone accepted "abc" (NaN → driver error), "1.5" (float →
    // driver error) and negative or >65535 ports on their way to the db.
    const defaultPortNumber = Number(defaultPort);
    if (!Number.isInteger(defaultPortNumber) || defaultPortNumber < 1 || defaultPortNumber > 65535) {
      return NextResponse.json({ error: "defaultPort must be a port number (1-65535)" }, { status: 400 });
    }

    const existing = await db.select().from(gameDefinitions).where(eq(gameDefinitions.slug, finalSlug)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: `Slug "${finalSlug}" already exists` }, { status: 409 });
    }

    let game;
    try {
      [game] = await db.insert(gameDefinitions).values({
        slug: finalSlug,
        name,
        engine: engine || null,
        defaultPort: defaultPortNumber,
        steamAppId: steamAppId || null,
        installScript,
        startCommand,
        stopCommand: stopCommand || null,
        configFiles: configFiles || {},
        defaultConfig: defaultConfig || {},
        supportsIpv6: supportsIpv6 || false,
        iconEmoji: iconEmoji || "🎮",
      }).returning();
    } catch (e: unknown) {
      // The check above is a race: two parallel creates of the same slug can
      // both pass it, and the unique index is what actually arbitrates.
      if (isUniqueViolation(e)) {
        return NextResponse.json({ error: `Slug "${finalSlug}" already exists` }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({ game }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
