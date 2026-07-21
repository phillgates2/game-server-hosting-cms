import { NextResponse } from "next/server";
import { db } from "@/db";
import { games } from "@/db/schema";
import { GAME_TEMPLATES } from "@/lib/game-installer";

export async function GET() {
  try {
    const allGames = await db.select().from(games);
    // Enrich with emoji from templates
    const enriched = allGames.map(g => {
      const tmpl = GAME_TEMPLATES.find(t => t.slug === g.slug);
      return { ...g, iconEmoji: tmpl?.iconEmoji || "🎮" };
    });
    return NextResponse.json({ games: enriched });
  } catch {
    return NextResponse.json({ games: [] });
  }
}
