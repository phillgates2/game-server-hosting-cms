#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# Usage:
#   curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/install.sh | bash
#
# Notes:
#   - The installer uses a configurable PostgreSQL password and a configurable app port for a simple fresh-server setup.
#   - Port forwarding rules are required, format: external:internal[,external2:internal2,...]
#     Example: 80:3000,25565:25565
#
# Notes:
#   - Run as root (sudo). The script preserves the original user and runs build/start as that user.
#   - This script ALWAYS installs SteamCMD.
#   - UFW will be configured to allow OpenSSH before enabling to avoid locking you out.

ORIG_USER="${SUDO_USER:-${USER}}"
ORIG_HOME="$(eval echo ~${ORIG_USER})"
REPO_URL="https://github.com/phillgates2/game-server-hosting-cms.git"
INSTALL_DIR="/opt/gsm-panel"
DEFAULT_DB_PASS="GsmPanelDbPass2026!"
DB_PASS_INPUT="${DB_PASSWORD:-}"
DRY_RUN="${INSTALLER_DRY_RUN:-${DRY_RUN:-0}}"

validate_app_port() {
  local port="$1"
  if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "Invalid port '$port'. Please choose a number between 1 and 65535." >&2
    return 1
  fi

  local reserved_ports=(22 80 443 5432 3306 27017 25565)
  local reserved_port
  for reserved_port in "${reserved_ports[@]}"; do
    if [ "$port" = "$reserved_port" ]; then
      echo "Port $port is reserved for common system services and should not be used for the panel." >&2
      return 1
    fi
  done

  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}(\$|\s)"; then
      echo "Port $port is already in use on this server. Choose a different one." >&2
      return 1
    fi
  fi

  return 0
}

APP_PORT_INPUT="${APP_PORT:-}"
if [ -z "$APP_PORT_INPUT" ]; then
  APP_PORT_INPUT="3000"
fi

if [ -z "$DB_PASS_INPUT" ]; then
  if [ -t 0 ]; then
    read -rp "Enter the PostgreSQL password [$DEFAULT_DB_PASS]: " DB_PASS_INPUT
  fi
fi
if [ -z "$DB_PASS_INPUT" ]; then
  DB_PASS_INPUT="$DEFAULT_DB_PASS"
fi
DB_PASS="$DB_PASS_INPUT"

echo "Panel internal port selection"
echo "Avoid common reserved ports: 22 (SSH), 80/443 (web), 5432 (PostgreSQL), 3306, 27017, 25565."
while ! validate_app_port "$APP_PORT_INPUT"; do
  if [ -t 0 ]; then
    read -rp "Choose the internal panel port [3000]: " APP_PORT_INPUT
    if [ -z "$APP_PORT_INPUT" ]; then
      APP_PORT_INPUT="3000"
    fi
  else
    echo "No valid port was supplied. Falling back to 3000." >&2
    APP_PORT_INPUT="3000"
    break
  fi
done
APP_PORT="$APP_PORT_INPUT"

if [ "${DRY_RUN}" = "1" ]; then
  echo "Dry run enabled; skipping package installs and system changes."
  echo "Installer running as: ${ORIG_USER}"
  echo "Install directory: ${INSTALL_DIR}"
  echo "Using panel port: ${APP_PORT}"
  echo "Using database password supplied for PostgreSQL and the panel."
  echo "Would install Node.js, PostgreSQL, SteamCMD, PM2, Caddy, and configure the panel."
  exit 0
fi

 echo "Installer running as: ${ORIG_USER}"
echo "Install directory: ${INSTALL_DIR}"
echo "Using panel port: ${APP_PORT}"
echo "Using database password supplied for PostgreSQL and the panel."

PF_RULES_RAW="${PF_RULES:-}"
if [ -z "${PF_RULES_RAW:-}" ]; then
  if [ -t 0 ]; then
    read -rp "Enter port forwarding rules (external:internal[,external2:internal2,...]): " PF_RULES_RAW
  else
    echo "Port forwarding rules are required. Set PF_RULES or run interactively." >&2
    exit 1
  fi
fi
PF_RULES_RAW="$(echo "$PF_RULES_RAW" | tr -d '[:space:]')"

if [ -z "$PF_RULES_RAW" ]; then
  echo "Port forwarding rules are required. Provide at least one external:internal mapping." >&2
  exit 1
