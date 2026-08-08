import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !((await hasPermission(auth.userId, "games.view")) || (await hasPermission(auth.userId, "games.templates")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const games = await db.select().from(gameDefinitions);
    return NextResponse.json({ games });
  } catch {
    return NextResponse.json({ games: [] });
  }
}
