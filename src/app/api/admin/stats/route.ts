import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, gameServers, nodes, games, forumTopics, tickets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { sql } from "drizzle-orm";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [serverCount] = await db.select({ count: sql<number>`count(*)` }).from(gameServers);
  const [nodeCount] = await db.select({ count: sql<number>`count(*)` }).from(nodes);
  const [gameCount] = await db.select({ count: sql<number>`count(*)` }).from(games);
  const [topicCount] = await db.select({ count: sql<number>`count(*)` }).from(forumTopics);

  let ticketCountNum = 0;
  try {
    const [tc] = await db.select({ count: sql<number>`count(*)` }).from(tickets);
    ticketCountNum = Number(tc.count);
  } catch {
    ticketCountNum = 0;
  }

  return NextResponse.json({
    stats: {
      users: Number(userCount.count),
      servers: Number(serverCount.count),
      nodes: Number(nodeCount.count),
      games: Number(gameCount.count),
      topics: Number(topicCount.count),
      tickets: ticketCountNum,
    },
  });
}
