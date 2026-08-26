/**
 * Guards for the raw SQL console.
 *
 * `pool.query(text)` uses Postgres' simple query protocol, which happily
 * executes several statements in one string. A console of this kind is
 * admin-only on purpose — the guard is about *accidents*, not privilege:
 * a stray semicolon must not turn "delete a row" into "delete a row, drop
 * a table". It also stops a missing timeout from letting `pg_sleep` pin a
 * request (and a pool connection) open for minutes.
 */

/** Reject anything larger: the console is for inspection and small fixes. */
export const MAX_SQL_LENGTH = 32_768;

/** A runaway statement is a bug in the query, not a reason to hang the panel. */
export const SQL_STATEMENT_TIMEOUT_MS = 15_000;

export interface SqlGuardResult {
  ok: boolean;
  error?: string;
}

/**
 * Check that the input is exactly one SQL statement (plus optional trailing
 * comments/whitespace) with balanced quotes.
 *
 * The scanner understands:
 *   'single-quoted strings' ('' escapes), "quoted identifiers",
 *   -- line comments, and C-style block comments,
 *   $tag$ dollar-quoted bodies $tag$, and $1-style parameters.
 */
export function assertSingleStatement(sql: string): SqlGuardResult {
  if (typeof sql !== "string") return { ok: false, error: "SQL must be a string" };
  if (sql.length === 0) return { ok: false, error: "SQL query required" };
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, error: `Query too long (max ${MAX_SQL_LENGTH} characters)` };
  }

  let i = 0;
  let sawAnything = false; // any non-whitespace character seen
  let sawContent = false; // non-whitespace, non-comment content since last ;
  let sawSemicolon = false; // a top-level statement terminator seen

  const skipLineComment = () => {
    while (i < sql.length && sql[i] !== "\n") i++;
  };
  const skipBlockComment = (): boolean => {
    // Called with i at "/*".
    const close = sql.indexOf("*/", i + 2);
    if (close === -1) return false;
    i = close + 2;
    return true;
  };
  const skipQuoted = (quote: string, doubleEscape: boolean): boolean => {
    // Called with i at the opening quote.
    i++;
    while (i < sql.length) {
      if (sql[i] === quote) {
        if (doubleEscape && sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        i++;
        return true;
      }
      if (sql[i] === "\\" && !doubleEscape) {
        // Backslash escapes inside standard strings are Postgres' E'' form;
        // tolerate both by skipping the next char.
        i += 2;
        continue;
      }
      i++;
    }
    return false;
  };
  const skipDollarQuote = (): "ok" | "unterminated" | "not-dollar" => {
    // Called with i at "$". Match $tag$ where tag is [A-Za-z_][A-Za-z0-9_]* or empty.
    const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (!m) return "not-dollar"; // $1 parameter: a single token, no skipping needed
    const tag = m[0];
    const close = sql.indexOf(tag, i + tag.length);
    if (close === -1) return "unterminated";
    i = close + tag.length;
    return "ok";
  };

  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      skipLineComment();
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      if (!skipBlockComment()) return { ok: false, error: "Unterminated block comment" };
      continue;
    }
    if (c === "'") {
      if (!skipQuoted("'", false)) return { ok: false, error: "Unterminated string literal" };
      sawContent = true;
      continue;
    }
    if (c === '"') {
      if (!skipQuoted('"', true)) return { ok: false, error: "Unterminated quoted identifier" };
      sawContent = true;
      continue;
    }
    if (c === "$") {
      const state = skipDollarQuote();
      if (state === "unterminated") {
        return { ok: false, error: "Unterminated dollar-quoted string" };
      }
      sawAnything = true;
      sawContent = true;

      if (state === "not-dollar") {
        // $1 parameter: consume the whole token so digits are not 'content'.
        i++;
        while (i < sql.length && /\d/.test(sql[i])) i++;
        continue;
      }
      continue;
    }
    if (c === ";") {
      if (sawSemicolon) {
        return { ok: false, error: "Only a single SQL statement is allowed per query" };
      }
      sawSemicolon = true;
      sawContent = false;
      i++;
      continue;
    }
    if (!/\s/.test(c)) {
      sawAnything = true;
      sawContent = true;
    }
    i++;
  }

  // Content after a terminator is a second statement; content with no
  // terminator at all is exactly one statement and fine.
  if (sawSemicolon && sawContent) {
    return { ok: false, error: "Only a single SQL statement is allowed per query" };
  }
  if (!sawAnything) {
    return { ok: false, error: "SQL query required" };
  }
  return { ok: true };
}

/** Quote a Postgres identifier the way `SELECT * FROM "name"` needs. */
export function quotePgIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
