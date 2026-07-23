import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTemplateBySlug } from "@/db/seeds";

// GET /api/games/[id]/variables — Get template variables for a game
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [game] = await db.select({ slug: gameDefinitions.slug }).from(gameDefinitions).where(eq(gameDefinitions.id, Number(id))).limit(1);
    if (!game) return NextResponse.json({ variables: [] });

    const tmpl = getTemplateBySlug(game.slug);
    if (!tmpl) return NextResponse.json({ variables: [] });

    return NextResponse.json({ variables: tmpl.variables || [] });
  } catch {
    return NextResponse.json({ variables: [] });
  }
}