fi

echo "Port forwarding rules to apply: ${PF_RULES_RAW}"

# Determine server IP (first non-loopback IPv4)
SERVER_IP=""
SERVER_IP="$(ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -n1 || true)"
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="$(curl -s --max-time 5 https://ifconfig.me || true)"
fi
if [ -z "$SERVER_IP" ]; then
  echo "Warning: Could not detect server IP automatically. Caddyfile will use placeholder 'your.server.ip'." >&2
  SERVER_IP="your.server.ip"
fi
echo "Detected server IP: ${SERVER_IP}"

# Step 1: Base packages
echo "Step 1: Updating system and installing base packages..."
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git build-essential unzip wget gnupg ca-certificates openssl apt-transport-https

# Step 2: Node.js 22 LTS
echo "Step 2: Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
echo "Node: $(node --version || true)  NPM: $(npm --version || true)"

# Step 3: PostgreSQL
echo "Step 3: Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Create DB user and database (idempotent)
echo "Creating PostgreSQL user and database..."
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'PSQL' || true
DO
\$do\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gsmadmin') THEN
      CREATE ROLE gsmadmin LOGIN;
   END IF;
END
\$do\$;
PSQL

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE gsmadmin WITH PASSWORD '${DB_PASS}';
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='gameserver_db'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE gameserver_db OWNER gsmadmin;"
fi
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gameserver_db TO gsmadmin;" || true

echo "Verifying PostgreSQL connection..."
if PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U gsmadmin -d gameserver_db -c 'select 1;' >/dev/null 2>&1; then
  echo "PostgreSQL verification succeeded."
else
  echo "Warning: PostgreSQL verification failed. Check postgres logs and credentials." >&2
fi

# Step 4: Install SteamCMD (always)
echo "Step 4: Installing SteamCMD..."
sudo dpkg --add-architecture i386 || true
sudo apt update
sudo apt install -y lib32gcc-s1 lib32stdc++6 ca-certificates

sudo mkdir -p /opt/steamcmd
sudo chown -R "${ORIG_USER}:${ORIG_USER}" /opt/steamcmd
cd /opt/steamcmd

# Download and extract as the non-root user
sudo -u "${ORIG_USER}" bash -c 'curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xzf -'
sudo chown -R "${ORIG_USER}:${ORIG_USER}" /opt/steamcmd
sudo chmod +x /opt/steamcmd/steamcmd.sh || true
sudo chmod +x /opt/steamcmd/linux32/steamcmd || true

# Create wrapper
sudo bash -c 'cat > /usr/local/bin/steamcmd << "WRAPPER"
#!/bin/bash
cd /opt/steamcmd && exec ./steamcmd.sh "$@"
WRAPPER'
sudo chmod +x /usr/local/bin/steamcmd

mkdir -p /opt/steamcmd/package
sudo chown -R "${ORIG_USER}:${ORIG_USER}" /opt/steamcmd/package

echo "Running initial SteamCMD update as ${ORIG_USER} (may take a few minutes)..."
sudo -u "${ORIG_USER}" bash -c 'cd /opt/steamcmd && ./steamcmd.sh +quit' || true
echo "SteamCMD installed."

# Step 5: Clone & install panel
echo "Step 5: Cloning repository and installing dependencies..."
sudo mkdir -p /opt
if [ -d "${INSTALL_DIR}" ]; then
  echo "Directory ${INSTALL_DIR} exists. Pulling latest..."
  sudo -u "${ORIG_USER}" git -C "${INSTALL_DIR}" pull || true
else
  sudo -u "${ORIG_USER}" git clone "${REPO_URL}" "${INSTALL_DIR}"
fi
sudo chown -R "${ORIG_USER}:${ORIG_USER}" "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

echo "Installing npm dependencies..."
sudo -u "${ORIG_USER}" npm install --unsafe-perm

# Step 6: Create .env
echo "Step 6: Creating .env file..."
JWT_SECRET="$(openssl rand -hex 32)"
PF_ENV_VALUE=""
if [ -n "${PF_RULES_RAW}" ]; then
  PF_ENV_VALUE="${PF_RULES_RAW}"
fi
python3 - <<'PY' "$DB_PASS" "$JWT_SECRET" "$APP_PORT" "$PF_ENV_VALUE"
import os
import sys
import urllib.parse
from pathlib import Path

