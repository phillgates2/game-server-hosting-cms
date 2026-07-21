import { NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";

export async function GET() {
  try {
    const games = await db.select({
      id: gameDefinitions.id,
      slug: gameDefinitions.slug,
      name: gameDefinitions.name,
      engine: gameDefinitions.engine,
      defaultPort: gameDefinitions.defaultPort,
      steamAppId: gameDefinitions.steamAppId,
      iconEmoji: gameDefinitions.iconEmoji,
      supportsIpv6: gameDefinitions.supportsIpv6,
      createdAt: gameDefinitions.createdAt,
    }).from(gameDefinitions);
    return NextResponse.json({ games });
  } catch {
    return NextResponse.json({ games: [] });
  }
}
