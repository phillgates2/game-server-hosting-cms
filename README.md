<div align="center">

# 🎮 GameServer Manager

**A self-hosted game server control panel — the open-source alternative to TCAdmin.**

Deploy, configure, and monitor game servers across multiple machines from one dashboard.

<br>

![Next.js](https://img.shields.io/badge/Next.js-16.3-000000?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

<br>

<samp>**34** games · **1,753** config options · **124** API routes · **1,188** tests · **384** security checks · **25** shipped feature stages</samp>

<br>

[Quick Start](#-quick-start) · [Features](#-features) · [Games](#-supported-games) · [Configuration](#-configuration) · [Settings](#-panel-settings) · [Operations](#-operations) · [Development](#-development)

</div>

---

## ⚡ Quick Start

Run this on a fresh **Ubuntu 22.04+** or **Debian 12+** box — bare metal, VM, or LXC container:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/install.sh)
```

That's it. The installer handles everything else:

```
✓ Detects and repairs LXC/NAS container networking
✓ Installs Node.js 22, PostgreSQL, and PM2
✓ Installs SteamCMD with 32-bit runtime libraries
✓ Provisions the database and generates all secrets
✓ Opens firewall ports for every supported game
✓ Optionally fronts the panel with Caddy + automatic HTTPS
```

When it finishes, open `http://your-server:3000` and the setup wizard takes over.

<details>
<summary><b>Unattended / scripted install</b></summary>

<br>

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/install.sh) \
  --admin-user admin \
  --admin-email admin@example.com \
  --admin-pass 'YourSecurePassword123!' \
  --panel-name 'My Game Servers' \
  --domain gs.example.com \
  --caddy \
  -y
```

| Flag | Description | Default |
|:--|:--|:--|
| `--admin-user` | Admin username | `admin` *(prompted)* |
| `--admin-email` | Admin email | `admin@localhost` *(prompted)* |
| `--admin-pass` | Admin password, min 8 chars | *(prompted)* |
| `--panel-name` | Panel display name | `GameServer Manager` |
| `--domain` | Domain for the Caddy reverse proxy | *none — IP access* |
| `--port` | Panel port | `3000` |
| `--db-name` | PostgreSQL database | `gsm_panel` |
| `--db-user` | PostgreSQL user | `gsm` |
| `--db-pass` | PostgreSQL password | *auto-generated* |
| `--install-dir` | Panel installation path | `/opt/gsm-panel` |
| `--steamcmd-dir` | SteamCMD path | `/opt/steamcmd` |
| `--gameservers-dir` | Game servers directory | `/opt/gameservers` |
| `--jwt-secret` | JWT signing secret, min 32 chars | *auto-generated* |
| `--access-key` | **Master key (the install key)**, min 16 chars — the only key this panel knows; guards the web installer so nobody can claim a fresh panel without it | *auto-generated, printed once* |
| `--license-key` | Installation license key issued by the master panel — validated live before anything is installed | *(required)* |
| `--license-server` | Master panel URL that validates the key | *(required unless `--master-panel`)* |
| `--master-panel` | Install as the master panel (the key desk); skips license validation | off |

> 🔑 **Fresh master installs bootstrap themselves:** the web installer skips
> the license gate, generates your **unified master key** (shown
> exactly once), creates the offline-token signing key, and adds a starter
> product — the key desk is sellable five minutes after the install finishes.
> Re-running the installer never duplicates any of it.
| `--caddy` | Set up Caddy with automatic HTTPS | off |
| `--no-steamcmd` | Skip SteamCMD entirely | off |
| `-y`, `--noninteractive` | Skip all prompts | off |

> 🔑 **Master key:** by default the installer generates the master key,
> writes it to `.env` (`GSM_PANEL_MASTER_KEY`) and **prints it once** at the
> end of the install. The web installer refuses to run without it, so nobody
> can claim a fresh panel. That is the ONLY key — there is no panel access
> gate; login is plain username + password. Keep the master key to yourself:
> it also validates as an unlimited license key and drives the `X-Master-Key`
> admin APIs.

</details>

<details>
<summary><b>Manual installation</b></summary>

<br>

```bash
# 1 — Clone
git clone https://github.com/phillgates2/game-server-hosting-cms.git
cd game-server-hosting-cms

# 2 — SteamCMD (optional, only for Steam-based games)
sudo dpkg --add-architecture i386
sudo apt update && sudo apt install lib32gcc-s1 lib32stdc++6
mkdir -p /opt/steamcmd && cd /opt/steamcmd
curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz
./steamcmd.sh +quit

# 3 — Configure
cp .env.example .env
#    Set DATABASE_URL, then generate a signing secret:
#      openssl rand -hex 32
#    JWT_SECRET is mandatory — the panel will not start in production without it.

# 4 — Build
npm ci
npx next build

# 5 — Database schema
npx drizzle-kit push

# 6 — Run
npm start
#    ...or under PM2:
pm2 start npm --name gsm-panel -- start
```

Then visit `http://your-server:3000` to finish setup in the install wizard.

