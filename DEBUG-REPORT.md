# Workspace debug report

Full audit of the panel: build gates, security, correctness, runtime behaviour.

**Result: 11 issues found, 11 fixed.** 2 critical (remote command execution,
SQL injection), 5 high, 3 medium, 1 low.

| Gate | Before | After |
| --- | --- | --- |
| `tsc --noEmit` | clean | clean |
| `eslint` | 5 errors | clean |
| `next build` | succeeds | succeeds |
| `verify:templates` | 0 errors | 0 errors |
| `verify:security` | did not exist | 33/33 |

Run everything with `npm run verify`.

Findings are ordered by severity.

---

## Critical

### C1 — Remote command execution via backup restore ✅ FIXED
`src/app/api/servers/[id]/backup/route.ts`

`body.name` was interpolated straight into a `sh -c` string:

```ts
const backupPath = join(backupDir, backupName);   // backupName = body.name
await runCmd(`tar xzf "${backupPath}" -C "${server.installPath}"`, ...)
```

Posting `{"action":"restore","name":"x.tar.gz\"; id > /tmp/pwned; echo \""}`
produced:

```
tar xzf "/opt/.../gsm-backups/x.tar.gz"; id > /tmp/pwned; echo "" -C "/opt/..."
```

Arbitrary commands ran as the panel user. `join()` also collapsed `../`, so
`name: "../../../../etc/x.tar.gz"` escaped the backup directory entirely.

**Fix:** dropped the shell. `tar` now runs via `execFile` with an argument
array, and backup names are validated against `/^backup-[\w.-]+\.tar\.gz$/`
with a containment check on the resolved path.

### C2 — SQL injection via column names ✅ FIXED
`src/app/api/database/table/[name]/route.ts` (row handler)

The table name was validated against `information_schema`, but column names
from the request body were interpolated raw:

```ts
setClauses.push(`"${key}" = $${idx}`);
```

A key of `x" = 1; DROP TABLE users; --` broke out of the quoted identifier.

**Fix:** every identifier is now validated against the table's real columns
(read from `information_schema`) before use, and double quotes are escaped.
Unknown columns are rejected with a 400.

---

## High

### H1 — Path traversal into sibling directories ✅ FIXED
`src/lib/server-file-ops.ts`

```ts
if (!resolved.startsWith(base)) return null;
```

A prefix test, not a boundary test. With base `/opt/gameservers/mc`, the path
`../mc-evil/secret.txt` resolves to `/opt/gameservers/mc-evil/secret.txt`,
which passes `startsWith` and escapes the sandbox. Affected browse, read,
write, delete, rename and upload.

**Fix:** compare against `base + path.sep` and allow the base itself.

### H2 — Banned and suspended users keep working sessions ✅ FIXED
`src/lib/auth.ts`, `src/lib/permissions.ts`

Status was only checked at login. Tokens last 7 days, so banning a logged-in
user did nothing until their token expired — every API route kept serving them.

**Fix:** `getUserPermissions()` now returns no permissions for non-active
users, and `/api/auth/me` reports the account as inactive so the UI logs out.

### H3 — 2FA is decorative ✅ FIXED
`src/app/api/auth/login/route.ts`

Users could enable TOTP and the panel stored the secret, but the login route
never referenced `twoFactorEnabled`. A password alone always issued a token.

**Fix:** login now requires a valid TOTP code when 2FA is enabled, returning
`{ twoFactorRequired: true }` so the client can prompt. Codes are verified with
the same `otpauth` settings used at enrolment.

### H4 — Hardcoded JWT signing secret ✅ FIXED
`src/lib/auth.ts`

```ts
const JWT_SECRET = process.env.JWT_SECRET || "gsm-panel-secret-change-me-in-production";
```

A deployment that forgets `JWT_SECRET` silently signs tokens with a public
constant, letting anyone forge an admin session.

**Fix:** in production a missing or too-short `JWT_SECRET` throws at startup.
Development falls back to a per-process random secret (tokens do not survive a
restart, which is the safe failure mode).

### H5 — No brute-force protection on login ✅ FIXED
`src/app/api/auth/login/route.ts`

Unlimited password and TOTP guesses per account.

**Fix:** in-process limiter — 10 failures per IP+username within 15 minutes
returns 429. Cleared on success.

---

## Medium

### M1 — Unauthenticated node heartbeat ✅ FIXED
`src/app/api/nodes/[id]/heartbeat/route.ts`

```ts
if (node.apiKey && node.apiKey !== apiKey) { ...401 }
```

A node with no API key set accepted metrics from anyone, letting an
unauthenticated caller flood `node_metrics` and forge node status.

**Fix:** a heartbeat without a configured key is rejected; comparison is
constant-time.

### M2 — Internal error messages leaked to clients ✅ FIXED
Many routes returned `e.message` verbatim, exposing SQL fragments, absolute
paths and driver internals.

**Fix:** added `src/lib/api-error.ts`. Errors are logged server-side and
clients get a generic message; detail is preserved in development.
Applied to the auth, database and backup routes handling untrusted input.

### M3 — React effects trigger cascading renders ✅ FIXED
The 5 outstanding lint errors, in `ForumPanel`, `PublicSite`,
`PublicChatWidget` and `SandboxChat`: `setState` called synchronously in an
effect body, and an effect depending on a `useCallback` that it also
invalidates.

**Fix:** load-on-mount effects now run once against a ref guard, and the
scroll/unread effects were split so state updates happen in callbacks.
`eslint` is clean.

---

## Low / informational

### L1 — `.gitignore` was missing ✅ FIXED (previous turn)
`node_modules`, `.next` and `.env` were all committable.

### L2 — Install script `chown -R $(whoami)` is a no-op
`src/db/games/steamcmd.ts`. Harmless — kept for parity with the original
scripts, already guarded with `|| true`.

### L3 — No DB index on hot lookup columns
`game_servers.user_id`, `audit_log.user_id` and `node_metrics.node_id` are
queried on every dashboard load without an index. Not a correctness problem;
worth addressing if the deployment grows.


---

## Verifying the fixes

`scripts/verify-security.ts` reproduces each vulnerability as an assertion, so a
regression fails CI rather than shipping. It covers path containment, backup
name validation, SQL identifier quoting, the JWT secret policy, and the presence
of the auth-enforcement wiring — 33 checks, no database or HTTP server needed.

```
npm run verify            # typecheck + lint + templates + security
npm run verify:security   # security regressions only
```

The JWT startup guard was additionally confirmed by hand: importing
`src/lib/auth.ts` with `NODE_ENV=production` and no `JWT_SECRET` throws, and a
tampered token fails verification.

## Notes for deployment

`JWT_SECRET` is now mandatory in production — see `.env.example`. Generate one
with `openssl rand -hex 32`. Without it the process exits at startup instead of
silently signing tokens with a publicly known constant.

Login throttling (H5) and the role cache are per-process. That suits the
single-node deployments this panel targets; running multiple instances behind a
load balancer would want both moved into Postgres or Redis.
