/**
 * Token → public status lookup, shared by the anonymous JSON endpoint and
 * the public status page so they cannot drift apart.
 *
 * Returns null for anything unknown; callers answer 404. The select list is
 * deliberately minimal — see the comment on the query.
 */

import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidStatusToken, publicStatusPayload, type PublicServerStatus } from "./status-share";

export async function lookupPublicStatus(token: string): Promise<PublicServerStatus | null> {
  if (!isValidStatusToken(token)) return null;

  const [server] = await db
    .select({
      // Only the fields the public payload needs. Selecting anything more —
      // file paths, rendered configs, webhooks, ids — here would be a leak
      // waiting to happen, so the query itself is the first line of defence.
      name: gameServers.name,
      status: gameServers.status,
      gameSlug: gameDefinitions.slug,
      gameName: gameDefinitions.name,
      ipv4: gameServers.ipv4,
      port: gameServers.port,
      queryPort: gameServers.queryPort,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(eq(gameServers.statusToken, token))
    .limit(1);

  if (!server) return null;

  // The stored process flag can lag after a crash; the probe settles it.
  const { probePlayers } = await import("@/lib/players");
  const probe = await probePlayers({
    gameSlug: server.gameSlug ?? "",
    host: server.ipv4 ?? "127.0.0.1",
    port: server.port,
    queryPort: server.queryPort,
    attempts: 1,
    timeoutMs: 1500,
  });

  return publicStatusPayload({
    name: server.name,
    gameName: server.gameName,
    running: server.status === "running",
    probe,
  });
}

/** Hard cap: a huge fleet must not turn the public page into a probe storm. */
export const MAX_PUBLIC_LIST_SERVERS = 24;

async function ensureStatusPublicColumn(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS status_public BOOLEAN DEFAULT FALSE`);
}

/**
 * Every server opted in to the public listing, probed in parallel and shaped
 * with the same whitelisted payload as the token links. Anonymous by design;
 * the select list is the privacy line again — nothing internal is queried.
 */
export async function lookupPublicList(): Promise<PublicServerStatus[]> {
  await ensureStatusPublicColumn();

  const rows = await db
    .select({
      name: gameServers.name,
      status: gameServers.status,
      gameSlug: gameDefinitions.slug,
      gameName: gameDefinitions.name,
      ipv4: gameServers.ipv4,
      port: gameServers.port,
      queryPort: gameServers.queryPort,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(eq(gameServers.statusPublic, true))
    .orderBy(gameServers.name)
    .limit(MAX_PUBLIC_LIST_SERVERS);

  const { probePlayers } = await import("@/lib/players");
  const results = await Promise.all(
    rows.map(async (server) => {
      const probe = await probePlayers({
        gameSlug: server.gameSlug ?? "",
        host: server.ipv4 ?? "127.0.0.1",
        port: server.port,
        queryPort: server.queryPort,
        attempts: 1,
        timeoutMs: 1500,
      }).catch(() => ({ ok: false }));
      return publicStatusPayload({
        name: server.name,
        gameName: server.gameName,
        running: server.status === "running",
        probe,
      });
    })
  );
  return results;
}