</details>

### Requirements

| | Minimum |
|:--|:--|
| **OS** | Ubuntu 22.04+ / Debian 12+ *(incl. Debian 13 Trixie)* |
| **Platform** | Bare metal, VM, or LXC container *(ASUSTOR, Proxmox, …)* |
| **Node.js** | 22.x |
| **PostgreSQL** | 14+ |
| **RAM** | 2 GB *(plus whatever your game servers need)* |
| **Disk** | 20 GB *(plus game server storage)* |
| **CPU** | 1 vCPU |

---

## ✨ Features

<table>
<tr>
<td width="33%" valign="top">

#### 🖥️ Infrastructure
- **Multi-node** management over SSH/API
- **Real-time metrics** — host *and* per-server
- **Auto firewall** — ports follow your servers
- **LXC/container** networking auto-repair
- **IPv6** throughout
- **Install wizard** for first-run setup

</td>
<td width="33%" valign="top">

#### 🎮 Server Control
- **34 game templates**, 1,749 options
- **RCON console** in the browser
- **Auto-restart** crashed servers — with a crash-loop breaker: 3 crashes in 10 minutes parks the server instead of restarting forever
- **Start on boot** after a reboot
- **File manager** — browse, edit, upload
- **Scheduler** — cron restarts, backups, updates & commands, executed by the panel itself
- **Backups** with one-click restore — automatic before every Steam update (button *and* scheduled), retention-capped and disk-space guarded
- **Age verification** — registration requires a date of birth; under-16s are refused per the Australian Online Safety Amendment Act 2024
- **Password reset** — tokenised email flow (one-time link, one hour, hash-only storage), throttled and account-enumeration-proof
- **Discord login** — optional OAuth sign-in that never bypasses 2FA and never mints accounts around the age gate
- **Player join/leave alerts** — roster diffs every poll, posted to the server's Discord (spam-safe baselines)
- **Welcome & crash emails** — signup welcomes and crash wake-ups through the existing SMTP layer
- **Bulk restart & backup** — the multi-select bar now restarts and backs up whole selections
- **2FA recovery codes** — the profile panel now has the full 2FA flow (QR → verify → eight single-use codes, hash-only) with a login fallback
- **Per-server disk stats** — the Metrics view shows the server folder size and filesystem usage
- **Anonymous-surface throttle** — the public status endpoints are capped per client (30/min) before they may trigger probes
- **Remote node agent** — a zero-dependency process for remote machines: start/stop/restart/status, log tail, **file manager and backups**, all over authenticated RPC with path containment, a Test Connection button and **one-click deploy over SSH**
- **Metrics graphs** — per-server CPU & RAM history charts (1h–7d) drawn from the samples the pipeline already records
- **Resource limits enforced** — per-server CPU/RAM caps actually stop runaway servers (warn → stop, with Discord alerts)
- **Host threshold alerts** — Discord ping when node CPU/RAM/disk stays over set thresholds (one alert per episode)
- **Stability history** — every crash, watchdog stop and auto-restart is recorded per server and shown in the Metrics view (14-day rolling window)
- **Embeddable status** — CORS-open public JSON plus copy-paste iframe/widget snippets for community sites
- **Server migration** — move a stopped server to any node with one button: archived on the source, streamed through the panel, unpacked on the destination, re-pointed in the database
- **SourceMod & Metamod:Source** — one option at setup installs the latest stable mod platform on TF2, CS:S, Garry's Mod and L4D2
- **Public status links** — an unguessable share URL shows up/down + players to anyone, no account needed, plus an opt-in aggregated board at `/status`
- **Scheduled-task Discord notifications** — cron restarts, backups, updates and commands post their outcome (including failures) to the server's webhook
- **Live logs** streamed to the panel

</td>
<td width="33%" valign="top">

#### 👥 Community & Admin
- **Settings panel** — retention, quotas
- **Forum** with categories and threads
- **Sandbox chat** — live shoutbox
- **CMS** — posts, changelogs, pages
- **League ladder** — rankings
- **Database manager** — SQL browser
- **Audit log** of every action

</td>
</tr>
<tr>
<td colspan="3" valign="top">

