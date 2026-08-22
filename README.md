<div align="center">

# 🎮 GameServer Manager

**A self-hosted game server control panel — the open-source alternative to TCAdmin.**

Deploy, configure, and monitor game servers across multiple machines from one dashboard.

<br>

![Next.js](https://img.shields.io/badge/Next.js-16.2-000000?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

<br>

<samp>**27** games · **1,551** config options · **65** API routes · **33** security checks</samp>

<br>

[Quick Start](#-quick-start) · [Features](#-features) · [Games](#-supported-games) · [Configuration](#-configuration) · [Operations](#-operations) · [Development](#-development)

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
| `--caddy` | Set up Caddy with automatic HTTPS | off |
| `--no-steamcmd` | Skip SteamCMD entirely | off |
| `-y`, `--noninteractive` | Skip all prompts | off |

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
- **Real-time metrics** — CPU, RAM, disk, network
- **Auto firewall** — ports follow your servers
- **LXC/container** networking auto-repair
- **IPv6** throughout
- **Install wizard** for first-run setup

</td>
<td width="33%" valign="top">

#### 🎮 Server Control
- **27 game templates**, 1,551 options
- **RCON console** in the browser
- **File manager** — browse, edit, upload
- **Scheduler** — cron restarts & backups
- **Backups** with one-click restore
- **Live logs** streamed to the panel

</td>
<td width="33%" valign="top">

#### 👥 Community & Admin
- **Forum** with categories and threads
- **Sandbox chat** — live shoutbox
- **CMS** — posts, changelogs, pages
- **League ladder** — rankings
- **Database manager** — SQL browser
- **Audit log** of every action

</td>
</tr>
</table>

**Security & access** — TOTP two-factor auth · granular role-based permissions · API keys for external integrations · login throttling · full audit trail

**Notifications** — Discord webhooks on start/stop/crash · SMTP email via Nodemailer

**Appearance** — 4 built-in themes plus a custom theme editor · 3 layout densities *(compact, cozy, spacious)*

---

## 🎯 Supported Games

**27 templates, 1,551 configurable options.** Every option is typed, validated, and genuinely wired into the install script, generated config files, or start command — nothing is decorative.

<table>
<tr><th align="left">Category</th><th align="left">Games</th></tr>
<tr>
  <td><b>⛏️ Minecraft</b></td>
  <td>Java Edition <sup><code>55</code></sup> · Paper <sup><code>52</code></sup> · Bedrock <sup><code>27</code></sup></td>
</tr>
<tr>
  <td><b>🔫 FPS</b></td>
  <td>Counter-Strike 2 <sup><code>65</code></sup> · Team Fortress 2 <sup><code>58</code></sup> · Left 4 Dead 2 <sup><code>49</code></sup> · Insurgency: Sandstorm <sup><code>42</code></sup> · Squad <sup><code>45</code></sup> · Arma 3 <sup><code>50</code></sup></td>
</tr>
<tr>
  <td><b>🏝️ Survival</b></td>
  <td>Project Zomboid <sup><code>95</code></sup> · Palworld <sup><code>92</code></sup> · 7 Days to Die <sup><code>81</code></sup> · ARK <sup><code>80</code></sup> · Rust <sup><code>56</code></sup> · Enshrouded <sup><code>54</code></sup> · Don't Starve Together <sup><code>36</code></sup> · Valheim <sup><code>28</code></sup></td>
</tr>
<tr>
  <td><b>🧱 Sandbox</b></td>
  <td>Terraria (TShock) <sup><code>63</code></sup> · Garry's Mod <sup><code>51</code></sup> · Factorio <sup><code>33</code></sup> · Satisfactory <sup><code>21</code></sup></td>
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
| `DISCORD_WEBHOOK_URL` | optional | Panel-wide fallback webhook, used for any server without its own. Notifies on start, stop, restart, **crash**, update and delete |
| `DISCORD_BOT_TOKEN` | optional | Bot token, required only for automatic per-server channels *(webhooks cannot create channels)* |
| `DISCORD_GUILD_ID` | optional | Discord server ID the bot creates channels in |

All three are also configurable from **Site Editor → Discord**, which takes precedence over the environment.
| `METRICS_RETENTION_DAYS` | optional | Days of node/server metric samples to keep *(default `30`, `0` disables pruning)* |
| `AUDIT_RETENTION_DAYS` | optional | Days of audit history to keep *(default `365`, `0` disables pruning)* |

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

One command chains all four checks, exiting non-zero on the first failure — drop it straight into CI:

| Script | Checks |
|:--|:--|
| `npm test` | 133 unit tests over the config renderer, path guard, auth, pagination and API keys |
| `npm run typecheck` | `tsc --noEmit` across the project |
| `npm run lint` | ESLint, including React hooks rules |
| `npm run verify:templates` | All 1,551 template options — types, enums, defaults, and that every declared variable is actually consumed |
| `npm run verify:installers` | Renders every game's install script, runs `bash -n` + shellcheck, then **executes** it in a sandbox with SteamCMD/curl/apt mocked, and asserts the artifacts the panel needs were produced |
| `npm run verify:security` | 63 regression checks pinning the security audit fixes: path containment, backup-name allowlisting, SQL identifier quoting, JWT policy, security headers, and a sweep for leaked exception messages |

All of these run automatically in CI on every push and pull request, along
with a production build and a high-severity dependency audit.

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
├── app/api/          65 API routes
├── components/       panels, forms, and the public site
├── db/
│   ├── games/        27 game templates — one module each
│   ├── schema.ts     Drizzle schema
│   └── seeds.ts      re-export shim
└── lib/              auth, permissions, config rendering, file ops
scripts/              verify-templates.ts · verify-security.ts
public/               install.sh · update.sh · uninstall.sh
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
