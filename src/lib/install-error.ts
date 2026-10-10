/** Public installer diagnostics: never return SQL, credentials or driver messages. */
export function installErrorMessage(error: unknown, stage: string): string {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, cause } = current as { code?: string; cause?: unknown };
    switch (code) {
      case "28P01":
      case "28000":
        return "Database authentication failed. Check DATABASE_URL in the panel's .env file, then restart the panel and retry.";
      case "ECONNREFUSED":
      case "ENOTFOUND":
      case "EHOSTUNREACH":
      case "ETIMEDOUT":
      case "3D000":
        return "Cannot connect to the panel database. Check that PostgreSQL is running and that DATABASE_URL points to an existing, reachable database.";
      case "42501":
        return "The database user lacks permission to complete setup. Check its ownership of the panel database and permission to create tables or change its password.";
      case "42703":
      case "42P01":
        return "The panel database schema is out of date or incomplete. Run the panel update/migration procedure, then retry setup.";
      case "23505":
        return "Setup conflicts with an existing database record. Check whether the admin username or email is already in use before retrying.";
      case "EACCES":
      case "EROFS":
        return "Setup cannot write the panel's .env file. Check its directory permissions, or leave Database Password blank to keep the existing password.";
    }
    current = cause;
  }
  return `Installation failed during ${stage}. Check the panel server logs (PM2: pm2 logs gsm-panel --lines 100 --nostream) for the cause, then retry. Do not share passwords or master keys from your configuration.`;
}