#### 🚀 Fleet Operations Suite
- **👥 Live rosters & peak-hours heatmap** — who is on each server right now, plus a 7-day play-pattern heatmap per server
- **🪜 Staged rollouts** — update one canary, *boot-verify it for 10 seconds*, then sweep the fleet; a bad canary halts everything
- **🔁 Rolling restarts** — one server at a time, each verified alive before the next is touched; one dark server beats a dark fleet
- **🌙 Idle-aware updates** — scheduled Steam updates that only fire after a server has been empty for hours, then auto-restart it
- **🧪 Update snapshot diffing** — every update reports `+added ~changed -removed` files and warns when configs were touched
- **📥 Update changelog** — durable per-server history of every update with its backup name and file report
- **🛡️ Verified backup restore** — scratch-extract + verify before the swap; restore points survive the restore itself
- **🗓️ Scheduled maintenance windows** — drain a node at a planned time, release it automatically; missed windows never flip anything late
- **📊 Anomaly detection** — z-score spike/drop/flatline alerts on node CPU/RAM history
- **📬 Weekly fleet digest** — Monday summary to Discord + outbound webhooks: uptime worst-first, crash/idle counts
- **🤝 Server sharing** — viewer (read-only) and operator (start/stop) collaborators per server, webhook secrets redacted
- **🧬 Blueprints** — one-click multi-server deploys from presets (10 entries, 15 servers), port-aware, stops at first failure
- **⏱️ Ephemeral test servers** — TTL clones that the sweeper removes automatically
- **🧾 Change history** — who changed what, per server, with before → after values
- **📤 Metrics CSV export** — per-server and per-node history, ready for spreadsheets
- **📣 Player-count alerts** — "tell me at 24 players", edge-triggered so busy servers never spam
- **📟 Live console** — captured stdout/stderr with 10 MB rotation, tailed in-panel every 3s (operator-and-above only)
- **🧮 Capacity planner** — "how many more TF2 servers fit on this node?" with the binding limiter named
- **🏆 Player leaderboard** — busiest servers by peak/average players over 24h/7d/30d, scoped to what you can see
- **🧹 Cleanup advisor** — advisory list of abandoned-looking servers; nothing is ever auto-deleted
- **🔮 Cron preview** — the scheduler shows the next three fire times as you type and warns when an expression can never match
- **📡 Webhook delivery log** — every outbound delivery outcome (skipped/delivered/failed) inspectable in Settings, with a saved-config test button
- **🔐 Session manager & IP allowlist** — revoke any login session; lock the panel to your CIDR ranges
- **🎟️ Licensing** — this panel doubles as the license server: issue/track/revoke installation keys (hash-only, activation fingerprints, per-key caps & expiry); every normal installation validates its key against the master panel at install time and is refused without one. Licensed panels then re-prove their activation every 6 hours via a key-less fingerprint heartbeat — an explicit revocation/expiry locks new logins immediately, while an unreachable license server gets a 72h grace window with a live countdown banner before lockout. Customers self-serve at `/license` (anonymous, rate-limited key health checks), admins can **transfer** an activation to new hardware in one click, air-gapped installs use **Ed25519-signed offline tokens**, and the master panel notifies Discord + webhooks the moment a key is **revoked** or **expires** (one notice per expiry instant — renewals re-arm exactly one)

</td>
</tr>
</table>

**Security & access** — TOTP two-factor auth · CSRF protection · granular role-based permissions · **scoped API keys** *(a read-only key really is read-only)* · per-user server quotas · login throttling · full audit trail · **🔑 one master key, no panel gate** — login is username + password; the single operator master key (auto-generated by `install.sh`, stored hash-only, rotatable in API Keys) guards fresh installs, validates as an unlimited license key, and administers the shop/license APIs via `X-Master-Key` · **tracked sessions** with per-device revocation · **IP allowlist** with CIDR rules and your-current-IP preview

**Notifications** — Discord on start, stop, restart, crash, auto-restart, update and delete, **each with a 🟢/🔴 status dot and the live player count** *(probed straight from the game: Steam A2S, Minecraft ping, Bedrock RakNet, Quake3)* · **a channel per server**, created automatically · **live status boards** — a message per server that keeps itself updated with status, map and the roster, with verified players annotated with their Discord role color name *(`• Rifleman [12ms] 🎨 Vivid Azurite`)* · **a WolfET-style chat bot** matching the community bot 1:1 — `!etwho` (with a 3-minute status cache and Python-identical difflib name matching), `!etallofoz` *(which takes a configured extra-server list and optional master-server discovery, so it can also report ET servers that are not installed in the panel — those get a 🌐 label in the same embed)*, `!stats`, `!ettop10`, `!etverify` (DM-only, message deleted, ET Verified role), `!etsync` (owner gets a DM button), `!desync`, `⌛` progress-and-edit messages, pings in the roster and `sv_hostname` in the output, plus 🟢/🔴 channel-name status and a 10-minute XP nickname sync · SMTP email via Nodemailer

**Appearance** — 4 built-in themes plus a custom theme editor, whose color fields roll pleasant random colors with a 🎲 button and show each color's stable human name live *(`✨ Vivid Azurite`)* · 3 layout densities *(compact, cozy, spacious)*

---

## 🎯 Supported Games

**34 templates, 1,749 configurable options.** Every option is typed, validated, and genuinely wired into the install script, generated config files, or start command — nothing is decorative.

<table>
<tr><th align="left">Category</th><th align="left">Games</th></tr>
<tr>
  <td><b>⛏️ Minecraft</b></td>
  <td>Java Edition <sup><code>55</code></sup> · NeoForge <sup><code>56</code></sup> · Fabric <sup><code>57</code></sup> · Paper <sup><code>52</code></sup> · Bedrock <sup><code>27</code></sup></td>
