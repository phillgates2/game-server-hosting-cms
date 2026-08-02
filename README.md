# GameServer Manager

Modern, open-source game server hosting panel built with Next.js, PostgreSQL, and Tailwind CSS.

A full-featured alternative to TCAdmin and Pterodactyl for managing game servers, nodes, templates, users, roles, and monitoring from one dashboard.

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Quick start](#quick-start)
- [Production deployment](#production-deployment)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)

## Overview

GameServer Manager provides:

- A web-based control panel for game servers and nodes
- Steam and non-Steam game template support
- File management, RCON, monitoring, and backup tools
- Role-based permissions and user management
- A built-in CMS, forum, activity log, and scheduler

## Features

### Server management
- Create and manage servers with guided setup
- Start, stop, restart, backup, clone, and update servers
- Monitor process health and stream console output
- Install game files from built-in templates
- Review server health cards and status summaries directly from the dashboard

### Operations and infrastructure
- Multi-node support for local and remote hosts
- Built-in monitoring for CPU, RAM, disk, and network
- Scheduled tasks and Discord webhook notifications
- File editor, RCON console, and database browser
- Dashboard-style overview with collapsible panels, per-server health summaries, and quick admin shortcuts

### Security and access
- JWT-based authentication and bcrypt password hashing
- Two-factor authentication with TOTP
- Granular role and permission management
- API key support for automation and integrations

## Quick start

### One-line installer

Run this on a fresh Ubuntu or Debian server as a regular user with sudo access:

```bash
curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/install.sh | bash
```

The installer will:

- install system dependencies
- configure PostgreSQL with a user-supplied password
- install SteamCMD
- build and start the panel with PM2
- set up Caddy as a reverse proxy
- apply optional port-forwarding rules for the panel and each game server port

> For a non-destructive validation run, use:
>
> ```bash
> INSTALLER_DRY_RUN=1 bash install.sh
> ```

### Manual install

If you prefer to install everything yourself, follow the steps below.

#### 1. Install system dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential unzip wget gnupg ca-certificates
```

#### 2. Install Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

#### 3. Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

Create the database and user:

```bash
export DB_PASS='CHANGE_THIS_PASSWORD'

sudo -u postgres psql -c "CREATE USER gsmadmin WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "CREATE DATABASE gameserver_db OWNER gsmadmin;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gameserver_db TO gsmadmin;"
```

#### 4. Install SteamCMD (optional for Steam games)

```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6 ca-certificates

sudo mkdir -p /opt/steamcmd
cd /opt/steamcmd
sudo curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | sudo tar xzf -
sudo chown -R $USER:$USER /opt/steamcmd
chmod +x /opt/steamcmd/steamcmd.sh
chmod +x /opt/steamcmd/linux32/steamcmd

sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd

cd /opt/steamcmd
./steamcmd.sh +quit
```

#### 5. Clone and install the app

```bash
cd /opt
git clone https://github.com/phillgates2/game-server-hosting-cms.git gsm-panel
cd gsm-panel
npm install
```

#### 6. Create the environment file

```bash
JWT_SECRET=$(openssl rand -hex 32)

cat > .env <<EOF
DATABASE_URL=postgresql://gsmadmin:${DB_PASS}@127.0.0.1:5432/gameserver_db
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
PORT=3000
EOF
```

#### 7. Build the app

```bash
npm run build
```

## Production deployment

### Run with PM2

```bash
sudo npm install -g pm2
cd /opt/gsm-panel
pm2 start npm --name "gsm-panel" -- start
pm2 save
pm2 startup
```

> Run the sudo command printed by pm2 startup if prompted.

### Put Caddy in front of the app

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Create a Caddyfile:

```caddyfile
YOUR_SERVER_IP {
    reverse_proxy 127.0.0.1:3000
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy
```

## Configuration

### Default ports

- App runs on port 3000 internally by default
- Caddy serves traffic on port 80
- Optional port forwarding can be configured during installation
- When a local game server is installed, its main port (and query/rcon ports when present) is also forwarded automatically on the host

### Email notifications

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your_password
SMTP_FROM=noreply@example.com
```

### Discord webhooks

When creating or editing a server, expand the Discord notifications section and add a webhook URL.

## Troubleshooting

### Panel shows a blank page

- Clear browser cookies and refresh
- Ensure the app is reachable over HTTP/HTTPS correctly
- Verify that the PM2 process is running

### PostgreSQL connection issues

```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

### PM2 issues

```bash
sudo npm install -g pm2
pm2 status
pm2 logs gsm-panel
```

### SteamCMD issues

```bash
sudo rm -f /usr/local/bin/steamcmd
sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd
```

### Port 80 permission errors

If Node needs to bind directly to port 80, use:

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

Otherwise, keep the app on port 3000 and let Caddy handle port 80.

## Project structure

```text
gsm-panel/
├── src/
│   ├── app/
│   │   ├── api/          # API routes for auth, servers, nodes, games, forum, CMS, users, and more
│   │   └── page.tsx     # Main app shell
│   ├── components/      # Dashboard and panel UI components
│   ├── db/              # Database schema and connection setup
│   └── lib/             # Auth, permissions, RCON, Discord, email helpers
├── install.sh           # One-line installer
├── package.json         # Scripts and dependencies
└── README.md            # Project documentation
```

## Tech stack

| Technology | Purpose |
| --- | --- |
| Next.js | Full-stack React application framework |
| React | UI components and dashboard experience |
| TypeScript | Type-safe application logic |
| PostgreSQL | Primary relational database |
| Drizzle ORM | Database access layer |
| Tailwind CSS | Styling and responsive UI |
| bcryptjs | Password hashing |
| jsonwebtoken | JWT authentication |
| otpauth | TOTP 2FA flows |
| nodemailer | Email notifications |
| qrcode | QR code generation for 2FA |
