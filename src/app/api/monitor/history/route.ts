import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { monitorClearEvents } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const events = await db.select().from(monitorClearEvents).orderBy(desc(monitorClearEvents.createdAt)).limit(50);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