db_pass = sys.argv[1]
jwt_secret = sys.argv[2]
app_port = sys.argv[3]
pf_rules = sys.argv[4]

encoded_password = urllib.parse.quote(db_pass, safe="")
database_url = f"postgresql://gsmadmin:{encoded_password}@127.0.0.1:5432/gameserver_db"
env_lines = [
    f"DATABASE_URL={database_url}",
    f"JWT_SECRET={jwt_secret}",
    "NODE_ENV=production",
    f"PORT={app_port}",
    f"PF_RULES={pf_rules}",
]
Path(".env").write_text("\n".join(env_lines) + "\n", encoding="utf-8")
PY
sudo chown "${ORIG_USER}:${ORIG_USER}" .env
chmod 600 .env
echo ".env created (PORT=${APP_PORT}, PF_RULES=${PF_ENV_VALUE:-<none>})."
echo "Panel will listen on port ${APP_PORT} and use Caddy/PM2 accordingly."
# Step 7: Build
echo "Step 7: Building the project..."
sudo -u "${ORIG_USER}" npm run build

# Step 8: Start the panel with PM2
echo "Step 8: Starting the panel with PM2..."
echo "+ sudo npm install -g pm2"
sudo npm install -g pm2
echo "+ sudo -u \"${ORIG_USER}\" bash -lc \"cd '${INSTALL_DIR}' && export PATH=\\$PATH:/usr/bin:/bin && (pm2 delete gsm-panel >/dev/null 2>&1 || true) && pm2 start npm --name 'gsm-panel' -- start\""
sudo -u "${ORIG_USER}" bash -lc "cd '${INSTALL_DIR}' && export PATH=\$PATH:/usr/bin:/bin && (pm2 delete gsm-panel >/dev/null 2>&1 || true) && pm2 start npm --name 'gsm-panel' -- start"
echo "+ sudo -u \"${ORIG_USER}\" bash -lc \"export PATH=\\$PATH:/usr/bin:/bin && pm2 save\""
sudo -u "${ORIG_USER}" bash -lc "export PATH=\$PATH:/usr/bin:/bin && pm2 save"
echo "+ sudo -u \"${ORIG_USER}\" bash -lc \"export PATH=\\$PATH:/usr/bin:/bin && pm2 startup systemd -u '${ORIG_USER}' --hp '${ORIG_HOME}' || true\""
sudo -u "${ORIG_USER}" bash -lc "export PATH=\$PATH:/usr/bin:/bin && pm2 startup systemd -u '${ORIG_USER}' --hp '${ORIG_HOME}' || true"
echo "PM2 process started and configured."

# Step 9: Port forwarding
echo "Step 9: Configuring port forwarding..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent netfilter-persistent

# Enable IPv4 forwarding
sudo sysctl -w net.ipv4.ip_forward=1
if ! grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null; then
  echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf >/dev/null
fi

IFS=',' read -ra RULES <<< "$PF_RULES_RAW"
for r in "${RULES[@]}"; do
  if [[ "$r" =~ ^([0-9]{1,5}):([0-9]{1,5})(:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+))?$ ]]; then
    EXT_PORT="${BASH_REMATCH[1]}"
    INT_PORT="${BASH_REMATCH[2]}"
    TARGET_IP="${BASH_REMATCH[4]:-127.0.0.1}"
  else
    echo "Invalid port forwarding rule: $r" >&2
    exit 1
  fi

  echo "Adding forwarding: ${EXT_PORT} -> ${TARGET_IP}:${INT_PORT} (tcp/udp)"
  sudo iptables -t nat -A PREROUTING -p tcp --dport "${EXT_PORT}" -j DNAT --to-destination "${TARGET_IP}:${INT_PORT}"
  sudo iptables -t nat -A POSTROUTING -p tcp -d "${TARGET_IP}" --dport "${INT_PORT}" -j MASQUERADE || true
  sudo iptables -t nat -A PREROUTING -p udp --dport "${EXT_PORT}" -j DNAT --to-destination "${TARGET_IP}:${INT_PORT}"
  sudo iptables -t nat -A POSTROUTING -p udp -d "${TARGET_IP}" --dport "${INT_PORT}" -j MASQUERADE || true

  sudo iptables -A FORWARD -p tcp -d "${TARGET_IP}" --dport "${INT_PORT}" -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT || true
  sudo iptables -A FORWARD -p udp -d "${TARGET_IP}" --dport "${INT_PORT}" -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT || true
