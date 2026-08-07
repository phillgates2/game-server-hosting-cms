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
    const source = getPool();
    const value = Reflect.get(source, prop, source);
    if (typeof value === "function") {
      return value.bind(source);
    }
    return value;
  },
  set(_target, prop, value, receiver) {
    const source = getPool();
    return Reflect.set(source, prop, value, source);
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
    const source = getDb();
    const value = Reflect.get(source, prop, source);
    if (typeof value === "function") {
      return value.bind(source);
    }
    return value;
  },
  set(_target, prop, value, receiver) {
    const source = getDb();
    return Reflect.set(source, prop, value, source);
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
