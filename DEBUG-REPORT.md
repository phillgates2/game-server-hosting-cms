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

---

# Second sweep — full panel debug

A later pass over the whole panel, after the Discord work. The first sweep
looked for vulnerabilities; this one asked a different question: **does every
setting the interface offers actually do what it says?**

Four issues, all of them features that were already visible to users.

**Result: 4 found, 4 fixed.** 1 high (privilege escalation), 3 medium
(advertised settings that did nothing).

| Gate | Before | After |
| --- | --- | --- |
| `npm test` | 133 | 154 |
| `verify:security` | 63/63 | 67/67 |
| `shellcheck -S warning public/*.sh` | 3 warnings | clean |
| `next build` | succeeds | succeeds |

---

## High

### H1 — Mass assignment on `PATCH /api/servers/[id]` ✅ FIXED
`src/app/api/servers/[id]/route.ts`

The handler merged the request body straight into the row:

```ts
.set({ ...body, updatedAt: new Date() })
```

Every column was therefore client-writable. Two of them matter:

- **`installPath`** is joined with `gsm-start.sh` and executed by the process
  route. Rewriting it and pressing *Start* runs an arbitrary script.
- **`userId`** reassigns ownership, so a server can be moved to another account.

`pid`, `discordChannelId`, `id` and the timestamps were writable too, enough to
corrupt process tracking and detach a Discord channel from its cleanup.

This needed the `servers.edit` permission, so it is privilege escalation rather
than an unauthenticated hole — but `servers.edit` is a routine permission that
a panel owner would hand to a helper without expecting it to imply shell access.

Fixed with an explicit allowlist (`pickServerPatch`). Unknown fields are
rejected with a `400` rather than ignored, so a genuine client bug is visible
instead of silent. No client code ever used the endpoint — it had no callers at
all — so nothing legitimate was constrained by tightening it.

---

## Medium

### M1 — `autoRestart` never restarted anything ✅ FIXED
`src/app/api/servers/[id]/process/route.ts`

Every server card showed an **"Auto-restart on/off"** badge. The column was
stored, displayed, copied on clone — and read by no logic anywhere. A crashed
server stayed down whatever the badge said.

The status poll already detected crashes (it fired the Discord notification),
so the missing half was the recovery. It now relaunches the server, updates
status/pid/lastStarted, and sends `server_restarted` honouring
`discordNotifyRestart`.

Two details that matter in practice:

- The whole block is wrapped so a failed recovery cannot break the status poll;
  a server that will not come back must not also freeze the dashboard.
- **Concurrency.** The poller runs in the browser, every 15 s, per tab. Two open
  tabs would both observe the same crash and both spawn a replacement, leaving
  an orphan holding the port. An in-flight guard keeps one recovery per server.

### M2 — `autoStart` was a dead column ✅ FIXED
`src/db/schema.ts:151`, `src/instrumentation.ts`

`autoStart` — commented *"Start on node boot"* — was written in exactly one
place (the clone route, always `false`) and read nowhere. No UI, no API field,
no consumer.

Implemented rather than removed, because a hosting panel that cannot bring
servers back after a reboot is missing something people assume works. A Next.js
`instrumentation.ts` hook relaunches flagged servers on local nodes, skipping
any whose recorded PID is still alive so a panel restart does not double-start.

Two constraints found while building it:

- `instrumentation.ts` is bundled for the **edge** runtime as well as Node, and
  edge cannot resolve `node:path` or `child_process`. The runtime guard alone
  does not prevent the bundling error; the Node-only half lives in a separate
  module that is dynamically imported.
- The hook must not fire during `next build`, or building the project would
  start game servers.

Scoped with `nodes.isLocal`, matching the process route's existing refusal to
manage remote nodes.

### M3 — Cloning stole the original's Discord channel ✅ FIXED
`src/app/api/servers/[id]/clone/route.ts`

The clone copied `discordWebhook` but not `discordChannelId`. So the clone
posted into a channel that the *source* owned and the panel believed belonged
only to the source. Deleting the **original** deleted that channel, and the
clone was left posting into a webhook returning 404 — with no error surfaced
anywhere, because webhook sends are deliberately non-throwing.

A clone now inherits only a hand-entered webhook (nobody owns those) and
otherwise provisions its own channel, mirroring the create path.

---

## Low

### L1 — Dead code in the shell installers ✅ FIXED
`public/install.sh`, `public/update.sh`

