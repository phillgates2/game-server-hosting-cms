# Security audit — 2026-10-22

Scope: `phillgates2/game-server-hosting-cms` @ `69da7c6` (branch
`arena/7365cf7f-game-server-hosting-cms`).

**Status: all findings fixed.** `npm run verify` is green end to end:
typecheck clean, lint 0 errors, 1484 tests pass, templates/installers 0
errors, `verify:security` **468/468** (was 456/462).

---

## 0. Second pass — three more findings (F9–F12)

A second review pass over the merge-visible diff turned up three more real
issues, all fixed with regression tests:

### F9 — Scheduler `command` task was a privilege escalation · FIXED

`POST /api/scheduler` and `PATCH /api/scheduler/[id]` accepted the
`scheduler.create` **or** the `servers.edit` permission, but the runner
executes a `command` task as `execFile("/bin/bash", ["-lc", command])`. The
built-in **moderator** role holds `servers.edit` and not `scheduler.create`,
so a moderator could create — or flip an existing restart task into — an
arbitrary shell command on the panel host.

**Fix:** a `command` task type (the resulting type for `PATCH`) now requires
`scheduler.create` specifically, in both routes.

### F10 — Embed builders interpolated the origin into HTML · FIXED

`buildEmbedIframe(origin, heightPx)` and `buildEmbedWidget(origin)` wrote the
origin straight into a `src="…"` attribute and into a `<script>` block. An
origin containing `"` breaks out of the string and `</script>` breaks out of
the tag, so a pasted snippet was stored XSS on whoever pastes it.

**Fix:** added `normalizeEmbedOrigin(origin)`, which returns only
`URL.origin` (drops path, query and userinfo; rejects non-http(s) and any
userinfo), and `clampHeight` for the iframe height. Both builders now return
`string | null` and the caller refuses to emit a snippet for a bad origin.
`tests/embed-snippets.test.ts` grew to 11 cases, including hostile origins.

### F11 — FTP symlink escape on the sync read path · FIXED

`src/lib/ftp-server.ts` `containedPath()` used the lexical `safePath`, so the
FTP read path was the one place still vulnerable to the F6 symlink escape.
`STOR`/`MKD` already used the async variant.

**Fix:** added `resolveSafePathSync()` to `src/lib/server-file-ops.ts` (sync
`realpathSync`/`statSync`, longest-existing-ancestor walk, real-base
containment); `containedPath` now uses it. Tests assert the sync and async
variants agree.

### F12 — `uninstall.sh` `source`d `.install-info` as root · FIXED

`public/uninstall.sh` did `source "$INSTALL_DIR/.install-info"` as root. The
file also stores `ACCESS_KEY`, and `source` runs arbitrary shell — so a
writable `.install-info` is root code execution. `update.sh` and
`setup-webroot.sh` already read it safely (`done < file` / `grep`); only the
uninstaller sourced it.

**Fix:** the uninstaller now parses the file line by line and copies only an
allowlisted set of keys (`GSM_USER`, `DB_NAME`, `DB_USER`, `STEAMCMD_DIR`,
`GAMESERVERS_DIR`); `INSTALL_DIR` is deliberately ignored so the CLI value
stays authoritative. Pinned by a new `INSTALLER-INFO` rail in
`verify-security.ts` asserting no root installer `source`s the file, and
verified by hand against a hostile file containing
`ACCESS_KEY=$(touch /tmp/pwned)`.

---

## 1. Dependencies

`npm audit` before: **17 advisories (1 critical, 12 high, 4 moderate)**.
After: **9 advisories (0 critical, 5 high, 4 moderate)** — and every one of
the remaining nine is dev-tooling.

| Package | Was | Now | Notes |
| --- | --- | --- | --- |
| `next` | 16.3.2 | **16.4.2** | Was inside the 16.0.0–16.4.0 advisory range covering unauthenticated RCE (Image Optimization via AVIF/SVG, `next/og`, `use cache` leaks) and an SSRF. Applied. |
| `nodemailer` | ^9.0.5 (9.1.1) | **^10.2.1** | 7 advisories. v10 ships its own types; `@types/nodemailer@8` was removed (it described a different API and was never used — typecheck passes with it gone). |
| `postcss` | 8.5.8 | **^8.5.31** | XSS-via-`</style>` and `sourceMappingURL` arbitrary-file read. |
| `js-yaml`, `brace-expansion`, `source-map-js`, `sharp`, `undici` | various | cleared | `npm audit fix`. |

`src/lib/email.ts` needed one line for the nodemailer v10 types:
`import nodemailer, { type Transporter } from "nodemailer"` (v10 dropped the
`nodemailer.Transporter` namespace).

### The nine that remain, and why they stay

```
braces, micromatch, fast-glob, @next/eslint-plugin-next, eslint-config-next
esbuild, @esbuild-kit/*, drizzle-kit
```

