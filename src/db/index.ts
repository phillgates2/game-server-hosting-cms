import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

// Always cached on globalThis, not just in development: if this module is
// ever instantiated twice (bundler chunk duplication, hot reload), every copy
// must share one pool instead of each opening its own set of connections.
globalForDb.__arenaNextJsPostgresqlPool = pool;

export const db = drizzle(pool);