`NPM_EXIT=${PIPESTATUS[0]:-$?}` sits immediately after a command ending in
`|| true`, so it captured the exit status of `true` — always `0`. The variable
was never read, which is the only reason this was harmless: the error handling
written around it could never have fired. The real check (`test -d
node_modules/next`) is sound and was left alone.

Also a `SERVER_LAN_IP` computed and then overwritten before any read, and two
unused loop counters. All five shipped scripts are now shellcheck-clean.

---

## Verifying

The two behavioural rules were extracted into `src/lib/server-lifecycle.ts` —
pure functions, no database — and the routes call them, so the tests exercise
the shipping path rather than a copy. Reverting either fix turns the suite red;
this was confirmed by actually reintroducing each bug.

```
npm run verify   # 154 tests, 1551 options / 27 games, 67 security checks
```

Four new security checks pin these: the clone must not inherit a provisioned
channel, `autoRestart` must reach `startDetachedScript`, PATCH must filter
through the allowlist, and `installPath`/`userId` must stay off it.

## Theme

Every issue in this sweep was a **control with nothing behind it** — a badge, a
toggle, a column — rather than a crash or a bad algorithm. Type checking, lint
and the test suite were all green throughout, because none of them can see that
a stored value is never read. The check that found three of the four was
mechanical and worth repeating: for each column, compare the set of places that
write it against the set that read it.

---

# Third sweep — full workspace debug

A third pass, this time over the whole workspace rather than a feature area.
The previous sweep asked whether every setting did what it claimed; this one
asked **what leaves the server**, on the theory that the panel stores real
credentials and the response shape is easy to get wrong.

**Result: 3 found, 3 fixed.** 2 high (credential disclosure), 1 low.

| Gate | Before | After |
| --- | --- | --- |
| `npm test` | 154 | 165 |
| `verify:security` | 67/67 | 73/73 |
| `npm audit --omit=dev` | 0 vulns | 0 vulns |
| `shellcheck` | clean | clean |
| `next build` | succeeds | succeeds |

---

## High

### H1 — SSH credentials returned to any moderator ✅ FIXED
`src/app/api/nodes/[id]/route.ts`

```ts
const [node] = await db.select().from(nodes)...   // no projection
return NextResponse.json({ node, servers });      // whole row
```

The `nodes` table stores `sshUser`, `sshKeyPath`, `sshPassword` and a per-node
`apiKey`. A bare `select()` returns all 27 columns, so the JSON response
carried the **SSH login for that machine in plaintext**.

The gate is `nodes.view`. That is not an admin-only permission — the built-in
**moderator** role is granted it by default (`src/lib/permissions.ts:250`). So
every moderator could read the root password for every node and SSH in
directly, bypassing the panel and every permission in it.

Worth noting what was *already* right, because it shows the fix was a
consistency problem rather than an unknown one: the list endpoint at
`/api/nodes` was written with an explicit 18-column projection and never leaked
anything. Only the detail route and the two create routes returned the raw row.

Both create routes echoed `.returning()` straight back, handing the caller the
credentials they had just submitted — less severe, but the same mistake.

Fixed with `publicNode()` on every path that returns a node.

### H2 — Password hash and 2FA secret returned on user update ✅ FIXED
`src/app/api/users/[id]/route.ts`

The admin `PATCH` builds its update field-by-field with a **separate permission
check on each field** — `users.suspend` for status, `users.limits` for quotas,
`users.reset_password` for passwords. That part is carefully written. It then
ends in:

```ts
const [updated] = await db.update(users).set(updateData)...returning();
return NextResponse.json({ user: updated });
```

`.returning()` yields every column, so the response contained `passwordHash`
and `twoFactorSecret`.

The TOTP seed is the serious half: it is the shared secret behind the user's
authenticator app, so anyone holding it can mint the same six-digit codes on
demand. Leaking it defeats 2FA for that account completely — and it leaks
precisely when an admin edits the account, which is a routine action.

The `GET` on the same route already used an explicit projection listing the
safe columns. The correct shape was in the file; it just was not applied to the
write path.

---

## Low

### L1 — Schema comment claimed encryption that does not exist ✅ FIXED
`src/db/schema.ts`

```ts
sshPassword: text("ssh_password"), // encrypted
```

Nothing in the codebase encrypts anything. There is no cipher, no key
derivation, no helper — a repo-wide search for `encrypt|createCipheriv|aes-`
returns nothing. The value is stored and read as plaintext.

A comment that overstates a protection is worse than no comment: it invites
someone to treat the column as safe. Corrected to state the actual position and
to recommend `sshKeyPath` instead.

---

## Checked and found clean

