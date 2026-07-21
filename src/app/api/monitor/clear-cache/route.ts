import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clearBufferCache, getMemoryInfo } from "@/lib/monitor";
import { db } from "@/db";
import { monitorClearEvents } from "@/db/schema";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const level = ([1, 2, 3].includes(body.level) ? body.level : 3) as 1 | 2 | 3;
    const trigger = body.trigger || "manual";

    const before = getMemoryInfo();
    const result = clearBufferCache(level);

    // Log the event
    try {
      await db.insert(monitorClearEvents).values({
        trigger,
        ramBeforeMb: result.before.usedMb,
        buffersBeforeMb: result.before.buffersMb,
        cachedBeforeMb: result.before.cachedMb,
        ramAfterMb: result.after.usedMb,
        buffersAfterMb: result.after.buffersMb,
        cachedAfterMb: result.after.cachedMb,
        freedMb: result.freedMb,
        clearLevel: level,
        status: result.success ? "success" : "error",
        errorLog: result.error || null,
        userId: user.userId,
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Clear cache failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