</tr>
<tr>
  <td><b>🔫 FPS</b></td>
  <td>Counter-Strike 2 <sup><code>65</code></sup> · Counter-Strike: Source <sup><code>26</code></sup> · Team Fortress 2 <sup><code>58</code></sup> · Left 4 Dead 2 <sup><code>49</code></sup> · Insurgency: Sandstorm <sup><code>42</code></sup> · Squad <sup><code>45</code></sup> · Arma 3 <sup><code>50</code></sup></td>
</tr>
<tr>
  <td><b>🏝️ Survival</b></td>
  <td>Project Zomboid <sup><code>95</code></sup> · Palworld <sup><code>92</code></sup> · 7 Days to Die <sup><code>81</code></sup> · ARK <sup><code>80</code></sup> · Rust <sup><code>56</code></sup> · Enshrouded <sup><code>54</code></sup> · Don't Starve Together <sup><code>36</code></sup> · Valheim <sup><code>28</code></sup> · Unturned <sup><code>13</code></sup> · Core Keeper <sup><code>11</code></sup> · Vintage Story <sup><code>8</code></sup></td>
</tr>
<tr>
  <td><b>🧱 Sandbox</b></td>
  <td>Terraria (TShock) <sup><code>63</code></sup> · Garry's Mod <sup><code>51</code></sup> · Factorio <sup><code>33</code></sup> · Satisfactory <sup><code>21</code></sup> · Mindustry <sup><code>9</code></sup></td>
</tr>
<tr>
  <td><b>🕹️ Classic</b></td>
  <td>Wolfenstein: ET / ET:Legacy <sup><code>158</code></sup> · Quake Live <sup><code>49</code></sup> · Xonotic <sup><code>43</code></sup> · OpenRA <sup><code>21</code></sup></td>
</tr>
<tr>
  <td><b>🧛 RPG</b></td>
  <td>V Rising <sup><code>80</code></sup></td>
</tr>
<tr>
  <td><b>🏎️ Racing</b></td>
  <td>Assetto Corsa <sup><code>67</code></sup></td>
</tr>
</table>

<sub><code>N</code> = configurable options exposed in the create-server wizard, grouped into collapsible categories.</sub>

Templates can emit **multiple config files in different formats** — sectioned INI, JSON, `key=value`, and Quake 3 `set` syntax. V Rising writes both `ServerHostSettings.json` and `ServerGameSettings.json`; Assetto Corsa writes `server_cfg.ini` alongside `entry_list.ini`.

<details>
<summary><b>SteamCMD — installing games manually</b></summary>

<br>

The installer sets up [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) at `/opt/steamcmd`, with 32-bit libraries, a helper script, and a symlink at `/usr/local/bin/steamcmd`.

```bash
# Helper script (recommended)
/opt/steamcmd/install-game.sh <app_id> <install_dir>

/opt/steamcmd/install-game.sh 730     /opt/gameservers/cs2       # Counter-Strike 2
/opt/steamcmd/install-game.sh 896660  /opt/gameservers/valheim   # Valheim
/opt/steamcmd/install-game.sh 376030  /opt/gameservers/ark       # ARK
/opt/steamcmd/install-game.sh 258550  /opt/gameservers/rust      # Rust
/opt/steamcmd/install-game.sh 2394010 /opt/gameservers/palworld  # Palworld

# Or drive SteamCMD directly
steamcmd +force_install_dir /opt/gameservers/cs2 +login anonymous +app_update 730 validate +quit
```

**Common app IDs**

| App ID | Game | | App ID | Game |
|:--|:--|:--|:--|:--|
| `730` | Counter-Strike 2 | | `4020` | Garry's Mod |
| `740` | CS:GO *(legacy)* | | `294420` | 7 Days to Die |
| `896660` | Valheim | | `233780` | Arma 3 |
| `376030` | ARK: Survival Evolved | | `2394010` | Palworld |
| `258550` | Rust | | `211820` | Starbound |
| `443030` | Conan Exiles | | `343050` | Don't Starve Together |
| `1007` | DayZ | | `232250` | Team Fortress 2 |

Only running non-Steam games? Skip it entirely with `--no-steamcmd`.

</details>

---

## ⚙️ Configuration

### Environment variables

