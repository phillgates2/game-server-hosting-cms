# GameServer Manager

Production-ready game server control panel with Next.js, PostgreSQL, and a practical installer for fresh Linux hosts.

Built for teams who want one place to manage game servers, nodes, templates, users, permissions, monitoring, and CMS content.

---

## Why This Project

GameServer Manager focuses on three priorities:

- Fast server operations: install, start, stop, restart, monitor, and automate
- Clear ownership and security: role-based access, API keys, 2FA, audit trails
- Simple deployment: one-line installer with PM2 + Caddy + PostgreSQL setup

---

## Feature Highlights

| Area | What You Get |
| --- | --- |
| Server lifecycle | Create, install, start/stop/restart, clone, backup workflows |
| Game templates | Built-in templates, custom templates, external import support |
| Node operations | Local and remote node management patterns |
| File tooling | Browser file management and editing for server assets |
| Console access | RCON workflows for supported games |
| Monitoring | CPU/RAM/Disk/Network visibility in dashboard panels |
| Automation | Scheduler, Discord notifications, and API key access |
| Access control | Roles, granular permissions, JWT auth, optional TOTP 2FA |
| Competitive tools | League Ladder panel with season standings and RBAC-protected management |
| Platform extras | Built-in CMS and forum modules |

---

## Security and Permissions

The panel includes an advanced role-based access model with granular permissions across operational and admin surfaces.

- Role-aware dashboard navigation: modules are hidden when permission is missing
- System roles auto-upgrade during installer role seeding
- Fine-grained categories for servers, nodes, games, users, roles, forum, ladder, monitor, database, scheduler, API keys, security, and panel configuration
- Route-level permission checks on critical APIs (scheduler, templates import/create, API keys, roles, ladder, and more)

---

## Quick Start

### One-line installer (interactive)

Run on a fresh Ubuntu or Debian server with sudo access (or as root):

```bash
curl --fail --location --silent --show-error --retry 3 --retry-delay 2 --retry-all-errors \
  https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/install.sh | bash
```

The installer will:

- install system packages
- install Node.js 22, PostgreSQL, SteamCMD, PM2, and Caddy
- create and configure the panel database
- build and start the panel
- configure reverse proxy and firewall rules
- apply port forwarding mappings from `PF_RULES`

### One-line installer (non-interactive / automation)

Set required values up front so the installer never waits for prompts:

```bash
curl --fail --location --silent --show-error --retry 3 --retry-delay 2 --retry-all-errors \
  https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/install.sh | \
  INSTALLER_NON_INTERACTIVE=1 \
  PF_RULES='80:3000,25565:25565:127.0.0.1' \
  DB_PASSWORD='ChangeThisNow' \
  APP_PORT=3000 \
  ADMIN_USERNAME='admin' \
  ADMIN_EMAIL='admin@localhost' \
  ADMIN_PASSWORD='ChangeThisNowToo' \
  PANEL_NAME='GameServer Manager' \
  bash
```

Dry run mode (safe validation, no system changes):

```bash
INSTALLER_DRY_RUN=1 APP_PORT=3000 PF_RULES='80:3000' bash install.sh
```

---

## Installer Inputs

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PF_RULES` | Yes (non-interactive) | none | Port forwarding list: `external:internal` or `external:internal:target_ip` |
| `DB_PASSWORD` | No | auto fallback value | PostgreSQL password used for `gsmadmin` |
| `APP_PORT` | No | `3000` | Internal panel port |
| `ADMIN_USERNAME` | No | `admin` | Bootstrap admin username |
| `ADMIN_EMAIL` | No | `admin@localhost` | Bootstrap admin email |
| `ADMIN_PASSWORD` | No | prompt or fallback | Bootstrap admin password |
| `PANEL_NAME` | No | `GameServer Manager` | Display name used during install bootstrap |
| `INSTALLER_NON_INTERACTIVE` | No | `0` | Set to `1` to disable interactive prompts |
| `INSTALLER_DRY_RUN` | No | `0` | Set to `1` to print plan and exit |

Notes:

- `PF_RULES` is validated before heavy install work starts.
- Password values with special characters are handled during database role updates.
- `APP_PORT` is validated and guarded against commonly reserved ports.

---

## Manual Installation

### 1. Install base dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential unzip wget gnupg ca-certificates openssl python3
```

