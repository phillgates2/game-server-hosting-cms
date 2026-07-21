import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getTemplateBySlug } from "@/db/seeds";
import { eq } from "drizzle-orm";

// POST /api/templates/[slug]/install - Install a game template to make it available
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { slug } = await params;
  const template = getTemplateBySlug(slug);

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  try {
    // Check if already installed
    const existing = await db
      .select()
      .from(gameDefinitions)
      .where(eq(gameDefinitions.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: "Game already installed" }, { status: 409 });
    }

    // Install the template
    const [game] = await db
      .insert(gameDefinitions)
      .values({
        slug: template.slug,
        name: template.name,
        engine: template.engine,
        defaultPort: template.defaultPort,
        steamAppId: template.steamAppId,
        installScript: template.installScript,
        startCommand: template.startCommand,
        stopCommand: template.stopCommand,
        configFiles: template.configFiles,
        defaultConfig: template.defaultConfig,
        supportsIpv6: template.supportsIpv6,
        iconEmoji: template.iconEmoji,
      })
      .returning();

    return NextResponse.json({
      ok: true,
      message: `${template.name} has been installed and is now available for server creation.`,
      game,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/templates/[slug]/install - Uninstall a game template
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { slug } = await params;

  try {
    await db.delete(gameDefinitions).where(eq(gameDefinitions.slug, slug));
    return NextResponse.json({ ok: true, message: "Game template uninstalled" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