Verified with `npm ls`: every one of them sits under a **devDependency** and
none is reachable from a request.

```
braces/micromatch/fast-glob   → eslint-config-next → @next/eslint-plugin-next
esbuild/@esbuild-kit/*        → drizzle-kit, tsx
```

The only fix paths are breaking **downgrades**: `eslint-config-next@14.2.35`
and `drizzle-kit@0.18.1`. Both would move the panel backwards on a lint rule
set and a schema-generation tool for advisories that cannot be triggered by
any HTTP request. They are left pinned deliberately rather than downgraded.

Revisit if any of these ever becomes a runtime dependency.

---

## 2. Fixed findings

Each item below was reproduced first, fixed, and pinned by a regression test or
a strengthened `verify-security` assertion.

### F1 — Subscription gate bypassable with a two-item cart · FIXED

`src/app/api/shop/orders/route.ts`

The guard carried `&& cartItems.length === 1`, so a subscription bought
alongside anything else skipped the "card payments only" rule and created a
manual order that `fulfilOrder` would mint a subscription key for.

**Fix:** extracted the decision into a pure, tested helper —
`cartRequiresCardProvider(items, provider)` in `src/lib/shop.ts` — and moved
the check ahead of the loop so it looks at the **whole cart**. The
single-item restriction belongs to the Stripe session built later, not to the
rule.

Pinned by `tests/shop.test.ts` (multi-item carts, stripe/manual, legacy
`kind: null`) and by a strengthened `verify-security` assertion.

### F2 — Client-IP extraction inconsistent across ~25 routes · FIXED

`src/lib/ip-allowlist.ts` introduced `clientIpFromHeaders` (forwarded headers
honoured only behind `GSM_TRUST_PROXY=1`, then only the **last** hop) exactly
to stop `X-Forwarded-For` spoofing. The auth routes used it; roughly 25 other
sites read the **first** hop. The IP allowlist itself was never exposed (it
runs in `getCurrentUser`), but the per-IP **rate limiters** were:

- `license/public/check` (5/min anonymous) and `license/validate` (10/min) —
  the brute-force defence for the anonymous key endpoints. `license/validate`
 's own comment states the design: *"Brute force is the threat model."*
- `shop/orders` (15/min) — unthrottled orders each burn a coupon use and
  decrement stock.
- `shop/coupons/check` (20/min), `public/status` + `[token]` and the two
  status pages (30/min anonymous).

**Fix:** every site now routes through `clientIpForRecord(req.headers)`.

Pinned by a new `IPXF` rail in `verify-security.ts` that walks `src/` and
fails on any `headers.get("x-forwarded-for")` outside `ip-allowlist.ts` —
it looks for an actual read, not the term, so explanatory comments do not
trip it.

### F2b — `/api/license/public/check` leaked key existence · FIXED

The module doc claimed "answers the SAME shape for every failure class (no
existence oracle)" and `verify-security` pinned it — but only by checking that
both failure branches used the same message helper. The real responses differed:
the not-found branch omitted `expiresAt`, `maxActivations` and
`activationsUsed`, so one request distinguished "no such key" from "this key
exists but is revoked".

**Fix:** every answer is now built by one `answer()` helper that emits the
same field set on every branch. The assertion was strengthened to require the
builder, the shared not-found branch and the real values — the shape is no
longer spelled out per return, which is exactly how the oracle got in.

### F3 — Coupons consumed on orders that never pay · FIXED

`usedCount` was incremented at order creation, before the Stripe session was
built. An abandoned checkout burned a use nobody paid for; with `maxUses` set,
a handful of abandoned orders exhausted a coupon.

**Fix:** consumption moved to fulfilment. `consumeCouponUse(orderId)` in
`src/lib/shop.ts` is called from both `fulfilOrder` exit paths (Stripe webhook
and admin approve) and increments with a `max_uses` guard, so a burst of
concurrent fulfilments cannot push the counter past the cap.

Pinned by the strengthened `COUPON` rail (asserts the route no longer charges
at creation, and that the guarded increment exists).

### F4 — Stock decremented for orders that end up cancelled · FIXED

`stockQuantity` was decremented when the order was created and never restored
when the order was cancelled — a pending order that was abandoned consumed
inventory nobody bought.