| Variable | | Description |
|:--|:--:|:--|
| `DATABASE_URL` | **required** | PostgreSQL connection string |
| `JWT_SECRET` | **required** | Session signing secret, **min 32 characters** |
| `PORT` | optional | Panel port *(default `3000`)* |
| `STEAMCMD_PATH` | optional | SteamCMD directory *(default `/opt/steamcmd`)* |
| `GAMESERVERS_PATH` | optional | Game servers directory *(default `/opt/gameservers`)* |
| `SMTP_HOST` | optional | SMTP server for email |
| `SMTP_PORT` | optional | SMTP port *(default `587`)* |
| `SMTP_USER` | optional | SMTP username |
| `SMTP_PASS` | optional | SMTP password |
| `SMTP_FROM` | optional | From address |
| `DISCORD_WEBHOOK_URL` | optional | Panel-wide fallback webhook, used for any server without its own. Notifies on start, stop, restart, **crash**, auto-restart, update and delete |
| `DISCORD_BOT_TOKEN` | optional | Bot token, required only for automatic per-server channels *(webhooks cannot create channels)* |
| `DISCORD_GUILD_ID` | optional | Discord server ID the bot creates channels in |
| `GSM_LICENSE_SERVER` | optional | URL of the master panel that validates installation license keys. Required for normal installations (`install.sh` fails closed without it); only the master/key-desk instance may omit it |
| `GSM_LICENSE_MODE` | optional | `master` = this instance is the key desk (skips license validation); anything else = standard licensed installation |
| `GSM_TRUST_PROXY` | optional | `1` when a trusted edge proxy (Caddy) fronts the panel: client IPs are read from the **last** `X-Forwarded-For` hop (the one your proxy appended). Unset/`0` = forwarded headers are not trusted, so the IP allowlist fails closed against header-claimed identities. `install.sh` sets it automatically when Caddy is enabled |
| `GSM_PANEL_MASTER_KEY` | optional | The **master key** — the panel's only key (min 16 chars). Guards fresh installs (the "install key"), validates as an unlimited license key, and administers shop/license APIs via the `X-Master-Key` header. `install.sh` generates one by default; you can also generate/rotate it in the panel (API Keys) — stored hash-only, shown once |
| `GSM_DISABLE_AUTOSTART` | optional | Set `true` to stop servers marked *Start on node boot* from launching when the panel starts |
| `GSM_LOG_FORMAT` | optional | `text` *(default)* or `json` for machine-readable logs |
| `GSM_LOG_LEVEL` | optional | `debug`, `info` *(default)*, `warn` or `error` |
| `GSM_ET_EXTRA_SERVERS` | optional | ET servers **outside** the panel for `!etallofoz`, one `host:port[:queryPort]` per line; `#` comments allowed |
| `GSM_ET_MASTER_URLS` | optional | Optional ET master server(s) for automatic discovery of non-panel servers, `host[:port]` *(default port `27950`)*; preconfigured with the classic community masters (id Software / etmaster.net / ETLegacy); discovered servers are capped at 25 and never duplicated against panel servers |
| `METRICS_RETENTION_DAYS` | optional | Days of node/server metric samples to keep *(default `30`, `0` disables pruning)* |
| `AUDIT_RETENTION_DAYS` | optional | Days of audit history to keep *(default `365`, `0` disables pruning)* |

The `DISCORD_*` variables, the two retention windows and the two `GSM_ET_*` extras are all configurable from **Settings** in the dashboard, and the database value takes precedence over the environment — so you can change them without editing `.env` or restarting.

Start from `.env.example`, which documents all of the above.

> [!IMPORTANT]
> **`JWT_SECRET` is mandatory in production.** The panel exits at startup if it is missing or under 32 characters. Generate one with `openssl rand -hex 32`.
>
> In development a random per-process secret is used instead, so sessions drop on every restart.

<!-- -->

> [!NOTE]
> **Upgrading from an older release?** `JWT_SECRET` used to be optional and auto-generated at runtime.
> - **Installer deployments are unaffected** — `install.sh` already writes a 62-character secret to `.env`, and `update.sh` backfills one automatically if it is missing.
> - **Manual installs** that never set the variable must add one before upgrading.

<details>
<summary><b>🐳 LXC / container networking</b></summary>

<br>

The installer detects LXC and Docker containers and repairs a networking fault common to **ASUSTOR Linux Center**, **Proxmox**, and similar NAS platforms.

**The problem.** These platforms inject internal gateways (e.g. `10.172.5.1`) into the container's routing table at boot, and the real LAN interface is not necessarily `eth0`. On ASUSTOR:

```
eth0  →  10.0.3.x       LXC internal bridge  — not your LAN
eth1  →  192.168.50.x   the real LAN, bridged to the physical NIC
         10.172.5.1     injected by ASUSTOR as a default route
```

This breaks outbound internet access *and* inbound port forwarding to your game servers.

**The fix.** The installer:

1. **Detects the container** via `/proc/1/environ`, `/.dockerenv`, and cgroup markers
2. **Scores every interface** to find the genuine LAN *(table below)*
3. **Promotes the winner** — `ip route replace default via <GATEWAY> dev <LAN_DEV> metric 10`
4. **Strips competing defaults** from every other interface
5. **Installs a systemd unit** so the fix survives reboots

| Subnet | Score | Meaning |
|:--|:--:|:--|
| `192.168.x.x` | **100** | home / office LAN |
| `172.16–31.x.x` | **80** | corporate LAN |
| `10.x.x.x` | **30** | possibly LAN |
| `10.0.3.x` | **5** | LXC bridge — almost never |
| `10.172.x.x` | **2** | ASUSTOR internal — never |

