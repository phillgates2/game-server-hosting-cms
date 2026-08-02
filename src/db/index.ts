import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsDb?: ReturnType<typeof drizzle>;
  __arenaNextJsDatabaseUrl?: string;
};

function getPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (
    globalForDb.__arenaNextJsPostgresqlPool &&
    globalForDb.__arenaNextJsDatabaseUrl === databaseUrl
  ) {
    return globalForDb.__arenaNextJsPostgresqlPool;
  }

  if (globalForDb.__arenaNextJsPostgresqlPool) {
    void globalForDb.__arenaNextJsPostgresqlPool.end().catch(() => undefined);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  globalForDb.__arenaNextJsDatabaseUrl = databaseUrl;
  globalForDb.__arenaNextJsDb = undefined;

  return pool;
}

export const pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    return Reflect.get(getPool(), prop, receiver);
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getPool(), prop, value, receiver);
  },
  has(_target, prop) {
    return prop in getPool();
  },
  ownKeys(_target) {
    return Reflect.ownKeys(getPool());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getPool(), prop);
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getDb(), prop, value, receiver);
  },
  has(_target, prop) {
    return prop in getDb();
  },
  ownKeys(_target) {
    return Reflect.ownKeys(getDb());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getDb(), prop);
  },
});

function getDb() {
  if (globalForDb.__arenaNextJsDb) return globalForDb.__arenaNextJsDb;

  const createdDb = drizzle(getPool());
  globalForDb.__arenaNextJsDb = createdDb;
  return createdDb;
}
