import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, roles, gameDefinitions, forumCategories } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

// GET /api/settings/export — Export panel config as JSON
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const [allSettings, allRoles, allGames, allCategories] = await Promise.all([
      db.select().from(settings),
      db.select().from(roles),
      db.select().from(gameDefinitions),
      db.select().from(forumCategories),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      settings: allSettings,
      roles: allRoles,
      gameDefinitions: allGames,
      forumCategories: allCategories,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="gsm-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 500 });
  }
}