Recording these so the next sweep does not redo them:

- **Command injection** — no `execSync`, no `exec()`, no `shell: true`. All
  four `spawn` sites pass an argument array.
- **XSS** — no `dangerouslySetInnerHTML` anywhere in the tree.
- **Unauthenticated routes** — 6 of 65. `login`, `logout`, `register`,
  `health` and `install-script` are intentionally public; the node `heartbeat`
  is protected by a constant-time API-key comparison.
- **Mass assignment** — after this sweep and the last, `.set({ ...body })`
  appears nowhere.
- **Other `.returning()` calls** — 26 routes; the API key route is correct
  (explicit projection, hash never returned, raw secret shown once by design)
  and the remaining tables hold no secrets.
- **Permission system** — fails closed on unknown user, denies everything for
  a non-active account (so suspending a signed-in user takes effect on the next
  request rather than at token expiry), and the 30-second role cache is
  invalidated by every one of the six routes that mutate a role.
- **Retention** — prunes both metrics tables and the audit log on configurable
  windows, `0` disables.
- **Dependencies** — `npm audit --omit=dev` reports 0 vulnerabilities.
- **Shell scripts** — all five shellcheck-clean at `-S warning`.
- **Security headers** — verified live on a running server: CSP, HSTS,
  `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`, no `X-Powered-By`.

## Known gaps, not defects

- **`server_metrics` is never written.** The table exists, is pruned by the
  retention job and counted by its stats call, but nothing inserts a row.
  Monitoring is host-level only, so no chart is left visibly empty — this is an
  unfinished feature rather than a bug. Per-server CPU/RAM history would need a
  collector.
- **`custom_css` is exposed by `/api/site-settings` but never rendered.**
  Harmless, but it is a setting that cannot do anything.
- **`eslint-config-next` (16.2.6) trails `next` (16.3.2).** No lint errors
  result; worth aligning at the next dependency bump.
- **No encryption at rest for node SSH passwords.** Now accurately documented.
  Key-based auth (`sshKeyPath`) avoids the problem entirely and is preferable.

## Theme

The previous sweep found controls with nothing behind them. This one found the
mirror image: **correct logic wrapped in a careless response shape**. In both
node and user cases the surrounding code was thoughtful — explicit projections,
per-field permission checks — and the leak came from one `select()` or
`.returning()` that skipped the projection the same file already demonstrated.

The mechanical check worth repeating: for every table containing a secret, grep
every route that returns a row from it and confirm the projection is explicit.
`.returning()` and `db.select()` with no argument are the two shapes to look
for; neither is visible to the type checker, the linter, or any test that only
asserts on status codes.

---

# Fourth sweep — full workspace debug

The first three sweeps covered vulnerabilities, dead features, and what leaves
the server. This one asked two new questions: **can a user reach another
user's data**, and **is anything a client sends actually validated?**

**Result: 6 found, 6 fixed.** 1 high (unenforced API key scopes), 4 medium,
1 low.

| Gate | Before | After |
| --- | --- | --- |
| `npm test` | 165 | 202 |
| `verify:security` | 73/73 | 82/82 |
| `npm audit --omit=dev` | 0 vulns | 0 vulns |
| `next build` | succeeds | succeeds |

---

## High

### H1 — API key permission scopes were never enforced ✅ FIXED
`src/lib/auth.ts`, `src/lib/permissions.ts`, `src/lib/request-context.ts`

An API key can carry a `permissions` object narrowing what it may do. The
column exists, `POST /api/api-keys` accepts and stores it, and the panel's
TypeScript type declares it. Nothing ever read it back:

```ts
return viaKey ? { userId: viaKey.userId, role: viaKey.role } : null;
//                                        ^ scope discarded here
```

So a key created as read-only had its owner's **full** rights, including
delete. A user who scoped a key for a monitoring script and pasted it into a
third-party service had, in effect, handed over their whole account.

The obstacle was structural: all 161 `hasPermission(auth.userId, ...)` call
sites pass only a user id, so the scope was not reachable from where the
decision is made. **I asked before choosing an approach**, since the options
traded off risk very differently — enforce via request-scoped context, enforce
by changing every call site, remove the feature, or document it. The chosen
approach was AsyncLocalStorage.

Two properties make it safe:

- `setAuthContext` runs on **every** authentication outcome — cookie sessions
  and failures included, where it stores a null scope. Without that, a store
  left from an earlier request could narrow or widen an unrelated caller.
- A null scope stays unrestricted, so every key issued before this change
  behaves exactly as it did.

