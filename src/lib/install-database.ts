import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { escapeIdentifier, escapeLiteral, type Pool } from "pg";

export function databasePasswordChange(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username) {
    throw new Error("DATABASE_URL must specify a PostgreSQL user");
  }
  if (!password || /[\0\r\n]/.test(password)) {
    throw new Error("Database password must be nonempty and cannot contain NUL or line breaks");
  }
  const role = decodeURIComponent(url.username);
  // URL setters leave literal percent signs alone; encode first so pg can
  // decode credentials such as "%" and "%40" without corruption.
  url.password = encodeURIComponent(password);
  return {
    databaseUrl: url.toString(),
    // ALTER ROLE is a utility statement: PostgreSQL does NOT accept $1 here.
    // Quote both the configured role and the password, never interpolate raw input.
    statement: `ALTER ROLE ${escapeIdentifier(role)} WITH PASSWORD ${escapeLiteral(password)}`,
  };
}

async function atomicWrite(file: string, contents: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Rotate only after setup's database work has finished. No PM2 restart is needed:
 * existing sessions stay authenticated and new pool connections use the new URL.
 */
export async function changeInstallDatabasePassword(pool: Pool, password: string, envPath: string) {
  const change = databasePasswordChange(process.env.DATABASE_URL || "", password);
  let previous: string | null = null;
  try {
    previous = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const contents = (previous ?? "").split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line));
  contents.push(`DATABASE_URL=${change.databaseUrl}`);

  const client = await pool.connect();
  let written = false;
  try {
    await client.query("BEGIN");
    await client.query(change.statement);
    // If persistence fails, roll back the role change rather than locking out
    // the panel on its next connection/restart.
    await atomicWrite(envPath, `${contents.join("\n")}\n`);
    written = true;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (written) {
      if (previous === null) await fs.rm(envPath, { force: true });
      else await atomicWrite(envPath, previous);
    }
    throw error;
  } finally {
    client.release();
  }
  pool.options.connectionString = change.databaseUrl;
  pool.options.password = password;
  process.env.DATABASE_URL = change.databaseUrl;
}