done

echo "Saving iptables rules..."
sudo netfilter-persistent save || true
echo "Port forwarding rules applied."

# Step 10: Install Caddy and write Caddyfile bound to server IP (HTTP)
echo "Step 10: Installing Caddy and writing Caddyfile bound to ${SERVER_IP} (HTTP only)..."
echo "+ sudo apt install -y debian-keyring debian-archive-keyring"
sudo apt install -y debian-keyring debian-archive-keyring
echo "+ curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
echo "+ curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
echo "+ sudo apt update"
sudo apt update
echo "+ sudo apt install -y caddy"
sudo apt install -y caddy

sudo mkdir -p /var/log/caddy
sudo chown -R caddy:caddy /var/log/caddy
sudo chmod 750 /var/log/caddy

CADDYFILE_PATH="/etc/caddy/Caddyfile"
if [ -f "${CADDYFILE_PATH}" ]; then
  sudo cp "${CADDYFILE_PATH}" "${CADDYFILE_PATH}.bak.$(date +%s)"
fi

sudo bash -c "cat > ${CADDYFILE_PATH}" <<CADDY
http://${SERVER_IP} {
  encode gzip zstd
  reverse_proxy 127.0.0.1:${APP_PORT}
  log {
    output file /var/log/caddy/gsm-panel.access.log
    format single_field common_log
  }
}
CADDY

sudo chown root:root "${CADDYFILE_PATH}"
sudo chmod 644 "${CADDYFILE_PATH}"

echo "Validating and reloading Caddy..."
if sudo caddy validate --config "${CADDYFILE_PATH}" >/dev/null 2>&1; then
  sudo systemctl reload caddy || sudo systemctl restart caddy
  echo "Caddy reloaded."
else
  echo "Warning: Caddy configuration validation failed. Check ${CADDYFILE_PATH}." >&2
fi

# Step 11: UFW configuration (safe)
echo "Step 11: Configuring UFW (will allow SSH before enabling to avoid disconnecting you)..."
# Install UFW if missing
if ! command -v ufw >/dev/null 2>&1; then
  sudo apt install -y ufw
fi

# Allow SSH (OpenSSH) first
sudo ufw allow OpenSSH

# If port forwarding rules were provided, allow the external ports through UFW
if [ -n "$PF_RULES_RAW" ]; then
  IFS=',' read -ra RULES2 <<< "$PF_RULES_RAW"
  for r in "${RULES2[@]}"; do
    if [[ "$r" =~ ^([0-9]{1,5}):([0-9]{1,5})(:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+))?$ ]]; then
      EXT_PORT="${BASH_REMATCH[1]}"
      sudo ufw allow "${EXT_PORT}/tcp" || true
      sudo ufw allow "${EXT_PORT}/udp" || true
    fi
  done
fi

# Allow HTTP (port 80) so Caddy can serve the IP
sudo ufw allow 80/tcp

# Ensure forwarding policy accepts forwarded packets
sudo sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw || true
if ! grep -q '^net/ipv4/ip_forward=1' /etc/ufw/sysctl.conf 2>/dev/null; then
  echo 'net/ipv4/ip_forward=1' | sudo tee -a /etc/ufw/sysctl.conf >/dev/null
fi

# Enable UFW (force to avoid interactive prompt) — safe because OpenSSH is allowed
sudo ufw --force enable || true
sudo ufw reload || true
echo "UFW enabled and configured."

# Final notes
echo
echo "Installation finished."
echo "Access the panel at http://${SERVER_IP} (port 80)."
echo
echo "Useful commands:"
echo "  Check PM2 status: pm2 status"
echo "  View PM2 logs: pm2 logs gsm-panel"
echo "  Check Caddy: sudo systemctl status caddy"
echo "  View Caddy logs: sudo journalctl -u caddy -f"
echo "  Check iptables NAT: sudo iptables -t nat -L -n -v"
echo "  Check FORWARD rules: sudo iptables -L FORWARD -n -v"
echo "  If you need to allow additional ports: sudo ufw allow <port>/tcp"
echo
echo "If you want TLS later, point a domain to this server and update /etc/caddy/Caddyfile to use the domain (remove 'http://' and add tls you@example.com)."
echo "Done."