Cross-request bleed is the failure mode that would make AsyncLocalStorage the
wrong tool, so it is tested directly rather than assumed: three interleaved
requests with different scopes, each awaiting, each re-asserting its own scope
afterwards. Also checked against the running server — twenty concurrent
requests plus a mixed batch across five endpoints, no 500s, no async-context
warnings.

Scopes are now validated before storage. A typo like `servers.veiw` was
previously stored and produced a key that silently denied everything, which
presents as a broken panel rather than a rejected request. A scope can never
grant more than its owner holds: the intersection is an AND.

---

## Medium

### M1 — Ports were never validated ✅ FIXED
`src/app/api/servers/route.ts`, `[id]/route.ts`, `[id]/clone/route.ts`

`Number(port)` was the only processing a client-supplied port received before
reaching both the database and the `ufw` command line. That accepts:

| input | `Number()` | reached the database |
| --- | --- | --- |
| `"abc"` | `NaN` | yes |
| `"-1"` | `-1` | yes |
| `"99999"` | `99999` | yes |
| `"1e5"` | `100000` | yes |
| `"1.5"` | `1.5` | yes |
| `""` / `null` | `0` | yes |

It also accepted `22` and `80`. Ports below 1024 need root on Linux, so the
panel would hand a user a port their server cannot bind — while letting them
reserve SSH's or the web server's port.

Now parsed and range-checked on all three paths that set a port. Note the
allowlist added in the second sweep governs *which* fields may be written, not
what they may contain — so `PATCH` needed this separately.

### M2 — No port collision detection ✅ FIXED

Nothing checked whether a port was already taken on the node, so two servers
could be created on the same port. The second simply failed to bind at launch
and reported itself **"crashed"** with nothing to indicate why — a support
question that would be very hard to diagnose from the panel.

All three paths now reject a clash, naming the port.

### M3 — Cloning picked a colliding port by default ✅ FIXED

Clone took `source.port + 1`, which for any server with a query port is
*already the source's own query port*. So the default path was a guaranteed
collision once M2 started detecting them.

Turning a previously working button into an error would be a regression, so
clone now searches for the next free block wide enough for the whole triple
(game + query, plus RCON when the source has one).

### M4 — The per-user server quota was never enforced ✅ FIXED

`maxServers` is stored per user, editable by an admin holding `users.limits`,
and rendered in both the profile and admin panels as `3/5`. Nothing read it —
any user could create unlimited servers, on a box with finite RAM and disk.

Enforced on create **and on clone**: clone is a create, and a user at their
limit could otherwise clone straight past it. Admins are exempt. `null` and
`0` mean unlimited, matching the convention already used by retention.

---

## Low

### L1 — Clone accepted installPath from the request body ✅ FIXED

The process route joins `installPath` with `gsm-start.sh` and executes it,
which is exactly why it was removed from the update allowlist in the second
sweep. Clone still read it straight from the body. Now derived from the source.

---

## Checked and found clean

- **Per-object authorization.** Every server route checks ownership, not just
  permission. Two different escape hatches are in use — `role !== "admin"` on
  seven routes and `hasPermission("servers.edit")` on three (files, upload,
  RCON) — which is worth knowing: those three are reachable by moderators
  across accounts, deliberately, since moderators hold `servers.edit`.
- **The default `user` role** holds no `servers.edit` or `servers.files`, so
  ownership genuinely isolates ordinary users from each other.
- **Forum, CMS and ladder routes** implement the `edit_own` / `edit_any`
  distinction correctly, including the `forum.moderate` override.
- **Ladder stat inputs** accept `NaN`, but Postgres rejects it for an integer
  column, so they fail loudly rather than storing garbage. Admin-gated and
  cosmetic; left alone.
- **`execFile` in the firewall helper** passes an argument array, so the
  unvalidated ports were never a command-injection risk — only a data one.
- **Mass assignment**: `.set({ ...body })` now appears nowhere in the tree.

## Theme

The first sweep found missing guards, the second found controls with nothing
behind them, the third found correct logic in a careless response shape. This
one found **the boundary between "stored" and "enforced"**.

Four of the six were the same shape: a value the panel accepts, stores,
displays back to the user, and never acts on — `maxServers` rendered as a
quota, `permissions` offered as a key scope, a port taken as given. Each looks
completely functional from the UI, and each is invisible to the type checker,
the linter, and any test that only asserts status codes.

The check worth repeating: for every value a user can set, find the line that
*reads* it back and makes a decision. If there isn't one, the feature does not
exist regardless of how it looks.
