import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { desc, gt, eq, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("chat");

// GET /api/forum/chat — fetch recent messages (with optional ?after=<id> for polling)
// Public: anyone can read chat messages (guests see read-only view)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const afterId = url.searchParams.get("after");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "50", 10) || 50, 1), 200);

  try {
    let query = db
      .select({
        id: chatMessages.id,
        body: chatMessages.body,
        createdAt: chatMessages.createdAt,
        userId: chatMessages.userId,
        username: users.username,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.userId, users.id))
      .orderBy(desc(chatMessages.id))
      .limit(limit)
      .$dynamic();

    if (afterId) {
      const aid = parseInt(afterId, 10);
      if (!isNaN(aid)) {
        query = query.where(gt(chatMessages.id, aid));
      }
    }

    const rows = await query;

    // Count online users (users who sent a message in the last 5 minutes)
    const onlineResult = await db
      .select({ count: sql<number>`count(distinct ${chatMessages.userId})::int` })
      .from(chatMessages)
      .where(gt(chatMessages.createdAt, sql`now() - interval '5 minutes'`));

    return NextResponse.json({
      messages: rows.reverse(), // oldest first
      onlineCount: onlineResult[0]?.count ?? 0,
    });
  } catch (e: unknown) {
    log.exception("failed to list messages", e);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}

// POST /api/forum/chat — send a new message (requires forum.post permission)
export async function POST(req: NextRequest) {
  const authUser = await getCurrentUser(req.headers);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check forum.post permission
  if (!(await hasPermission(authUser.userId, "forum.post"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { body } = await req.json();
    if (!body || typeof body !== "string" || body.trim().length === 0) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    }
    if (body.trim().length > 1000) {
      return NextResponse.json({ error: "Message too long (max 1000 chars)" }, { status: 400 });
    }

    const [msg] = await db
      .insert(chatMessages)
      .values({
        userId: authUser.userId,
        body: body.trim(),
      })
      .returning();

    // Fetch full message with user info
    const [full] = await db
      .select({
        id: chatMessages.id,
        body: chatMessages.body,
        createdAt: chatMessages.createdAt,
        userId: chatMessages.userId,
        username: users.username,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.userId, users.id))
      .where(eq(chatMessages.id, msg.id));

    return NextResponse.json({ message: full });
  } catch (e: unknown) {
    log.exception("failed to post a message", e);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

// DELETE /api/forum/chat — delete a message (own message or forum.delete_any permission)
export async function DELETE(req: NextRequest) {
  const authUser = await getCurrentUser(req.headers);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { messageId } = await req.json();
    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    // Check ownership or moderation permissions
    const [msg] = await db
      .select({ userId: chatMessages.userId })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId));

    if (!msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Check if user can delete: own message with forum.delete_own, or any message with forum.delete_any/moderate
    const isOwner = msg.userId === authUser.userId;
    const canDeleteAny = await hasPermission(authUser.userId, "forum.delete_any") || 
                         await hasPermission(authUser.userId, "forum.moderate");
    const canDeleteOwn = await hasPermission(authUser.userId, "forum.delete_own");

    if (!canDeleteAny && !(isOwner && canDeleteOwn)) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    await db.delete(chatMessages).where(eq(chatMessages.id, messageId));

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    log.exception("failed to delete a message", e);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
