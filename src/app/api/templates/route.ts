import { NextRequest, NextResponse } from "next/server";
import { gameTemplates, getTemplatesByCategory } from "@/db/seeds";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

// GET /api/templates - List all available game templates
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !((await hasPermission(auth.userId, "games.templates")) || (await hasPermission(auth.userId, "games.view")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const byCategory = getTemplatesByCategory();
  
  return NextResponse.json({
    templates: gameTemplates.map((t) => ({
      slug: t.slug,
      name: t.name,
      engine: t.engine,
      defaultPort: t.defaultPort,
      steamAppId: t.steamAppId,
      iconEmoji: t.iconEmoji,
      supportsIpv6: t.supportsIpv6,
      category: t.category,
      description: t.description,
      estimatedSize: t.estimatedSize,
      variableCount: t.variables.length,
    })),
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, templates]) => [
        cat,
        templates.map((t) => ({
          slug: t.slug,
          name: t.name,
          iconEmoji: t.iconEmoji,
          description: t.description,
        })),
      ])
    ),
    totalCount: gameTemplates.length,
  });
}