### 2. Install Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Install PostgreSQL and create database

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

export DB_PASS='CHANGE_THIS_PASSWORD'
sudo -u postgres psql -c "CREATE USER gsmadmin WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "CREATE DATABASE gameserver_db OWNER gsmadmin;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gameserver_db TO gsmadmin;"
```

### 4. Clone and install app

```bash
cd /opt
git clone https://github.com/phillgates2/game-server-hosting-cms.git gsm-panel
cd gsm-panel
npm install
```

### 5. Create `.env`

```bash
JWT_SECRET=$(openssl rand -hex 32)

cat > .env <<EOF_ENV
DATABASE_URL=postgresql://gsmadmin:${DB_PASS}@127.0.0.1:5432/gameserver_db
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
PORT=3000
EOF_ENV
```

### 6. Build and run

```bash
npm run build
sudo npm install -g pm2
pm2 start npm --name "gsm-panel" -- start
pm2 save
pm2 startup
```

### 7. Put Caddy in front

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Example Caddyfile:

```caddyfile
http://YOUR_SERVER_IP {
  encode gzip zstd
  reverse_proxy 127.0.0.1:3000
}
```

---

## Runtime Commands

```bash
pm2 status
pm2 logs gsm-panel
sudo systemctl status caddy
sudo journalctl -u caddy -f
sudo iptables -t nat -L -n -v
sudo iptables -L FORWARD -n -v
npm run typecheck
npm run lint
npm test
npm run build
```

---

## Quality Checks

Recommended validation sequence before release:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run build`

Current note:

- Next.js 16 Turbopack may emit a non-blocking NFT tracing warning for the process-control route during `next build` even when compilation succeeds.
- Node module-type test warnings are avoided by running tests via the dev-only `tsx` runner, keeping package runtime module mode unchanged.

---

## Troubleshooting

| Issue | Check |
| --- | --- |
| Installer appears stuck | Ensure prompts are visible in your terminal; use non-interactive mode for CI/cloud-init |
| App unavailable | Verify PM2 process and health endpoint `http://127.0.0.1:<PORT>/api/health` |
| Database failures | Confirm PostgreSQL is running and `DATABASE_URL` credentials are valid |
| Reverse proxy issues | Validate Caddy config and check `journalctl -u caddy` |
| Port forwarding not working | Inspect NAT/FORWARD rules and firewall allowances for forwarded ports |

---

## Environment Variables (App)

| Key | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `NODE_ENV` | Runtime mode (`production`/`development`) |
| `PORT` | Internal panel listen port |
| `PF_RULES` | Optional persisted forwarding rules |
| `SMTP_HOST` | SMTP host |
| `SMTP_PORT` | SMTP port |
| `SMTP_USER` | SMTP auth username |
| `SMTP_PASS` | SMTP auth password |
| `SMTP_FROM` | Default sender address |

---

## Project Structure

```text
game-server-hosting-cms/
├── src/
│   ├── app/                  # App routes and API endpoints
│   ├── components/           # Dashboard and panel UI
│   ├── db/                   # Drizzle schema and DB wiring
│   └── lib/                  # Auth, permissions, RCON, Discord, email helpers
├── tests/                    # Test suites
├── install.sh                # Fresh-host installer
├── CHANGELOG.md              # Release history
└── README.md                 # This file
```

---

## Tech Stack

- Next.js
- React
- TypeScript
- PostgreSQL
- Drizzle ORM
- Tailwind CSS

---

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make focused changes with tests where possible.
4. Open a pull request with clear context and rollout notes.

