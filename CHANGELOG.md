# Changelog

All notable changes to GameServer Manager are documented here.

---

## [1.21.0] — 2026-08-26

### 🟢 Discord Status Dot & Live Player Count

- **Every server notification now answers "is it up?" and "how many are on it?"** Notifications carry a status row — 🟢 Online or 🔴 Offline — and a players row with the live count, e.g. `3/16`.
- **The count is probed from the game itself**, so it is real, not a guess: Steam A2S info + player queries (CS2, TF2, Garry's Mod, L4D2, Rust, ARK, Palworld, Satisfactory, Squad, V Rising, Enshrouded, Insurgency: Sandstorm, 7 Days to Die, Xonotic), the Minecraft Java server-list ping, the Bedrock RakNet ping, and the Quake 3 `getstatus` protocol (Quake Live, Wolfenstein: ET).
- A stopped server shows the count it had **at the moment it stopped** (the count is read before the process is killed); a crashed one shows an honest "—" rather than a made-up zero.
- Games with no public query protocol (Valheim, Factorio, Project Zomboid, …) and custom games are skipped instantly instead of waiting out a timeout, and the probe is bounded and best-effort — a firewalled query port can never slow down or break a panel request.
- The max slot count comes from the probe when it answers and from the server's own `MAX_PLAYERS` setting otherwise, and the webhook test button shows the dot and a sample count so you can see the format before relying on it.

### 🏆 Ladder Stats

- **Entering "abc" as a stat returned a server error instead of a useful message.** The ladder routes ran `Number()` on the body directly, so `"abc"` became `NaN`, `"1.5"` a float, and anything over the column's range — each one blew up at the database with a 500. Negative values were accepted outright, silently corrupting the standings.
- Every stat now goes through one validator: whole numbers only, never negative, with sane ceilings. Bad input is a 400 that names the field (`wins must be a whole number between 0 and 1000000`).

### 📥 Settings Import

- **Importing settings was not atomic.** The import applied each row as a separate write, so a bad entry halfway through left half the settings changed and no way to tell which half.
- The whole import is now one transaction — either everything lands or nothing does — settings are written in a single upsert instead of a select-then-write per key, and the role permission cache is refreshed only after the commit.
- Hand-imported role data is validated too: a permissions field that is not an object (which previously stored a JSON string and silently revoked every permission for that role) becomes an empty permission set, and out-of-range priorities are clamped.

### 🎨 Custom CSS

- The public settings API exposed `custom_css` but nothing ever rendered it — the setting was invisible no matter what you saved.
- The Site Editor now has a **Custom CSS** field, and the stylesheet is applied to the public site. The one thing it cannot do is close the `<style>` element: a `</style>` in the value is stripped so the CSS can never become page markup.

### 🐛 Friendly Errors

- **Creating two custom games with the same name at once returned a raw 500.** The duplicate-slug check is a race and the database's unique index is what actually arbitrates; the loser now gets the same friendly "slug already exists" 409 as the non-racing path — for both custom games and imported eggs.
- **Creating a custom game named with a non-port default port gave a 500 instead of a 400.** The port is now validated as a real port number (1-65535) before it reaches the database.
### ⏰ Scheduled Tasks Actually Run

- **Scheduled tasks never ran.** Tasks could be created, edited and listed —
  "restart every night at 4am", "backup every Sunday" — but nothing in the
  panel ever executed them. The scheduler was a display widget.
- A runner now lives in the panel process, started at boot: it ticks every
  30 seconds, picks up every due enabled task, executes it (restart / backup /
  SteamCMD update / custom command), and advances the schedule with a real
  cron calculation. A failing task logs and moves on — it can never take the
  panel down, and a task on a remote node is skipped rather than attempted.
- **Cron input was also fabricated.** The old "parser" ran `parseInt` on two
  of the five fields, so `*/30` became an invalid date, `5,10` was treated as
  `5`, and anything unrecognised was quietly scheduled an hour out. The panel
  now accepts only genuine 5-field cron (steps, ranges, lists, the standard
  Sunday-7 rule) and rejects the rest with a 400.
- Manual backups and scheduled backups share one archive builder, so the two
  cannot drift; scheduled updates refuse to run on a running server; command
  tasks are capped and run in the server's own directory.
- **414 tests** (13 new) and **130 security checks** (6 new).

### 🛡️ SQL Console & Settings Hardening

- **The SQL console could run several statements at once.** `pool.query(text)`
  uses Postgres' simple protocol, which executes everything in the string — a
  stray semicolon could turn "delete a row" into "delete a row, drop a table".
  The console is admin-only on purpose, so the guard is about accidents: it
  accepts exactly one statement (with strings, identifiers, comments and
  dollar-quoted bodies understood) and refuses anything more.
- **`SELECT pg_sleep(3600)` had no timeout.** It pinned the request and its
  pooled connection for an hour. Queries now run on a dedicated connection
  with a 15-second statement timeout, and that connection is discarded
  afterwards so the timeout can never leak onto another request.
- **Table names were spliced into SQL in the database browser.** They were
  checked against `information_schema` first, but a real table name can still
  contain a quote; names are now quoted as identifiers.
- **Audit entries were unbounded and plain-text details 500'd.** The
  `details` column is jsonb, so `"something happened"` failed to insert
  instead of being stored. Details are now normalised to JSON (capped),
  and action/entity fields are validated and capped.
- **Site settings accepted any key and any size.** A stray character in a
  bulk save created a junk settings row; JSON-shaped settings (features,
  nav links) are now validated as JSON at save time so a bad value breaks
  immediately, not at page render; values are capped (custom CSS tighter).
- **Global search had no bound and a wrong join.** A 10 MB `q` scanned text
  columns with `%…%`; the search term is capped at 100 characters, and the
  server query joined on a LIKE condition instead of `game_id` — correct by
  coincidence, and one edit away from silently dropping rows.
- **426 tests** (12 new) and **135 security checks** (5 new).

### 👤 User Accounts

- **User editing accepted invented roles, bad emails and unbounded limits.**
  The PATCH route gated who may edit but never what the values may contain: a
  role string like `"superadmin"` went straight into the JWT claim, `"abc"` as
  max servers 500'd at the database, a duplicate email was a raw 500, and a
  password could be one character long.
- **The last admin could lock themselves out.** Demoting your own admin role
  left the panel with no account able to reach admin surfaces; it is now
  refused with a clear message.
- Roles and statuses are allowlisted to what the UI offers, emails are shaped
  and deduped (a duplicate returns 409, not 500), limits are bounded (0 =
  unlimited), profile fields are capped, and passwords must be 8-256
  characters.
- **434 tests** (8 new) and **136 security checks** (1 new).

### 📋 Live Discord Status Boards

- **Status boards, WolfET-style: one message per server in its Discord channel that keeps itself current.** The message shows a 🟢/🔴 status dot, the game, the current **map** (A2S and Quake 3 now report it), the **player count (X/Y)** and the **players online** — up to 14 named, colour codes stripped, the rest summarised and the field kept under Discord's 1024-character cap.
- **It refreshes itself.** A background loop (started at boot, `GSM_DISABLE_STATUS_BOARDS=true` to switch off) re-probes every enabled server at an operator-chosen interval (default 3 min, clamped 1-60) and edits the board message in place. No bot gateway needed — webhooks can edit their own messages.
- **It repairs itself.** A board message deleted in Discord is re-posted. A webhook that is gone entirely disables the board and surfaces the reason in the panel.
- **Check it from the panel.** Settings → Discord now has a **Status Boards** section: enable/disable per server, refresh one right now, set the interval, and see the last error.
- The player probe also now reports the **map and player names** (A2S split-protocol query, Quake 3 `getstatus`), so boards and notifications share one richer probe.
- Fresh installs get the new columns (the installer's `game_servers` DDL was also missing `discord_channel_id`, which previously broke the "Create missing channels" backfill on fresh installs).
- **445 tests** (11 new) and **140 security checks** (4 new).

### 🤖 WolfET-Style Discord Chat Bot (ET community bot)

- **The panel now runs the full command bot on the gateway** — the same one the ET community uses:
  `!etwho [name]` (live status: map, players, roster), `!etallofoz` (real players across every ET
  server), `!stats <player>` (level, seven skills, total XP, last active), `!ettop10` (XP leaderboard
  with medals), `!etverify <GUID>` (links your Discord account to your ET GUID in a DM — the GUID is
  never left in the channel, and the bot grants an **ET Verified** role), `!etsync` (sets your nickname
  to `name | 12,345 XP`) and `!desync` (unlinks and removes the role).
- **Channel names carry the status** like the community bot: `🟢 et: (5) - et_beach`, `🟠 et: (0) - et_beach`
  when up but empty, `🔴 et: server offline` — updated with the status-board loop.
- **Verified users' nicknames are kept current** by a 10-minute XP sync, with the server-owner and
  role-hierarchy exceptions handled the same way the original bot did.
- **XP comes from the game itself.** The mods' `user.sqlite` is read from each ET server's install
  directory (`GSM_ET_USER_SQLITE` overrides the path). The base64 XP token format, ET colour codes,
  bot filtering, the name-matching ladder (exact → partial → fuzzy) and the 32-char GUID rules are all
  ported and unit-tested.
- **Guest appearances from the port:**
  - `discord_verifications` table holds the links (panel database, not a sidecar file) — the updater's
    `drizzle-kit push` adds it, and fresh installs create it too.
  - **sql.js was dropped after it broke production builds** — its 24 MB wasm runtime made Turbopack
    exhaust memory on small hosts. A zero-dependency SQLite reader (`sqlite-reader.ts`, ~260 lines)
    reads the stats file instead, verified against a real SQLite database fixture.
  - `discord.js` ships as a server-external package and is loaded via a non-analyzable import.
- Enable **Server Members Intent** and **Message Content Intent** in the Developer Portal (the bot
  logs the refusal and retries); `GSM_DISABLE_DISCORD_BOT=true` turns it off entirely.
- **468 tests** (23 new) and **145 security checks** (5 new).

### 🎯 Parity Pass — every remaining detail of the community bot

- **`!etwho` now uses the bot's 3-minute status cache.** A fresh view is shared between the
  status-board loop and the chat commands, so `!etwho` / `!etallofoz` inside the window never
  re-query the game; a stale cache shows the original's `⌛ Fetching fresh server status...`
  message first.
- **Rosters carry pings** (`• Rifleman [12ms]`) and **`sv_hostname`** drives the `!etallofoz`
  field names, exactly like the original — the Quake 3 parser now returns ping and hostname
  per player and filters bots the same way (indicator list, or ping 0).
- **Progress message + edit** for `!etallofoz` ("⌛ Checking all OZ servers...") and `!ettop10`
  ("⌛ Calculating top 10 players..."), with the result replacing the progress message; the
  empty `!ettop10` / `!etallofoz` states carry the `Active Servers: N/M` footer.
- **`!etverify` deletes the command message** in guild channels so the GUID never lingers,
  and cooldown replies plus the command message tidy themselves up after the wait.
- **Server owners get the DM button** — `!etsync` sends a `Set This Nickname` button that shows
  the nickname to copy (the original's `UpdateNicknameButton`), and the button verifies the
  clicker is the owner before replying.
- **472 tests** (4 new) and **146 security checks** (1 new).

---

## [1.20.0] — 2026-08-24

### 💾 Deletes No Longer Half-Finish

- **Deleting an account could destroy its API keys and then refuse to continue.** The account deletion removed the user's API keys *before* checking whether they had written any forum posts. If they had, the panel returned "delete their posts first" — but the keys were already gone, and nothing put them back. Every refusal is now decided before the first write.
- **Deleting a forum thread wiped the replies as a separate step from the thread.** A failure in between left the thread listed with every reply permanently gone. Thread and replies now go together, or not at all.
- **Deleting a server removed its schedules and metrics history separately too.** Same problem: a failure partway through stripped a live server's data while leaving the server in place.
- These are now single transactions. Nothing partially applies: either the whole delete lands, or the database is untouched.

### 🧪 Installers Verified Through the Database

- The installer check rendered each game straight from its definition file, but a real install goes through the database first, and only some of those fields are copied across. That gap was never tested — a game could verify clean and still install wrong.
- Every game is now round-tripped through the database and re-rendered from the stored row, covering the install script, start and stop commands, and generated config files.
- **Many more config formats are recognised by name**, including Source engine `.vdf`/`.res`, Minecraft `.mcmeta`/`.mcfunction`, Arma `.sqf`/`.arma3profile`, admin lists (`ops`, `whitelist`, `banlist`, `motd`, `mapcycle`), and `.bak`/`.old`/`.disabled` copies of any of them.
- Recognised formats are now accepted a step earlier, so a valid config is never rejected for looking unusual. The safety checks still come first — a file that would be damaged by editing is refused no matter what it is called, and a binary renamed to `.bak` is still caught.
- **356 tests** (63 new) and **113 security checks** (8 new).

### 📝 File Editor

- **`.gm` (GameMonkey) scripts and other plain-text files can now be opened.** The editor decided what was editable from a fixed list of file extensions, so anything not on it — however obviously text — could only be downloaded.
- Editability is now judged by looking at the file's actual contents. Any genuine text file opens, whatever it is called.
- **This also closes a way to destroy files.** The editor reads and writes as UTF-8, which silently mangles anything that is not text: bytes it cannot interpret are replaced, and saving writes the damaged version back. A file on the old list that was secretly binary — a rotated log that is really compressed, for instance — could be opened and saved, and the original was unrecoverable. The check now runs on the server, so it cannot be sidestepped, and saving over a binary file is refused outright.
- Files that cannot be edited now say why (binary, wrong encoding, not valid text) instead of always reporting "Binary file".

### ⬆️ Updater

- **Updating an existing install would fail to build.** Next 16 renamed the `middleware.ts` convention to `proxy.ts` and refuses to build when both files exist. The old file was never tracked in git, so pulling the new release could not delete it — the update stopped with a failed build, and rolling back restored the same file, so retrying hit the same wall.
- `update.sh` now removes the obsolete `src/middleware.ts` before building, keeping a copy in the backup folder in case it was customised. Fresh installs were never affected.

### 🔗 Slugs

- **A page or game could be saved with a blank web address.** The "slug is required" check ran against what you typed, but the value was cleaned up afterwards — so a name like `-` or a few spaces passed the check and then became empty. The result was invisible: it could not be opened by address, and it blocked the next one from being saved at all.
- **Ordinary names produced malformed addresses.** Creating a custom game called "My Game!!" gave you `my-game-`, with a stray dash on the end; leading spaces produced one at the front too.
- Renaming a forum category to something with no letters or numbers blanked its address and made the category unreachable. It is now refused, the same way creating one already was.
- All six places that build addresses now share one implementation.

---

## [1.19.0] — 2026-08-22

### 🔒 Cross-Site Request Forgery Protection

- **Another site could make your browser perform actions in the panel.** Because the panel signs you in with a cookie, the browser attaches it to any request a web page can trigger — including a hidden form on someone else's site. The file upload endpoint was the clearest route in, since a plain HTML form can post files with no permission from the browser.
- Every state-changing API request now has to come from the panel's own address. Applied centrally, so new endpoints are covered automatically.
- **Nothing legitimate is affected.** API keys still work from anywhere (they travel in a header a foreign page cannot set), command-line tools and the installer are unaffected, and ordinary page loads are untouched.

### 📈 Per-Server Resource History

- **The panel could tell you the machine was busy, but never which server was doing it.** The table for per-server CPU and memory history had existed since the first release and was even being cleaned up on schedule — but nothing ever wrote to it. It is now populated for every running server.
- Samples are recorded once a minute per server, which keeps a year of history for a busy panel at a sensible size rather than flooding the database.

### 📋 Readable Logs

- Log output is now consistently tagged by subsystem, so a line in the PM2 log can always be traced to what produced it. Set `GSM_LOG_FORMAT=json` for machine-readable output, or `GSM_LOG_LEVEL=warn` to quieten routine chatter.

### 💬 Consistent Confirmations

- **Twelve destructive actions used the browser's plain grey confirm box** while the rest of the panel used its own styled dialog. They now match, and each one says plainly whether the action can be undone.

### 🧪 Quality

- **293 tests** (33 new) and **105 security checks** (4 new). The CSRF rules are tested against the cases that would break a real install — a reverse proxy terminating TLS, a LAN install on port 3000, the installer's own requests — because a guard that fails closed on legitimate traffic is worse than none.

---

## [1.18.0] — 2026-08-22

### 💬 The Panel Now Tells You When Something Is Refused

- **Actions you lack permission for failed silently.** Deleting a forum thread, pinning a post, suspending a user, toggling a scheduled task — if your role did not allow it, the request was refused, the list reloaded unchanged, and *nothing said why*. It looked exactly like a broken button. Ten actions across five panels now report the reason, using the message the server already provides.
- **Two were worse than silent.** Deleting a scheduled task announced *"Task Deleted"* even when the deletion had been refused, and the database row editor swallowed constraint errors so a rejected save looked like a successful one.

### ⚡ Performance & Correctness

- **The public forum thread list had no limit.** It is readable without logging in and counts replies with a per-row subquery, so any visitor could make the server read every thread in the forum on every request. Both it and the user list are now paginated.
- **The log viewer mishandled unusual values.** Requesting a negative number of lines returned an *empty* console — indistinguishable from a server that had printed nothing — and asking for `1e9` lines returned exactly one. Both now clamp sensibly.

### ♿ Accessibility

- **The Delete Server button had no name.** It was a bare wastebasket icon, which a screen reader announced simply as "button" — on the most destructive control in the panel. Fixed for every icon-only button at once.

### 🧪 Quality

- **260 tests** (16 new) and **101 security checks** (6 new). The settings added in the previous release were re-verified against a real token: changing the session length moves the token expiry and the cookie together, and the login throttle blocks at exactly the configured attempt.

---

## [1.17.1] — 2026-08-22

### 🔧 Discord Settings Moved

- **Discord configuration now lives in Settings**, next to the channel backfill that uses it, instead of on the public site's Site Editor. It was an operational setting sitting among appearance options — and it put a bot-token field on a page otherwise served to anonymous visitors. The endpoint behind it was always admin-only, so nothing was exposed, but a credential form does not belong in the public bundle.
- The Site Editor points at the new location rather than silently dropping the feature.

---

## [1.17.0] — 2026-08-22

### 🎛️ New Settings Panel

- **A dedicated Settings tab** under Administration, for the things that previously required editing `.env` and restarting: data retention, the default server limit for new accounts, self-registration, the login attempt limit, and session length. Changes take effect immediately, and the database value overrides the environment.
- Retention now shows **how many rows you actually have**, so "30 days" means something when you can see it is holding two million samples.
- Site appearance stays under **Site Editor** — the split is operational settings here, presentation there.

### 🔔 Discord Channels For Existing Servers

- **Servers created before you set up the bot can now get a channel.** Auto-provisioning only ever ran at creation time, so older servers were stuck without one and there was no way to fix that short of recreating them.
- **Channels deleted in Discord are re-created.** This was previously invisible: deleting a channel by hand left the panel posting into a webhook that returned 404 forever, and because notification failures are deliberately silent, nothing ever told you.
- **Preview first.** A dry run reports exactly what would happen before anything is created.
- A webhook you entered by hand is never touched, and if the panel cannot confirm whether a channel still exists it skips that server rather than risk creating a duplicate.

### 🧪 Quality

- **244 tests** (21 new) and **95 security checks** (7 new). Verified on a running server that none of the new settings appear in the public site-settings response.

---

## [1.16.0] — 2026-08-22

### 🛠 Deleting Things Actually Works

- **Deleting a server could destroy its files and then fail.** Every foreign key in the database was declared without an `ON DELETE` rule, so PostgreSQL refuses to delete a row that anything else points at. Scheduling a nightly restart was enough to make a server **permanently undeletable** — and because the delete removes the game files from disk *before* the database row, pressing Delete wiped the world data, threw an error, and left the server still listed. Dependent records are now cleared first.
- **Deleting a user who owned anything always failed** with an unexplained error. It now refuses politely and tells you what to remove first, instead of silently cascading and destroying that user's servers and forum history.

### 🗄 Two Missing Tables

- **API keys and forum chat were broken on every fresh install.** Both tables are defined in the schema and queried by the panel, but the installer created 16 of the 18 tables and skipped these two, so both features failed outright with a database error. A test now compares the schema against the installer so they cannot drift apart again.

### ⚡ Races Under Load

- **The server limit could be exceeded.** Creating several servers at the same moment let all of them through — each request checked the count before any of them had finished. Five simultaneous requests against a limit of two created five servers. The limit is now evaluated by the database as part of the write.
- **Two servers could take the same port.** Same cause. The loser would fail to start and show as *crashed* with no explanation. The database now enforces one server per port, per node.
- **Existing duplicate ports are repaired automatically on upgrade.** Panels that already had two servers sharing a port would otherwise have failed to start after this change. The oldest server keeps its port; the others move to the nearest free port *above* it — staying in the range you have already forwarded — and each change is logged so you can update port forwarding. Servers on different machines using the same port are left alone.

### 🧪 Quality

- **223 tests** (21 new) and **88 security checks** (6 new). The new tests run the installer's own SQL against a real PostgreSQL engine, so schema problems are caught before a release rather than on someone's server.

---

## [1.15.0] — 2026-08-22

### 🔑 API Key Scopes Now Work

- **A "read-only" API key had full access.** Keys can carry a permission scope, the create endpoint accepted one, and the panel displayed it — but nothing ever read it back, so every key silently acted with its owner's complete rights including delete. Anyone who scoped a key for a monitoring script and pasted it into a third-party service had effectively handed over their whole account. Scopes are now enforced on every permission check.
- Keys created before this change are unaffected: a key with no scope stays unrestricted.
- **Scopes are validated when the key is created.** A typo such as `servers.veiw` used to be stored happily and produce a key that denied everything — indistinguishable from a broken panel. It is now rejected with the unknown name.

### 🔢 Ports Are Validated

- **Any value was accepted as a port.** `"abc"`, `-1`, `99999`, `1.5` and an empty string all reached the database and the firewall command line unchecked. Ports are now required to be whole numbers in range.
- **Privileged ports are refused.** Ports below 1024 need root, so the panel was happily assigning users ports their servers could never bind — and letting someone reserve port 22 or 80.
- **Two servers could take the same port.** Nothing checked for collisions, so the second server would simply fail to start and report itself *crashed* with no explanation. Creating, editing and cloning now detect the clash and name the port.
- **Cloning picked a colliding port by default.** A clone took the source's port plus one, which for most games is the source's own query port. Cloning now finds the next genuinely free block.

### 📊 The Server Limit Is Real

- **`maxServers` was never enforced.** It is set per user, editable by admins, and shown in the profile and admin panels as "3/5" — but no code read it, so any user could create servers without limit on a machine with finite RAM and disk. Enforced now on both create and clone (a user at their limit could previously clone straight past it). Admins are exempt; `0` means unlimited.

### 🔒 Security

- Cloning no longer accepts an install path from the request body. That path is handed to a shell script when the server starts, which is why it was already blocked on the edit endpoint.
- **202 tests** (37 new) and **82 security checks** (9 new). Cross-request isolation of the new permission context is tested explicitly with concurrent interleaved requests, and verified against a running server.

---

## [1.14.0] — 2026-08-22

### 🔒 Security — Credential Disclosure

A workspace-wide debug sweep focused on what actually leaves the server. Two endpoints were returning secrets.

- **Node SSH credentials were readable by moderators.** `GET /api/nodes/[id]` fetched the row without a column list and returned it whole — including `sshPassword`, `sshKeyPath` and the node's API key, in plaintext. The permission guarding it is `nodes.view`, which the **built-in moderator role has by default**, so any moderator could read the SSH login for every machine and connect directly, bypassing the panel entirely. The node *list* endpoint was never affected; it already used an explicit column list. Creating a node also echoed the credentials straight back in the response.
- **User password hashes and 2FA secrets were returned on update.** `PATCH /api/users/[id]` checks permissions carefully on every individual field, then ended with `.returning()`, which hands back every column — so editing a user returned their bcrypt hash **and** their `twoFactorSecret`. The TOTP seed is the damaging one: it generates the same codes as the user's authenticator app, so leaking it defeats their 2FA completely.
- **`PATCH /api/nodes/[id]` accepted any field.** Same shape as the servers endpoint fixed in 1.13.0. Beyond the credentials, `isLocal` decides whether the panel runs game processes on that machine, so being able to set it redirected process control. Now restricted to an explicit list.

### 📝 Corrections

- The database schema described the node SSH password column as `// encrypted`. **It is not** — the panel has no encryption layer of any kind. The comment is corrected rather than left implying a protection that was never there. Key-based authentication avoids the issue and is the better option.

### 🧪 Quality

- **165 tests** (11 new) and **73 security checks** (6 new). Each new check was confirmed to fail when the bug is reintroduced.
- Swept clean, and recorded as such: no `dangerouslySetInnerHTML`, no `exec`/`shell: true` anywhere, every `spawn` using an argument array, all five shell scripts shellcheck-clean, and 0 dependency vulnerabilities.

---

## [1.13.0] — 2026-08-22

### 🔁 Dead Settings That Now Actually Work

A debug sweep of the whole panel turned up three settings the interface already advertised but nothing ever acted on.

- **"Auto-restart" now restarts things.** The badge on every server card had been purely decorative: the column was stored, displayed, and copied when cloning, but no code path ever read it, so a crashed server stayed down regardless of the setting. A crash detected by the status poll now relaunches the server, updates its PID and start time, and posts a `server_restarted` notification (honouring the per-server toggle). If two browser tabs spot the same crash, only one restart happens — previously this would have been two processes fighting over one port.
- **"Start on node boot" now starts things on boot.** `autoStart` was written when cloning a server and read by nothing at all. Servers marked for it are now relaunched when the panel process starts, which after a machine reboot means exactly what the label promises. Anything still running is left alone rather than started twice.
- **Both toggles are editable.** They were previously read-only badges with no control anywhere in the UI — the only way to change `autoRestart` was to clone a server or edit the database. They are now clickable, and save immediately.

### 🧹 Cloning No Longer Steals a Channel

- A clone used to inherit the original's Discord webhook even when the panel had created that channel *for the original*. The clone posted into a channel it did not own, and deleting the **original** deleted the channel — leaving the clone quietly posting into a webhook that returned 404. Clones now get their own channel; a webhook you entered by hand is still shared, because nobody owns it.

### 🔒 Security

- **`PATCH /api/servers/[id]` was mass-assignable.** The handler merged the entire request body into the database row, so any account with `servers.edit` could rewrite `installPath` — the path the panel hands to a shell script when starting a server — or reassign `userId` to take ownership of someone else's server. The endpoint now accepts an explicit list of editable fields and rejects anything else with a `400`.

### 🧪 Quality

- **154 tests** (21 new) and **67 security checks** (4 new). The new tests cover the rules directly: reverting either the clone fix or the auto-restart fix turns the suite red.
- Every remaining **shellcheck** warning in the shipped scripts is fixed. Notably `install.sh` captured an npm exit code that — because of a preceding `|| true` — was always `0`, so the error handling written around it could never have fired.

---

## [1.12.0] — 2026-08-22

### 🔔 Discord Settings Section
- **New Discord section in the Site Editor** covering the panel-wide webhook and automatic per-server channels, with a *Send Test Message* button and live URL validation.
- The panel webhook is now editable from the UI instead of only via `DISCORD_WEBHOOK_URL`, and the database value takes precedence over the environment.

### 📺 A Channel Per Server
- **Creating a game server can now create its own Discord channel.** The panel makes the channel, adds a webhook inside it, and stores that webhook on the server — so every later notification uses the ordinary webhook path and costs no further bot API calls. Deleting the server removes the channel.
- **This needs a bot, not just a webhook.** A webhook URL can only post into one channel that already exists; creating a channel is `POST /guilds/{id}/channels`, which requires a Bot token with *Manage Channels*. The settings UI states this plainly and walks through the Developer Portal steps, rather than letting someone paste a webhook and wonder why no channels appear.
- Channels are optionally nested under a **category**, and named with an optional **prefix** — `"My Server"` with prefix `gs-` becomes `#gs-my-server`. Names are normalised the way Discord would anyway: accents folded, punctuation stripped, truncated to 100 characters.
- **Only channels the panel created are deleted**, tracked by a new `discord_channel_id` column — a channel made by hand is never touched.
- Provisioning **can never fail server creation**: errors are logged and returned alongside the created server, which remains fully usable.

### 🔕 Per-Event Toggles Now Work
- **`discordNotifyStart` / `Stop` / `Restart` / `Crash` were dead columns.** They were stored on the server row and copied when cloning, but no code ever read them — switching a notification off had no effect whatsoever. Each is now checked before its notification is sent.

### 🔒 Security
- A bot token grants control of a Discord guild, so it is handled as a credential: admin-only endpoint, **never returned to the browser** (the client only learns whether one is set), and deliberately excluded from the public `/api/site-settings` allowlist. Three regression checks pin this.
- **133 tests** (13 new) and **63 security checks**.

---

## [1.11.0] — 2026-08-22

### 🔔 Discord Notifications
- **Crashes were never announced.** When a server died on its own, the status poller noticed the process was gone, quietly recorded it as `stopped` and sent nothing — even though `notifyServerCrashed()` was written and exported for exactly this. A crash is the one event worth pushing to an operator. The panel now distinguishes a process that vanished while it was supposed to be running (a **crash**) from a clean stop, records the right status, and fires the notification.
- **`DISCORD_WEBHOOK_URL` did nothing.** Both `.env.example` and the README documented it as the panel-wide default webhook, but no code ever read it — anyone relying on it got silence. Added `resolveWebhookUrl()`, which prefers the per-server hook and falls back to the global one, including when the per-server value is malformed. Every call site now uses it.
- **Webhook URL validation was wrong in both directions** — a bare `startsWith()` check rejected the legacy `discordapp.com` hostname that Discord still hands out, while happily accepting a URL with no id or token. Now an anchored pattern covering `discord.com`, `discordapp.com` and the ptb/canary subdomains. Since the URL is operator-supplied and the server POSTs to it, this is a small SSRF surface too; the tests cover the `discord.com.evil.com` suffix attack.
- **Every message carried two broken images** — the footer icon referenced an invented emoji id and the avatar a third-party imgur upload. Both removed.
- **Added a 10-second timeout** so a stalled Discord cannot hold a panel request open, and **failures are now logged** with the `retry-after` value on a 429. They were previously swallowed by `.catch(() => {})` and impossible to diagnose.

### 🧪 Verification
- 23 new tests (**120 total**) and 3 new security checks (**60 total**), verified against a local HTTP stub standing in for Discord: embed structure, rate-limit reporting, and the timeout.

---

## [1.10.0] — 2026-08-22

### 🌐 Port 80 Serves the Panel, Not the Distro Placeholder
- **On a box that already had Apache or nginx, the panel was invisible.** Port 80 kept serving the stock *"It works!"* / *"Welcome to nginx!"* page from `/var/www/html`, so browsing to the server looked like a failed install even though the panel was running fine on `:3000`.
- **New `public/setup-webroot.sh`**, offered by the installer and available afterwards as `sudo gsm webroot`. It **reverse-proxies** port 80 to the panel rather than issuing an HTTP redirect: a redirect to `:3000` only works if that port is reachable from the visitor, whereas a proxy keeps everything on port 80 and works through routers, firewalls and networks that only permit 80/443.
- **Handles Apache, nginx and lighttpd**, including the WebSocket upgrade needed for live logs, RCON and metrics, a 256 MB upload limit for the file manager, and the `X-Forwarded-Proto` header the panel reads to decide whether the session cookie gets the `secure` flag.
- **Detects Caddy** already proxying to the panel and does nothing, rather than fighting it for port 80.
- **Safe by default** — everything it touches is backed up to `/var/backups/gsm-webroot/<timestamp>`, `--revert` restores it, and if the web server's own config test fails the change is rolled back instead of leaving a broken server. `--redirect-only` writes a hostname-preserving redirect page into the web root for anyone who would rather not have their web server config edited.

---

## [1.9.0] — 2026-08-22

### 🔑 API Keys Were Completely Inert
- **The entire API key feature did nothing.** The panel generated a key, hashed it into `api_keys.key_hash`, and displayed instructions telling users to send `Authorization: Bearer gsm_...` — but **no code on the server ever read that header**, and the stored hash was never compared against anything. Every documented external integration failed with a `401`.
- **Now implemented properly** — wired into `getCurrentUser()`, so all 151 call sites accept API keys with no per-route changes. The lookup narrows by the indexed (non-secret) key prefix, compares the full SHA-256 digest with `timingSafeEqual`, rejects expired keys and keys whose owner is suspended or banned, and updates `last_used_at` on a best-effort basis.
- SHA-256 rather than bcrypt is deliberate: an API key is 32 bytes of CSPRNG output with no dictionary to attack, and this runs on the hot path for every API request.

### 🧪 The First Unit Tests
- **The repo had no tests.** The verify harnesses cover installers and grep the source for security fixes, but nothing exercised the logic that runs at request time. Added **81 tests** using Node's built-in runner — no new dependencies.
- **`config-render` (22)** — ten output formats, XML escaping, nested objects, `__files` routing, directive stripping. This is the code that writes every game's config, so a regression here produces a file the engine rejects or, worse, silently accepts with wrong values.
- **`server-file-ops` (18)** — `safePath()`, the guard on every file-manager operation, including the sibling-prefix case (`/srv/mc` vs `/srv/mc-evil`) that was a real vulnerability. **Verified these tests fail when the old buggy implementation is restored**, so they genuinely catch it.
- **`auth` (17)** — salted one-way password hashing, JWT round-trips, rejection of tampered and re-encoded payloads, cookie flags, and the login throttle.
- **`pagination` (14)** and **`api-key` (10)**.
- `npm test` runs them; `npm run verify` and CI now include them.

### 🔒 Verification
- Security suite grows to **57 checks**, pinning the API key verification path.

---

## [1.8.1] — 2026-08-22

### 🐛 Fixes
- **Uploading a folder kept its structure.** Drag-and-drop upload flattened every nested directory into a single level, so dropping a modpack scattered its contents. Folder trees are now walked and recreated on the server, and picking a folder is supported alongside dropping one.
- **Typing in game settings no longer loses the cursor.** Each keystroke in a server's configuration fields rebuilt the form and pushed focus back to the start of the input, making the fields effectively unusable for anything longer than a word.

---

## [1.8.0] — 2026-08-22

### 🗄️ Unbounded Data Growth
- **The metrics tables had no cleanup whatsoever.** `node_metrics`, `server_metrics` and `audit_log` are append-only and nothing in the application ever deleted a row. A node heartbeating every 10 seconds writes roughly **8,600 rows per day**, so a five-node panel reaches about **16 million rows and ~2.4 GB within a year** — while the dashboards only ever read the recent tail.
- **Retention is now amortised onto the writes** — a heartbeat occasionally (2% of the time, at most once a minute) prunes rows past the retention window. No external cron, no extra moving parts, and failures are logged and swallowed so retention can never fail a heartbeat.
- **Configurable windows** — `METRICS_RETENTION_DAYS` (default 30) and `AUDIT_RETENTION_DAYS` (default 365, since audit trails are usually a compliance concern). Set either to `0` to keep everything.
- **Two more missing indexes** — `server_metrics(server_id, recorded_at)`. Without `recorded_at` the prune `DELETE` would sequential-scan the largest table in the schema.
- **`/api/maintenance/retention`** — admin-only endpoint to inspect row counts and force a prune on demand.

### 🔢 Pagination Hardening
- **Six unclamped query parameters across four routes** went straight from `parseInt` into SQL. `?limit=999999999` read an entire table into memory — a single authenticated request could exhaust server RAM against the very tables that grow without bound. `?limit=abc` produced `NaN` and `?limit=-1` a negative `LIMIT`, both of which Postgres rejects with a syntax error surfaced as a 500.
- Added `src/lib/pagination.ts`, which always returns a sane integer inside a fixed 500-row ceiling, and switched `audit-log`, `cms` and the database table browser over to it. (The chat endpoint already clamped correctly.)

### 🧪 Verification
- Security suite grows to **52 checks**, including a sweep that fails if any route reintroduces a raw `parseInt` on a pagination parameter.

---

## [1.7.0] — 2026-08-22

### 🛡️ Security Headers
- **The panel shipped with no security headers at all.** Since it executes shell commands, edits files on disk and holds database credentials, an XSS or clickjacking attack against a logged-in admin is effectively remote code execution on the host. Added a Content-Security-Policy plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS.
- **`X-Powered-By` disabled** — the exact framework version is no longer advertised to anyone scanning the panel.
- The CSP permits `'unsafe-inline'` for styles (Tailwind and the custom theme editor set inline style attributes) but **never `'unsafe-eval'` in production**. Verified against a running server: all headers present, every JS chunk still loads, page renders unchanged. The app references no external origins, so `default-src 'self'` breaks nothing.

### 🔐 Dependencies
- **Three high-severity CVEs cleared** — `npm audit` flagged advisories reaching production dependencies transitively through Next.js: `sharp` (inherited libvips CVE-2026-33327, -33328, -35590, -35591), `postcss`, and Next itself. Upgrading **16.2.6 → 16.3.2** — a patch-level bump inside the existing major, no migration required — takes the audit to **0 vulnerabilities**.

### ⚙️ Continuous Integration
- **The repo had no CI.** Every gate built over the last few releases only ran when someone remembered to run it. A GitHub Actions workflow now runs typecheck, lint, the template and installer harnesses, the security suite, a production build, and a high-severity dependency audit on every push and pull request.
- **Weekly upstream monitoring** — `check-upstreams.sh` runs on a schedule and on demand rather than per-PR, so a game download endpoint going stale gets noticed without failing unrelated pull requests.

### 📄 Licensing
- **Added the missing `LICENSE` file.** The README advertised MIT, but no license text existed anywhere in the repo — which legally left the project as all-rights-reserved regardless of what the docs claimed.

---

## [1.6.0] — 2026-08-21

### 🎮 Three Game Installers Were Completely Broken
- **Terraria, Assetto Corsa and Minecraft Paper could never install** — install scripts live inside untagged template literals, so a single backslash is consumed by JavaScript before bash sees it. `\s` became `s` and `\K` became `K`, silently turning each PCRE into one that matches nothing. All three aborted with "could not find/resolve" every single time. Fixed by escaping the patterns, and verified end to end.
- **Minecraft Java installed the wrong JDK** — the script grepped Mojang's version JSON for `"major_version"`, but the real key is `"majorVersion"`. The pattern never matched, so the required Java version silently fell back to 21. Checked against the live API: Minecraft 26.2 needs Java **25**, so the installer provisioned a JDK too old to run the server. It now reads the correct key and keeps the old spelling as a fallback.
- **SteamCMD `chown` was a no-op** — the shared installer ran `chown -R $(whoami)` unquoted, which does nothing useful unless running as root. It now runs only as root, with the user and group quoted.

### 🧪 Installers Are Now Actually Executed in CI
- **`npm run verify:installers`** — renders each of the 27 templates, runs `bash -n` and shellcheck, then **runs the install script for real** inside a throwaway directory in a user + mount namespace, with `steamcmd`, `curl`, `wget` and `apt` mocked and a tmpfs over `/opt`. It then asserts the runtime artifacts the panel needs to launch the server were actually produced, and that the start command resolves to something that exists. All 27 games pass.
- **`npm run check:upstreams`** — hits the real download endpoints and release APIs and confirms our parsing expressions still match what upstream returns today (18/18 passing). Kept out of `npm run verify` because upstream outages are not repo regressions.
- **The mangled-backslash bug now fails the build** — `verify:templates` detects the pattern itself, so this class of bug cannot return.

### 🔒 Security & Correctness
- **69 error sites across 46 API routes leaked internal detail** — failures returned the raw exception message, exposing SQL fragments, driver internals and absolute filesystem paths. All now route through `apiError()`, which logs the detail server-side and returns a generic message in production.
- **`/api/health` leaked database credentials** — the endpoint is unauthenticated (the installer and updater poll it) and returned the driver's error verbatim, which includes the host, port and sometimes the password from the connection string.
- **Registration accepted almost anything** — no password strength requirement, no length caps (an over-long username produced a `500` from the database instead of a `400`), no rate limiting despite creating rows and running bcrypt, raw error text returned to the caller, and a race between the duplicate check and the insert. It now validates the username format and every field length, requires 8+ character passwords, reuses the login throttle, uses a single existence query, and handles the unique-violation race it cannot prevent.
- **Security regression suite grew from 33 to 40 checks**, including a sweep that fails if any route reintroduces a raw exception message.

### ⚡ Performance
- **14 database indexes added** — the schema declared 19 foreign keys and *zero* indexes, so every join and filter was a sequential scan. Indexed the columns the code actually filters on: `game_servers(user_id, node_id, game_id)`, `node_metrics(node_id, recorded_at)`, `forum_threads(category_id, user_id)`, `forum_posts(thread_id, user_id)`, `chat_messages(created_at, user_id)` — polled every 2.5 seconds by the chat widget — plus `audit_log(user_id, created_at)` and `api_keys(user_id)`. Applied automatically by `drizzle-kit push` during install and update.

---

## [1.5.0] — 2026-08-21

### 🔒 Security Audit — 11 Issues Found, 11 Fixed

A full-repository audit covering build/type/lint gates, correctness, security, and runtime behaviour. Two critical findings, five high, three medium, one low. See `DEBUG-REPORT.md` for the complete write-up.

**Critical**
- **Remote code execution in the backup route** — `POST/DELETE /api/servers/[id]/backup` interpolated the caller-supplied backup name into a shell string, so a name containing `;` or a backtick ran arbitrary commands as the panel user. Backups now spawn `tar` directly with an argument array (no shell), names must match `^backup-[A-Za-z0-9._-]+\.tar\.gz$`, and the resolved path is required to sit inside the server's backup directory.
- **SQL injection in the database row editor** — `/api/database/table/[name]/row` built `UPDATE`/`DELETE` statements by string-concatenating column names from the request body. Columns are now validated against a live `information_schema.columns` allowlist, identifiers are quoted with a dedicated `quoteIdent()` helper, and empty or unbounded statements are rejected before they reach the driver.

**High**
- **Path traversal in the file manager** — `safePath()` accepted sibling directories whose names merely started with the base path (`/opt/gameservers/foo-evil` passed the check for `/opt/gameservers/foo`). Containment is now an exact match or a `base + separator` prefix, which also fixes the file upload route that depends on it.
- **Hardcoded fallback JWT secret** — the shipped default `gsm-panel-secret-change-me` let anyone forge a session token against a deployment that never set `JWT_SECRET`. The fallback is gone; production requires the variable and refuses to boot without it, and development derives a random per-process secret.
- **2FA could be bypassed** — the login endpoint enforced TOTP but the login form never asked for a code, so accounts with 2FA enabled were unreachable rather than protected. The form now handles the `twoFactorRequired` response and submits the code.
- **Suspended and banned users kept working sessions** — account status was checked at login but nowhere afterwards. `getUserPermissions()` now denies everything for non-active users, and `/api/auth/me` returns 403 and clears the session cookie.
- **Node heartbeat accepted unconfigured keys** — a node with a `NULL` API key authenticated any caller, and the comparison was a plain string equality vulnerable to timing analysis. Heartbeats now require a configured key and compare with `timingSafeEqual`.

**Medium & low**
- **Brute-force protection on login** — 10 attempts per IP + username within a 15-minute window, answered with `429` and a `Retry-After` header.
- **Internal errors leaked to clients** — a new `apiError()` helper logs the detail server-side and returns a generic message in production.
- **Five `react-hooks/set-state-in-effect` violations** — `PublicChatWidget`, `SandboxChat`, `ForumPanel`, and `PublicSite` set state during render-phase effects, causing redundant re-renders and duplicate fetches. All are ref-guarded now, and ESLint is clean.

### 🎮 Complete Game Template Library
- **27 games, 1,551 configurable options** — every template now exposes its game's full server config surface, categorized, typed, validated, with enums and defaults, and each option is genuinely consumed by the install script, config files, or start command.
- **One module per game** — the monolithic seed file was split into `src/db/games/`, with shared `types.ts`, a reusable `steamcmd.ts` installer, and a `src/db/seeds.ts` shim so existing importers keep working unchanged.
- **Multi-file config rendering** — templates can emit several config files in different formats (INI with sections, JSON, key=value, Quake 3 `set` syntax) via `src/lib/config-render.ts`. V Rising writes both `ServerHostSettings.json` and `ServerGameSettings.json`; Assetto Corsa writes a sectioned `server_cfg.ini` alongside `entry_list.ini`.

### 🧪 Tooling
- **`npm run verify`** — one command chaining `typecheck`, `lint`, `verify:templates`, and `verify:security`.
- **`npm run verify:security`** — 33 regression checks pinning every fix above, so the vulnerabilities cannot silently return.
- **`npm run verify:templates`** — validates all 1,551 template options and reports unused or undeclared variables per game.
- **`.env.example`** — documents every supported environment variable, required and optional.
- **`.gitignore`** — added; build output, `node_modules`, and local `.env` files are no longer tracked.

### 📦 Installer, Updater & Uninstaller
- **The updater no longer breaks on the new `JWT_SECRET` requirement** — `update.sh` now backfills a secret into `.env` after pulling code if the variable is missing, empty, or shorter than 32 characters, and adds `NODE_ENV=production` when absent. Without this, every pre-1.5.0 install would have failed at the build step. Secrets that are already valid are left untouched, so sessions survive the upgrade.
- **Build success is detected correctly** — `install.sh` and `update.sh` checked for a `.next` *directory*, which Next.js creates even when the build fails; a broken build was reported as successful and the panel was restarted onto stale output. Both now check for `.next/BUILD_ID`, which is only written on success, and the build directory is cleared first so a previous build cannot mask a failure.
- **Rollback verifies its own rebuild** — `update.sh --rollback` discarded all build output and never checked the result, so a failed rollback looked clean. It now logs to `/tmp/gsm-rollback-build.log` and aborts loudly if the restored code does not build.
- **`--jwt-secret` is validated up front** — passing a secret shorter than 32 characters previously produced a fully installed panel that crashed on first boot. The installer now rejects it before making any system changes.
- **Uninstaller gained `--install-dir` and `-y`** — it hardcoded `/opt/gsm-panel`, so panels installed with `--install-dir` could not be removed. It also now rejects unknown flags instead of ignoring them, supports `--help`, and no longer lets `.install-info` override an explicitly passed directory.

### ⚠️ Breaking Changes
- **`JWT_SECRET` is now required in production** and must be at least 32 characters. The panel exits at startup if it is missing. Generate one with `openssl rand -hex 32`.
  - Installs created by `install.sh` are **unaffected** — the installer already generates a 62-character secret and writes it to `.env`.
  - Only manual installations that relied on the old auto-generated fallback need to add the variable before upgrading. Existing sessions are invalidated the first time the secret changes.

---

## [1.4.0] — 2026-01-01

### 🐺 Wolfenstein: Enemy Territory — Full server.cfg Options in the Installer
- **Every ET server.cfg option is now exposed in the server creation installer** — the Wolfenstein: Enemy Territory / ET:Legacy template grew from 2 variables to **150+ template variables**, covering the complete official `etl_server.cfg` and `legacy.cfg` option sets.
- **Grouped, collapsible option categories** — the Create Server wizard's "Game Settings" step now groups template variables by category with collapsible sections, so large option sets stay navigable:
  - Server Identity (mod, game type select with labels, start map, 2.60 rotation override, all 6 MOTD lines)
  - Clients, Passwords (server/RCON/referee/shoutcast), Network (advertising, timeouts, ping limits, IPv4/IPv6 bind overrides)
  - Master Servers (all 6 `sv_master*` cvars), Download (rates, allow/web download, www redirect URLs)
  - Logging & Protection (logfile, pure, DDoS protection, flood protect, per-IP limits, PunkBuster)
  - Mod Logging & Protection (g_log, GUID check), Optimizations (anti-warp)
  - XP Skill Levels (all 7 `skill_*` thresholds), Class Limits (all 5), Weapon Limits (all 9)
  - Gameplay (34 cvars incl. friendly fire, lives, warmup, intermission, complaints, pmove physics)
  - Match (6 cvars), LMS (5 cvars), Voting (all 23 `vote_allow_*` flags + percent/limit), Map Voting, Lua, Omni-Bot, Watchdog
- **Complete generated server.cfg** — the installer now writes a fully populated server.cfg with all 140+ cvars (mirroring upstream `etl_server.cfg` + `legacy.cfg`), with bash-derived map-rotation directives matching the chosen game type (`objectivecycle.cfg` / `campaigncycle.cfg` / `lmscycle.cfg` / `mapvotecycle.cfg` / single map / legacy `sv_mapRotation`).
- **Template-driven default config** — `defaultConfig` now carries the full cvar map so the panel's config materializer regenerates a complete config; new `__gsm_format: "quake3"` directive renders `.cfg` files as `set cvar "value"` lines.
- **Numeric checkbox normalization** — wizard checkboxes with `0`/`1` defaults are normalized to `"0"`/`"1"` at install time (id Tech 3 treats the strings "true"/"false" as 0), keeping other engines' `true`/`false` semantics untouched.
- **Safer tokenized config paths** — `configFiles` entries like `{{ET_MOD}}/server.cfg` are skipped if the token resolved to an empty value instead of writing to a stray root path.
- **Improved start command** — ET launches with `+set vm_game 0` for reliable `.so` game-module loading, honoring the selected mod folder.

---

## [1.3.0] — 2026-08-15

### 💬 Public Chat Widget (Guest-Visible, Configurable)
- **Public-facing chat widget** — a floating community chat overlay visible on all public site pages (home, forums, blog, changelog, ladder). Guests and unauthenticated visitors can **read** the chat in real-time, but only logged-in users can **send** messages.
- **Read-only for guests** — the `GET /api/forum/chat` endpoint no longer requires authentication, allowing anyone to poll and view chat messages. `POST` and `DELETE` still require a valid session.
- **Login prompt** — unauthenticated users see a "Login to Chat" button in the chat input area, making it easy to convert visitors into registered users.
- **Configurable position** — admins can set the widget's default screen position via the Site Editor: Bottom Right, Bottom Left, Top Right, or Top Left.
- **Configurable size** — admins can set the widget's width (280–600px) and height (200–800px) from the Site Editor, controlling how much screen real estate the chat uses.
- **Enable/disable toggle** — the widget can be fully disabled from the Site Editor without code changes.
- **Draggable** — users can click-and-drag the chat header to reposition the widget anywhere on their screen during their session for maximum flexibility.
- **Site Settings integration** — four new public setting keys: `chat_enabled`, `chat_position`, `chat_width`, `chat_height` — all configurable from the ✏️ Edit Frontpage panel.
- **Minimized by default** — the floating widget starts collapsed to avoid blocking content; unread badge shows new message count while minimized.
- **Same theme integration** — inherits all CSS custom properties from the 5 built-in themes, maintaining visual consistency with the rest of the site.
- **3-second polling** — the public widget polls every 3 seconds (vs 2.5s in the dashboard chat) to balance real-time feel with guest traffic load.

---

## [1.2.0] — 2026-08-15

### 🗨️ Real-Time Sandbox Chat
- **New Forum Sandbox Chat** — a persistent, real-time chat box embedded in the Forum panel sidebar. Think of it as a community shoutbox / lobby chat for your game server community.
- **Live polling** — messages update every 2.5 seconds via short-polling (`GET /api/forum/chat?after=<lastId>`), giving a near real-time experience without WebSocket complexity.
- **New database table** — `chat_messages` table (id, user_id, body, created_at) with foreign key to `users`.
- **Full REST API** — `GET /api/forum/chat` (fetch messages with optional `?after=<id>` for incremental polling and `?limit=<n>`), `POST /api/forum/chat` (send message, max 1000 chars), `DELETE /api/forum/chat` (delete own message or any message if admin/moderator).
- **Active user count** — header shows how many unique users have chatted in the last 5 minutes, with a pulsing green dot indicator.
- **Unread badge** — when the chat is minimized, new incoming messages increment an unread counter badge on the header.
- **Collapsible UI** — click the chat header to minimize/expand; chat state persists during the session.
- **Auto-scroll** — automatically scrolls to the latest message unless the user has scrolled up to read history.
- **User avatars** — displays initials with color-coded badges (accent for own messages, muted for others).
- **Role badges** — ADMIN and MOD badges displayed next to usernames, matching the forum's role badge style.
- **Message moderation** — admins and moderators can delete any message; regular users can delete only their own.
- **Responsive layout** — on large screens (xl+), the chat appears as a sticky sidebar next to forum content. On smaller screens, it stacks below the forum content.
- **Themed** — fully integrated with all 5 panel themes (Nebula Dark, Cloud Light, Ember Sun, Forest Command, custom user themes) using existing CSS custom properties.
- **Character limit** — 1000 character limit per message with server-side validation.
- **Relative timestamps** — messages show "just now", "5m ago", "2h ago", or date for older messages.

---

## [1.1.0] — 2026-08-12

### 🐳 LXC / Container Support
- **Auto-detect LXC and Docker containers** at install time via `/proc/1/environ`, `/.dockerenv`, and cgroup markers.
- **Subnet-scored interface detection** — scans all interfaces and scores them by IP range: `192.168.x.x` (100), `172.16–31.x.x` (80), general `10.x.x.x` (30), `10.0.3.x` LXC bridge (5), `10.172.x.x` ASUSTOR internal (2). Picks the highest-scoring interface as the real LAN — works correctly even when the LAN is on `eth1` (ASUSTOR) instead of `eth0`.
- **Force LAN gateway** — always sets the detected LAN interface as the default route (`metric 10`), regardless of which `ethN` device it's on, ensuring port forwarding from your router works correctly.
- **Remove conflicting internal gateways** — strips default routes on every interface except the detected LAN device, including ASUSTOR's injected `10.172.5.1` management gateway.
- **Persistent boot fix** — installs a systemd oneshot service (`fix-container-routing.service`) that re-applies the LAN gateway preference on every container reboot, with a 10-second delay to let the host platform finish its own network setup first.
- **Internet verification** — tests outbound connectivity after applying the routing fix and warns if the internet is still unreachable.
- **UFW skipped in containers** — `ufw --force enable` inside an LXC container conflicts with the host's iptables/nftables and drops SSH connections. The installer now detects containers and skips UFW entirely, printing a reminder of which ports to forward on the router instead. UFW is only configured and enabled on bare-metal/VM installs.

### 🔥 Automatic Firewall Management
- **Dynamic port rules** — creating a game server now automatically opens its game port, query port, and RCON port in UFW (TCP + UDP). Deleting a server removes the rules. Changing a server's port updates the rules.
- **Tagged rules** — each UFW rule is labeled `GSM:<serverId> <serverName>` for easy identification in `ufw status`.
- **Port change tracking** — `PATCH /api/servers/[id]` diffs old vs new ports and only adds/removes the changed rules.
- **Firewall API** — new `GET/POST /api/firewall` endpoint for admins to view UFW status and manually allow/deny ports from the panel.
- **Firewall utility module** — `src/lib/firewall.ts` wraps all UFW operations with best-effort error handling (missing `ufw` binary never crashes the panel).

### 🎮 SteamCMD Integration
- **Automatic installation** — the installer downloads SteamCMD, extracts it to `/opt/steamcmd`, installs 32-bit libraries (`lib32gcc-s1`, `lib32stdc++6`), and runs first-time setup.
- **Helper script** — `/opt/steamcmd/install-game.sh <app_id> <install_dir>` for quick game server installation with common App ID reference.
- **Global symlink** — `/usr/local/bin/steamcmd` for easy command-line access.
- **Skip option** — `--no-steamcmd` flag for Minecraft-only or non-Steam setups.
- **Multi-distro lib32 support** — tries `lib32gcc-s1`, `lib32gcc1`, and `libc6:i386` in order for maximum compatibility.

### 🌐 Caddy Reverse Proxy (replaces Nginx)
- **Replaced Nginx/Certbot** with [Caddy](https://caddyserver.com/) — automatic HTTPS with zero configuration.
- **Single `--caddy` flag** replaces the old `--nginx` + `--ssl` flags.
- **Caddyfile** includes WebSocket support, 256MB upload limit, gzip/zstd compression, and security headers.
- **Graceful failure** — if Caddy can't be installed, the installer warns and continues without it.

### 🔒 Full Game Port Coverage
- Installer now opens UFW ports for **every game in the template library** (27 games):
  - Added: Rust (28015 + 28016 RCON), Satisfactory beacon (15000), 7 Days to Die (26900–26902), Palworld (8211), Enshrouded (15636–15637), Insurgency: Sandstorm (27102 + 27131), Squad (7787), Arma 3 (2302–2306), ET: Legacy / Quake Live (27960), OpenRA (1234), Xonotic (26000), V Rising (9876–9877), Project Zomboid (16261–16262), Factorio (34197), Don't Starve Together (10999–11000), Assetto Corsa (9600).
  - Previously only covered: Source engine, Minecraft, ARK, Valheim.
- **UFW not required** — if `ufw` is not installed (common in LXC containers), the firewall step is skipped with a warning listing ports to open manually.

### 🛡️ SSH Safety
- **Auto-detect SSH port** — reads from `/etc/ssh/sshd_config`, drop-in configs in `/etc/ssh/sshd_config.d/*.conf`, and the active `$SSH_CONNECTION` environment variable.
- **Allow SSH before enabling UFW** — prevents lockouts even on non-standard SSH ports.
- **Dual-port safety** — if the active session is on a different port than sshd_config specifies, both ports are allowed.
- **Port 22 safety net** — port 22 is always allowed in addition to the detected SSH port, preventing lockouts if the detection is wrong.

### 🐧 Debian 13 (Trixie) Support
- **PostgreSQL fallback** — the official PGDG repo uses Bookworm packages that have unmet dependencies on Trixie (`libicu72`); installer now falls back to Debian's built-in PostgreSQL 17 package.
- **Removed `software-properties-common`** — Ubuntu-only package that doesn't exist on Debian; base package install no longer fails silently.
- **Split package installation** — core, build, and security packages installed separately with individual error handling.
- **Container-aware service management** — uses `systemctl` when available, falls back to `service` for non-systemd environments.

### 📦 Installer Reliability
- **Fixed `set -e` silent kills** — all `su -c`, `npm ci`, `npx next build`, `npx drizzle-kit push`, and `grep` pipeline commands now use `|| true` to prevent `set -euo pipefail` from terminating the script before error handling can run.
- **Full `npm ci` with devDependencies** — fixed the `--omit=dev` bug that skipped typescript, tailwindcss, postcss, and drizzle-kit (all required to build). DevDependencies are pruned after the build to save disk.
- **Build verification** — checks for `.next` directory existence instead of exit codes to confirm the build succeeded.
- **Dependency verification** — checks `node_modules/.bin/tsc` exists before attempting the build.
- **Improved error output** — all steps log to `/tmp/gsm-*.log` files; failures display the last 20–40 lines of the relevant log instead of failing silently.
- **Temp server fix** — uses `npx next start` instead of `node .next/standalone/server.js`; health check tries both `127.0.0.1` and `localhost`; 3-second startup delay; proper cleanup with `fuser -k`.

### 🔄 Updater Script
- **One-liner updater** — `bash <(curl -fsSL .../update.sh)` or `gsm update` to update the panel to the latest version.
- **Pre-update backup** — automatically backs up `.env`, `drizzle.config.json`, `ecosystem.config.cjs`, `.install-info`, current git commit, and a full `pg_dump` of the database before updating.
- **Backup rotation** — keeps the last 5 backups in `/opt/gsm-panel-backups/`, prunes older ones automatically.
- **Rollback** — `update.sh --rollback` restores the last backup including config files and git checkout.
- **Changelog preview** — shows new commits before applying the update.
- **Branch support** — `--branch staging` to pull from a non-default branch.
- **Health check** — verifies the panel responds on `/api/health` after restart.
- **`gsm update` command** — added to the `gsm` wrapper so `gsm update` works from any user.

### 🔧 Install Wizard Fix
- **Fixed `POST /api/install` crash** — the settings table query that checks if the panel is already installed now has a try-catch wrapper, so the install wizard works on a completely fresh database where tables don't exist yet.

---

## [1.0.0] — 2026-08-11

### Initial Release
- **Next.js 16 App Router** with TypeScript and Tailwind CSS 4.
- **30+ game templates** — Minecraft (Java, Paper, Bedrock), CS2, TF2, GMod, L4D2, Rust, ARK, Valheim, 7 Days to Die, Palworld, Satisfactory, Terraria, Enshrouded, Insurgency: Sandstorm, Squad, Arma 3, ET: Legacy, OpenRA, Quake Live, Xonotic, V Rising, Project Zomboid, Factorio, Don't Starve Together, Assetto Corsa.
- **Multi-node support** — manage game servers across multiple machines via SSH/API.
- **Real-time monitoring** — CPU, RAM, disk, network metrics with Recharts.
- **RCON console** — remote server management from the browser.
- **File manager** — browse, edit, upload, and download server files.
- **Forum** — categories, threads, posts with user attribution.
- **CMS** — blog posts, changelogs, and static pages.
- **League ladder** — team rankings, standings, and competitive seasons.
- **Database manager** — phpMyAdmin-style table browser and SQL editor.
- **Scheduler** — cron-based automated restarts, backups, and commands.
- **API keys** — token-based API access with per-key permissions.
- **Audit log** — full activity tracking with user, action, entity, and IP.
- **Discord webhooks** — notifications for server start/stop/restart/crash.
- **Email** — SMTP notifications via Nodemailer.
- **2FA** — TOTP two-factor authentication with QR code setup.
- **Roles & permissions** — admin, moderator, user with granular permission flags.
- **5 themes** — Nebula Dark, Cloud Light, Ember Sun, Forest Command, and custom user themes.
- **IPv6 support** — full dual-stack for servers and nodes.
- **Install wizard** — web-based first-run setup with admin account creation.
- **PostgreSQL** via Drizzle ORM with 18 tables.
- **One-liner installer** for Ubuntu 22.04+ and Debian 12+.