**Fix:** `restoreStockForOrder(orderId)` in `src/lib/shop.ts`, called on both
cancellation paths (Stripe session failure in `shop/orders`, and the admin
refund route's `action: "cancel"`). Only products that actually track stock
get it back. Refunds of *fulfilled* orders deliberately do not restore stock —
the item was delivered.

### F5 — `couponId` recorded on orders it did not apply to · FIXED

In a multi-item cart, the per-product scope check gated the **amount** but
`couponId` was written to every order, so a scoped coupon left an
undiscounted order carrying the coupon's id.

**Fix:** a single `couponApplies` decision now drives both the discount and
`couponId: couponApplies ? couponId : null`.

### F6 — Path containment was lexical, not symlink-aware · FIXED

`safePath()` uses `resolve()` + `startsWith(base + sep)`. That stops `..`
traversal (tested) but a symlink inside the server directory pointing outside
passes it, and `fsRead`/`fsWrite`/`fsDelete`/`fsRename` all follow it.

**Fix:** added `resolveSafePath()` in `src/lib/server-file-ops.ts`, which
resolves the **real path of the longest existing ancestor** and re-checks
containment against the **real** server root (so a server directory that is
itself a symlink — Docker volumes, moved installs — still works). Every
disk-touching operation now goes through it, plus the stream-upload route and
the FTP `STOR`/`MKD` write paths.

Pinned by 8 new tests in `tests/server-file-ops.test.ts` that build real
temp trees and real symlinks: escape-to-outside, escape-to-sibling,
in-base symlink resolves to the real path, non-existent tail under an inside
symlink, brand-new subdirectories, and a symlinked base.

### F7 — Agent `/rpc/process` `stop` accepted an arbitrary pid · FIXED

`installPath` was contained but `pid` was not — anyone holding the agent key
could signal any process group on that box.

**Fix:** the agent now records the pid it started in
`<installPath>/gsm-agent.pid` and `stop` refuses any pid that does not match
(clearing the file on success). The panel passes the pid it received from
`start`, so this is compatible with the existing flow.

Pinned by a new case in `tests/node-agent-e2e.test.ts` that starts the real
agent and asserts a stop with an unstarted pid answers 400.

### F8 — Cleaned up

- **`verifyMasterKey` env branch compared with `===`** while the stored-hash
  branch used `timingSafeEqual`. Both branches now go through one
  `constantTimeEqual` helper.
- **`resolveReseller` was dead code** (defined, never called) in
  `shop/orders/route.ts` — removed.

---

## 3. Stale assertions in `verify-security.ts`

All six original failures were the same class: regexes written against an
earlier spelling of the code, never updated. The behaviour they pinned was
present; the pattern did not match. Updated in place, and one of them turned
up a **second** broken pattern (`status: "pending",\n        amountCents,`)
that had been failing silently under the same check — now written
indentation-insensitively.

| Check | What the regex missed |
| --- | --- |
| `UPDDIFF … snapshots before AND after` | `const pre = remote ? null : await snapshotInstallPath(...)` |
| `SHOP … priced from the PRODUCT` | `let amountCents = product.priceCents * qty`; and the `status: "pending"` block's indentation |
| `SHOP … fulfilment is idempotent` | the idempotent return is now `if (order.status === "fulfilled")` |
| `COUPON … apply server-side` | the code was refactored from `coupon` to `couponObj`, and `usedCount` moved out of the route entirely |
| `SUBSCR … sessions use recurring prices` | `mode: singleProduct.kind === …` |
| `RESELL … hash-looked-up` | `hashResellerToken(effectiveToken)` |
| `MKEY … timing-safe compare` | the compare now goes through `constantTimeEqual` |

**Net change: 456/462 → 468/468.** Five new rails were added alongside the
fixes — `IPXF`, `SYMLINK`, `AGENTPIDR`, `INSTALLER-INFO` — and the
`LICPORTAL`, `SUBSCR`, `COUPON` and `MKEY` rails were strengthened so the
checks that F2 and F2b slipped past cannot slip past again.

The embed-snippet assertion was refreshed again in the same pass: it still
looked for `origin.replace(/\/\/+$/, "")`, an earlier spelling that F10
replaced with `normalizeEmbedOrigin`. The behaviour it pinned (trimming the
origin, escaping names) is still present — it now asserts the normaliser, the
userinfo refusal and the name-escaping.

---

## 4. Build gates

| Gate | Before | After |
| --- | --- | --- |
| `tsc --noEmit` | clean | clean |
| `eslint .` | 2 errors, 10 warnings | **0 errors**, 10 warnings |
| `npm test` | 1467 pass | **1484 pass** (17 new) |
| `verify:templates` | 0 errors | 0 errors |
| `verify:installers` | 0 errors, 2 warnings | 0 errors, 2 warnings |
| `verify:security` | 456/462 | **468/468** |
| `npm run verify` | failed at lint | **green** |

The two lint errors blocked `npm run verify` and were in `shop/page.tsx` and
`PublicShop.tsx`: `setCart(parsed)` / `setEmail(savedEmail)` called
synchronously inside a `useEffect` that read `localStorage`. Both now restore
from the `useState` initializer via a shared `readStoredCart()` helper, which
also removes the cascading render. The remaining 10 warnings are pre-existing
`<img>` vs `next/image` notices and one unused eslint-disable directive —
cosmetic, not security.

### `next build` now succeeds offline — fonts are self-hosted

`src/app/layout.tsx` pulled Orbitron and Rajdhani from Google Fonts at build
time, and this sandbox has no egress to `fonts.googleapis.com`:

```
Error: next/font: error: Failed to fetch Orbitron from Google Fonts.
Error: next/font: error: Failed to fetch Rajdhani from Google Fonts.
```

That was the air-gapped-build failure already recorded in `DEBUG-REPORT.md`.
Self-hosting fixes it for air-gapped deployments generally, so the latin
woff2 subsets are now vendored into `src/app/fonts/` (with their SIL OFL
licence files) and loaded with `next/font/local` — the default export, one
`src` entry per weight, exposed as `--font-heading` / `--font-body` with
`display: "swap"`. The build completes offline and the woff2 files are
bundled into `.next/static`.

The build then only stops on the two intentionally fail-closed production
guards (`JWT_SECRET is required in production`, then `DATABASE_URL is
required`), which is correct behaviour with no env configured in the
sandbox. Reproduce with:

```
JWT_SECRET=$(openssl rand -hex 32) DATABASE_URL="postgresql://gsm:gsm@127.0.0.1:5432/gsm" npx next build
```

---

## 5. What was already clean

Worth stating, because it is a lot of surface and none of it needed touching:

- **No raw exception messages reach a client** — `apiError` is used
  consistently; the scan finds zero.
- **Auth enforcement is real.** Login verifies TOTP when 2FA is enabled, the
  throttle is per IP+username, suspended/banned accounts get zero permissions
  on the *next* request, sessions are revocable per-token, and the IP
  allowlist fails closed.
- **JWT secret policy is fail-closed** in production.
- **CSRF** enforced in `src/proxy.ts` for every state-changing method on
  `/api/*`, with documented, tested exemptions.
- **SQL surface.** Query console is single-statement with a statement timeout
  on a destroyed connection; identifiers are validated against
  `information_schema` *and* quoted; the SQLite browser validates against
  `sqlite_master` and quotes.
- **Shell surface.** Backup restore and drills run `tar` via `execFile`/`spawn`
  with an argument array; the agent runs `bash script.sh` with no `-c`; deploy
  scripts use a quoted heredoc with a key-charset guard.
- **No SSRF.** Webhook URLs are validated against a private-range blocklist
  and deliveries never follow redirects. Node API URLs are admin-configured,
  not user-supplied.
- **Installer hardening** from `DEBUG-REPORT.md` (sudoers exact-command rules,
  `.env`-driven drizzle config, no credential leakage into tracked files) is
  all present and test-pinned.

---

## 6. Files changed

```
src/lib/server-file-ops.ts      symlink-aware resolveSafePath (+ sync) + all ops
src/lib/shop.ts                 cartRequiresCardProvider, consumeCouponUse,
                               restoreStockForOrder
src/lib/master-key.ts           shared constantTimeEqual
src/lib/auth.ts                  trust-aware session IP
src/lib/ftp-server.ts           STOR/MKD + containedPath use the real-path check
src/lib/status-share.ts         normalizeEmbedOrigin, clampHeight
src/lib/email.ts                 nodemailer v10 type import
src/app/layout.tsx              self-hosted Orbitron/Rajdhani via next/font/local
src/app/fonts/                  vendored latin woff2 subsets + OFL licences
src/app/api/shop/orders/route.ts subscription gate, coupon scope,
                               stock restore, dead code removed
src/app/api/shop/admin/orders/[id]/refund/route.ts  stock restore on cancel
src/app/api/license/public/check/route.ts  single-shape answer builder
src/app/api/license/validate/route.ts       trust-aware rate-limit key
src/app/api/scheduler/route.ts             command task gated on scheduler.create
src/app/api/scheduler/[id]/route.ts        same gating on PATCH
src/app/api/{shop/orders,shop/coupons/check,public/status,license/keys,
            license/activations,audit-log,blueprints,file-transfer,
            maintenance-windows,servers/*,settings/master-key,
            shop/admin/orders/[id]/approve}/route.ts   shared IP extractor
src/app/{status/page,status/[token]/page}.tsx           shared IP extractor
src/app/{shop/page,components/PublicShop}.tsx          state-in-initializer
agent/gsm-agent.mjs             pidfile-backed stop
public/uninstall.sh             .install-info parsed as data, never sourced
package.json / package-lock.json next 16.4.2, nodemailer 10.2.1, postcss 8.5.31
scripts/verify-security.ts       assertions refreshed, 5 new rails
tests/{shop,server-file-ops,node-agent-e2e,embed-snippets}.test.ts  regression tests
SECURITY-AUDIT-2026-10-22.md   this report
```
