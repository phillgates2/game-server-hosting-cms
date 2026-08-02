#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   curl -fsSL https://raw.githubusercontent.com/phillgates2/game-server-hosting-cms/main/install.sh | bash
#
# Prompts:
#   - DB password (required)
#   - Port forwarding rules (optional, format: external:internal[,external2:internal2,...])
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

echo "Installer running as: ${ORIG_USER}"
echo "Install directory: ${INSTALL_DIR}"

# Prompt for DB password if not set in environment
if [ -z "${DB_PASS:-}" ]; then
  read -rsp "Enter a password to use for the PostgreSQL gsmadmin user: " DB_PASS
  echo
  if [ -z "$DB_PASS" ]; then
    echo "Error: DB password cannot be empty." >&2
    exit 1
  fi
fi

# Prompt for port forwarding rules
read -rp "Enter port forwarding rules (external:internal[,external2:internal2,...]) [leave blank to skip]: " PF_RULES_RAW
PF_RULES_RAW="$(echo "$PF_RULES_RAW" | tr -d '[:space:]')"

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
cat > .env <<EOF
DATABASE_URL=postgresql://gsmadmin:${DB_PASS}@127.0.0.1:5432/gameserver_db
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
PORT=3000
EOF
sudo chown "${ORIG_USER}:${ORIG_USER}" .env
chmod 600 .env
echo ".env created (PORT=3000)."

# Step 7: Build
echo "Step 7: Building the project..."
sudo -u "${ORIG_USER}" npm run build

# Step 8: Create systemd service
echo "Step 8: Creating systemd service for gsm-panel..."
SERVICE_FILE="/etc/systemd/system/gsm-panel.service"
sudo bash -c "cat > ${SERVICE_FILE}" <<SERVICE
[Unit]
Description=GSM Panel Node Service
After=network.target

[Service]
Type=simple
User=${ORIG_USER}
Group=${ORIG_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/npm run start --prefix ${INSTALL_DIR}
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable gsm-panel.service
sudo systemctl start gsm-panel.service
echo "gsm-panel.service created and started."

# Step 9: Port forwarding (optional)
if [ -n "$PF_RULES_RAW" ]; then
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
      echo "Skipping invalid rule: $r" >&2
      continue
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
else
  echo "No port forwarding rules provided; skipping."
fi

# Step 10: Install Caddy and write Caddyfile bound to server IP (HTTP)
echo "Step 10: Installing Caddy and writing Caddyfile bound to ${SERVER_IP} (HTTP only)..."
sudo apt install -y debian-keyring debian-archive-keyring
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
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
  reverse_proxy 127.0.0.1:3000
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
echo "  Check panel service: sudo systemctl status gsm-panel.service"
echo "  View panel logs: sudo journalctl -u gsm-panel.service -f"
echo "  Check Caddy: sudo systemctl status caddy"
echo "  View Caddy logs: sudo journalctl -u caddy -f"
echo "  Check iptables NAT: sudo iptables -t nat -L -n -v"
echo "  Check FORWARD rules: sudo iptables -L FORWARD -n -v"
echo "  If you need to allow additional ports: sudo ufw allow <port>/tcp"
echo
echo "If you want TLS later, point a domain to this server and update /etc/caddy/Caddyfile to use the domain (remove 'http://' and add tls you@example.com)."
echo "Done."
