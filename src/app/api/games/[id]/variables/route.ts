import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTemplateBySlug } from "@/db/seeds";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

// GET /api/games/[id]/variables — Get template variables for a game
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !((await hasPermission(auth.userId, "games.view")) || (await hasPermission(auth.userId, "games.templates")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