It creates `/usr/local/bin/fix-container-routing.sh` (runs at boot after a 10-second delay, so it overrides the platform's injected routes) and `/etc/systemd/system/fix-container-routing.service`.

**Doing it by hand**

```bash
ip -4 -o addr show          # inspect interfaces
ip route show default       # inspect routes

sudo ip route del default via 10.172.5.1 dev eth1
sudo ip route replace default via 192.168.50.1 dev eth1 metric 10
```

</details>

<details>
<summary><b>🔥 Firewall management</b></summary>

<br>

**At install time**, the installer detects your SSH port — including non-standard ones — and allows it *before* enabling UFW, then opens TCP+UDP for every game in the template library.

| Port | Proto | Service |
|:--|:--|:--|
| *auto-detected* | TCP | SSH *(reads `sshd_config` + the active session)* |
| `80` / `443` | TCP | HTTP / HTTPS (Caddy) |
| `3000` | TCP | Panel *(when Caddy is not used)* |
| `25565` | TCP/UDP | Minecraft Java |
| `19132` | UDP | Minecraft Bedrock |
| `27015–27030` | TCP/UDP | Source engine — CS2, TF2, GMod, L4D2 |
| `28015` / `28016` | TCP/UDP · TCP | Rust · Rust RCON |
| `7777–7778` | TCP/UDP | ARK · Satisfactory · Terraria |
| `15000` | UDP | Satisfactory beacon |
| `2456–2458` | TCP/UDP | Valheim |
| `26900–26902` | TCP/UDP | 7 Days to Die |
| `8211` | TCP/UDP | Palworld |
| `15636–15637` | TCP/UDP | Enshrouded |
| `27102` / `27131` | TCP/UDP · UDP | Insurgency: Sandstorm · query |
| `7787` | TCP/UDP | Squad |
| `2302–2306` | UDP | Arma 3 |
| `27960` | TCP/UDP | ET:Legacy · Quake Live |
| `1234` | TCP/UDP | OpenRA |
| `26000` | TCP/UDP | Xonotic |
| `9876–9877` | TCP/UDP | V Rising |
| `16261–16262` | TCP/UDP | Project Zomboid |
| `34197` | UDP | Factorio |
| `10999–11000` | UDP | Don't Starve Together |
| `9600` | TCP/UDP | Assetto Corsa |

> [!WARNING]
> **UFW is never enabled inside LXC/Docker containers.** It conflicts with the host's iptables/nftables and will drop your SSH session. The installer detects containers, skips UFW entirely, and prints the ports to forward on your router instead.
>
> On bare metal and VMs, UFW is configured and enabled, with port 22 always allowed as a safety net.

**At runtime**, rules follow your servers automatically:

- **Create** → `ufw allow` on the game, query, and RCON ports *(TCP + UDP)*
- **Change port** → old rules removed, new rules added
- **Delete** → rules cleaned up

Every rule is tagged `GSM:<serverId> <serverName>`, so `ufw status` shows which server owns which port.

```http
GET  /api/firewall     # UFW status + panel-managed rules
POST /api/firewall     # { "action": "allow", "port": 27015, "comment": "My server" }
```

</details>

<details>
<summary><b>🌐 Serving the panel on port 80 (default web root)</b></summary>

<br>

If the server already had **Apache** or **nginx** installed, port 80 keeps
serving the stock *"It works!"* / *"Welcome to nginx!"* page from
`/var/www/html`, so browsing to the box lands on a placeholder instead of the
panel.

The installer offers to fix this automatically. To do it later:

```bash
sudo gsm webroot
# or
sudo bash /opt/gsm-panel/public/setup-webroot.sh
```

It reverse-proxies port 80 to the panel rather than issuing an HTTP redirect —
a redirect to `:3000` only works if that port is reachable from the visitor,
whereas a proxy keeps everything on port 80 and works through routers and
networks that only allow 80/443. WebSocket upgrades (live logs, RCON, metrics)
and 256 MB uploads are configured too.

| Flag | Description |
|:--|:--|
| `--port` | Panel port *(default: read from `.env`, else `3000`)* |
| `--redirect-only` | Leave the web server config alone; just drop a redirect page into the web root |
| `--webroot` | Document root to write into *(default `/var/www/html`)* |
| `--install-dir` | Panel directory *(default `/opt/gsm-panel`)* |
| `--revert` | Undo — restore the most recent backup |
| `-y`, `--yes` | Skip the confirmation prompt |

Everything it touches is backed up to `/var/backups/gsm-webroot/<timestamp>`
first, and if the web server's own config test fails it rolls back rather than
leaving you with a broken server. If Caddy is already proxying to the panel the
script detects that and does nothing.

</details>

<details>
<summary><b>🌐 Caddy reverse proxy</b></summary>

<br>

Pass `--caddy` and the installer configures [Caddy](https://caddyserver.com/) in front of the panel:

- **Automatic HTTPS** — Let's Encrypt certificates, obtained and renewed for you
- **HTTP/2 and HTTP/3** out of the box
- **Zero-config SSL** — just point a DNS A record at the server
- **WebSocket support** for live logs, RCON, and monitoring

```bash
systemctl status caddy
systemctl restart caddy
caddy validate --config /etc/caddy/Caddyfile
journalctl -u caddy
```

Config lives at `/etc/caddy/Caddyfile`.

</details>

---

## 🎛️ Panel Settings

Two places to configure things, split by who they are for:

| Where | What |
|:--|:--|
| **Settings** *(Administration)* | Data retention, default server quota, self-registration, age verification (minimum age, Australian 16+ default), pre-update auto-backup, login attempt limit, session length, **🔑 Master Key** (generate/rotate/revoke the one operator key), **idle auto-stop policy**, **alert mute windows**, **weekly fleet digest schedule**, **outbound webhook with delivery log**, IP allowlist, and everything Discord — webhook, bot, and channel backfill |
| **Site Editor** *(✏️ on the public site)* | Panel name, hero text, footer, announcements, navigation links, chat widget, and **custom CSS** |

Everything in **Settings** overrides the matching environment variable, so you
can change it without editing `.env` or restarting the panel.

<details>
<summary><b>🔔 Giving existing servers a Discord channel</b></summary>

<br>

New servers get a channel automatically once the bot is configured. Servers
that already existed do not — and a channel someone deletes by hand in Discord
leaves the panel posting into a webhook that silently returns 404, because
webhook delivery never throws.

**Settings → Discord Channels** fixes both:

| Button | Does |
|:--|:--|
| **Preview changes** | Reports exactly what would happen. Changes nothing. |
| **Create missing channels** | Creates a channel for every server without one, and re-creates any that were deleted in Discord. |

Three things it deliberately will not do:

- **It never replaces a webhook you entered by hand.** The panel does not own
  that channel, so overwriting it would silently redirect your notifications.
- **It never creates a duplicate.** If the check against Discord fails for any
  reason other than a definite "channel not found" — a bad token, a rate
  limit, a network blip — that server is skipped rather than given a second
  channel.
- **It never runs on its own.** It is a button, not a background job.

Requires a bot token and server ID, configured just above it in the same
Settings page; a webhook alone cannot create channels.

</details>

---

## 🛠️ Operations

### Day-to-day

```bash
pm2 status              # panel status
pm2 logs gsm-panel      # live logs
pm2 restart gsm-panel   # restart
pm2 stop gsm-panel      # stop
```

### Updating

```bash
# One-liner, from anywhere
bash <(curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/public/update.sh)

# Or, if the panel is installed
gsm update
sudo bash /opt/gsm-panel/public/update.sh
```

The updater runs seven steps: **backup** *(`.env`, configs, database dump, current commit)* → **pull** → **`npm ci`** → **`drizzle-kit push`** → **build** → **prune dev deps** → **restart + health check**. It also backfills a `JWT_SECRET` into `.env` if your install predates that requirement.

> [!IMPORTANT]
> **One-off migration: duplicate ports.** Older releases allowed two servers on
> the same node to share a port — the second would fail to bind and show as
> *crashed* with no explanation. The database now enforces one server per port,
> per node.
>
> If your panel already has a clash, the upgrade repairs it rather than
> failing: the **oldest** server keeps the port, and the others move to the
> nearest free port above it. Each change is logged like this, so check the
> install log and update any port forwarding:
>
> ```
> [install] "Survival SMP" shared port 27015 with another server on the same
>           node; moved to 27017. Update any port forwarding.
> ```
>
> Servers on *different* nodes using the same port are untouched — that was
> never a conflict.

| Flag | Description |
|:--|:--|
| `--force` | Skip confirmation prompts |
| `--no-backup` | Skip the pre-update backup |
| `--branch NAME` | Track a different branch *(default `main`)* |
| `--rollback` | Restore the most recent backup |

### Rolling back

```bash
sudo bash /opt/gsm-panel/public/update.sh --rollback
```

Restores `.env`, configs, and the git commit from the last backup — each of which includes a full database dump. The five most recent backups are kept.

### Uninstalling

```bash
sudo bash /opt/gsm-panel/public/uninstall.sh                      # keep data
sudo bash /opt/gsm-panel/public/uninstall.sh --purge              # remove everything
sudo bash /opt/gsm-panel/public/uninstall.sh --purge --keep-servers
sudo bash /opt/gsm-panel/public/uninstall.sh --install-dir /srv/gsm
```

| Flag | Description |
|:--|:--|
| `--purge` | Also drop the database and remove the `gsm` user, Caddy, and SteamCMD |
| `--keep-servers` | Preserve `/opt/gameservers` when purging |
| `--install-dir` | Panel directory to remove *(default `/opt/gsm-panel`)* |
| `-y`, `--yes` | Skip the confirmation prompt |

<details>
<summary><b>🐞 Troubleshooting — installer logs</b></summary>

<br>

If the installer stops partway, the failing step wrote one of these:

| Log file | Step |
|:--|:--|
| `/tmp/gsm-apt-core.log` | System packages |
| `/tmp/gsm-nodesource.log` | Node.js repository setup |
| `/tmp/gsm-nodejs-install.log` | Node.js installation |
| `/tmp/gsm-pm2-install.log` | PM2 |
| `/tmp/gsm-postgresql-install.log` | PostgreSQL |
| `/tmp/gsm-steamlibs.log` | SteamCMD 32-bit libraries |
| `/tmp/gsm-npm-install.log` | npm dependencies |
| `/tmp/gsm-drizzle-push.log` | Database schema push |
| `/tmp/gsm-next-build.log` | Next.js production build |
| `/tmp/gsm-caddy-install.log` | Caddy |
| `/tmp/gsm-temp-server.log` | Temporary install-wizard server |

The updater writes `/tmp/gsm-update-*.log` and `/tmp/gsm-rollback-build.log` in the same way.

</details>

---

## 🧑‍💻 Development

```bash
npm ci
cp .env.example .env    # set DATABASE_URL + JWT_SECRET
npx drizzle-kit push
npm run dev
```

### Quality gates

```bash
npm run verify
```

One command chains every check, exiting non-zero on the first failure — drop it straight into CI:

| Script | Checks |
|:--|:--|
| `npm test` | 1,188 tests over the config renderer, path guard, auth, age verification, panel settings, pagination, API key scopes, server lifecycle rules, cron engine, idle math, fleet digests, capacity planning, leaderboards, restore guards and the install/master-key logic, plus **database integrity, end-to-end installer round-trips, and multi-write atomicity against a real PostgreSQL** *(see below)* |
| `npm run typecheck` | `tsc --noEmit` across the project |
| `npm run lint` | ESLint, including React hooks rules |
| `npm run verify:templates` | All 1,753 template options — types, enums, defaults, and that every declared variable is actually consumed |
| `npm run verify:installers` | Renders every game's install script, runs `bash -n` + shellcheck, then **executes** it in a sandbox with SteamCMD/curl/apt mocked, and asserts the artifacts the panel needs were produced |
| `npm run verify:security` | 384 regression checks pinning the security audit fixes and every feature stage since: path containment, backup-name allowlisting, SQL identifier quoting, JWT policy, security headers, the 16+ age gate, the pre-update backup safety net, backup retention & disk guard, the crash-loop breaker, the resource-limit watchdog, password-reset token handling, host threshold alerts, Source modding wiring, Discord OAuth sign-in rules, metrics-history access control, the anonymous status-link whitelist, scheduler webhook wiring, **the gate-free login model + install-key and master-key rails, installer-script key wiring, staged-rollout halt rails, restore verification gates, collaborator permission matrix, blueprint caps, maintenance-window release rules, idle-update busy guards, console read windows, leaderboard visibility, and the webhook delivery log** — plus a sweep for leaked exception messages |

All of these run automatically in CI on every push and pull request, along
with a production build and a high-severity dependency audit.

**Mutation testing.** Every feature stage also ships with a mutation round:
deliberate sabotage (halt rails removed, gates deleted, caps lifted, garbage
accepted) is applied one at a time and must be caught by the test suite or the
security pins before the stage may land — 75+ meaningful mutants caught so far,
3 per stage.

**Database tests need no database.** `tests/db-integrity.test.ts` runs the
installer's own `CREATE TABLE` statements — extracted from the route source, so
they cannot drift from what ships — inside [PGlite](https://pglite.dev), a real
PostgreSQL compiled to WebAssembly. That catches things no mock can: a foreign
key that blocks a delete, a table the schema declares but the installer never
creates, or a quota that two simultaneous requests can both slip past. It is a
dev dependency and never reaches production.

One extra check is **not** part of `npm run verify`, because it needs the
public internet and upstream outages are not repo regressions:

```bash
npm run check:upstreams
```

It hits every real download endpoint and API the installers depend on and
confirms the parsing expressions still match what upstream returns today.

Route modules connect to the database at import time, so a production build needs both variables present:

```bash
DATABASE_URL="postgres://user:pass@127.0.0.1:5432/gsm" \
JWT_SECRET="$(openssl rand -hex 32)" \
npx next build
```

### Project layout

```
src/
├── app/api/              67 API routes
├── components/           panels, forms, and the public site
├── db/
│   ├── games/            34 game templates — one module each
│   ├── schema.ts         Drizzle schema
│   └── seeds.ts          re-export shim
├── lib/                  auth, permissions, config rendering, file ops
└── instrumentation.ts    boot hook — starts servers marked "start on boot"
tests/                    unit tests + PostgreSQL integrity tests
scripts/                  verify-templates · verify-installers · verify-security
public/                   install.sh · update.sh · uninstall.sh · setup-webroot.sh
```

Adding a game? Drop a module into `src/db/games/`, export it from `index.ts`, and run `npm run verify:templates` — it will tell you about unused or undeclared variables. See `src/db/games/README.md`.

**Stack** — Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL + Drizzle ORM · Tailwind CSS 4 · PM2 · JWT auth with bcrypt and TOTP

---

## 📄 License

MIT

<div align="center">
<br>
<sub>Built with ❤️ for the game server hosting community</sub>
</div>
