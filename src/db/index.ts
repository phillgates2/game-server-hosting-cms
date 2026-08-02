import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsDb?: ReturnType<typeof drizzle>;
};

function getPool() {
  if (globalForDb.__arenaNextJsPostgresqlPool) return globalForDb.__arenaNextJsPostgresqlPool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  }

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
