import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, users, forumThreads, cmsPages, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ilike, or } from "drizzle-orm";

// GET /api/search?q=term — Global search across servers, users, games, forum, CMS, nodes
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const pattern = `%${q}%`;

  try {
    const [srvResults, userResults, gameResults, threadResults, cmsResults, nodeResults] = await Promise.allSettled([
      db.select({ id: gameServers.id, name: gameServers.name, status: gameServers.status, gameName: gameDefinitions.name, gameIcon: gameDefinitions.iconEmoji })
        .from(gameServers).leftJoin(gameDefinitions, ilike(gameServers.name, pattern)).where(ilike(gameServers.name, pattern)).limit(5),
      db.select({ id: users.id, username: users.username, email: users.email, role: users.role })
        .from(users).where(or(ilike(users.username, pattern), ilike(users.email, pattern))).limit(5),
      db.select({ id: gameDefinitions.id, name: gameDefinitions.name, slug: gameDefinitions.slug, iconEmoji: gameDefinitions.iconEmoji })
        .from(gameDefinitions).where(or(ilike(gameDefinitions.name, pattern), ilike(gameDefinitions.slug, pattern))).limit(5),
      db.select({ id: forumThreads.id, title: forumThreads.title })
        .from(forumThreads).where(ilike(forumThreads.title, pattern)).limit(5),
      db.select({ id: cmsPages.id, title: cmsPages.title, slug: cmsPages.slug, type: cmsPages.type })
        .from(cmsPages).where(or(ilike(cmsPages.title, pattern), ilike(cmsPages.slug, pattern))).limit(5),
      db.select({ id: nodes.id, name: nodes.name, hostname: nodes.hostname, status: nodes.status })
        .from(nodes).where(or(ilike(nodes.name, pattern), ilike(nodes.hostname, pattern))).limit(5),
    ]);

    const results: Array<{ type: string; icon: string; id: number; title: string; subtitle: string }> = [];

    if (srvResults.status === "fulfilled") {
      for (const s of srvResults.value) results.push({ type: "server", icon: (s.gameIcon as string) || "🎮", id: s.id, title: s.name, subtitle: `Server · ${s.status}` });
    }
    if (userResults.status === "fulfilled") {
      for (const u of userResults.value) results.push({ type: "user", icon: "👤", id: u.id, title: u.username, subtitle: `User · ${u.role}` });
    }
    if (gameResults.status === "fulfilled") {
      for (const g of gameResults.value) results.push({ type: "game", icon: g.iconEmoji || "📦", id: g.id, title: g.name, subtitle: `Game · ${g.slug}` });
    }
    if (threadResults.status === "fulfilled") {
      for (const t of threadResults.value) results.push({ type: "thread", icon: "💬", id: t.id, title: t.title, subtitle: "Forum Thread" });
    }
    if (cmsResults.status === "fulfilled") {
      for (const c of cmsResults.value) results.push({ type: "cms", icon: "✍️", id: c.id, title: c.title, subtitle: `CMS · ${c.type}` });
    }
    if (nodeResults.status === "fulfilled") {
      for (const n of nodeResults.value) results.push({ type: "node", icon: "🌐", id: n.id, title: n.name, subtitle: `Node · ${n.status}` });
    }

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
