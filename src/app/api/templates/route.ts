import { NextResponse } from "next/server";
import { gameTemplates, getTemplatesByCategory } from "@/db/seeds";

// GET /api/templates - List all available game templates
export async function GET() {
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
