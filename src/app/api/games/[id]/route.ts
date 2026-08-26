import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

// GET /api/games/[id] — Full game definition
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
    const [game] = await db.select().from(gameDefinitions).where(eq(gameDefinitions.id, Number(id))).limit(1);
    if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ game });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}

// PATCH /api/games/[id] — Edit installed game definition
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !((await hasPermission(auth.userId, "games.edit")) || (await hasPermission(auth.userId, "games.install")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const canEditScripts = (await hasPermission(auth.userId, "games.edit.scripts")) || (await hasPermission(auth.userId, "games.install"));
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 128) return NextResponse.json({ error: "name is required (max 128 characters)" }, { status: 400 });
      update.name = name;
    }
    if (body.engine !== undefined) update.engine = String(body.engine ?? "").slice(0, 64) || null;
    if (body.defaultPort !== undefined) {
      // Number() alone accepted "abc" (NaN → driver error) and "1.5".
      const port = Number(body.defaultPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return NextResponse.json({ error: "defaultPort must be a port number (1-65535)" }, { status: 400 });
      }
      update.defaultPort = port;
    }
    if (body.steamAppId !== undefined) update.steamAppId = body.steamAppId ? String(body.steamAppId).slice(0, 32) : null;
    if (body.installScript !== undefined) {
      if (!canEditScripts) return NextResponse.json({ error: "games.edit.scripts permission required" }, { status: 403 });
      update.installScript = String(body.installScript ?? "");
    }
    if (body.startCommand !== undefined) {
      if (!canEditScripts) return NextResponse.json({ error: "games.edit.scripts permission required" }, { status: 403 });
      update.startCommand = String(body.startCommand ?? "");
    }
    if (body.stopCommand !== undefined) {
      if (!canEditScripts) return NextResponse.json({ error: "games.edit.scripts permission required" }, { status: 403 });
      update.stopCommand = body.stopCommand ? String(body.stopCommand) : null;
    }
    if (body.configFiles !== undefined) update.configFiles = body.configFiles;
    if (body.defaultConfig !== undefined) update.defaultConfig = body.defaultConfig;
    if (body.supportsIpv6 !== undefined) update.supportsIpv6 = body.supportsIpv6 === true || body.supportsIpv6 === "true";
    if (body.iconEmoji !== undefined) update.iconEmoji = String(body.iconEmoji || "🎮").slice(0, 8);

    const [updated] = await db.update(gameDefinitions).set(update).where(eq(gameDefinitions.id, Number(id))).returning();
    return NextResponse.json({ game: updated });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
