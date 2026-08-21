#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  GameServer Manager — Uninstaller
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Usage:  sudo bash uninstall.sh [OPTIONS]
#
#  Options:
#    --purge          Remove everything: database, system user, Caddy, SteamCMD
#    --keep-servers   Keep game server files when purging (default: removed)
#    --install-dir P  Panel directory to remove (default: /opt/gsm-panel)
#    -y, --yes        Skip the confirmation prompt
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[GSM]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

INSTALL_DIR="/opt/gsm-panel"
GSM_USER="gsm"
DB_NAME="gsm_panel"
DB_USER="gsm"
STEAMCMD_DIR="/opt/steamcmd"
GAMESERVERS_DIR="/opt/gameservers"
PURGE="false"
KEEP_SERVERS="false"
ASSUME_YES="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)        PURGE="true"; shift ;;
    --keep-servers) KEEP_SERVERS="true"; shift ;;
    -y|--yes)       ASSUME_YES="true"; shift ;;
    --install-dir)  INSTALL_DIR="${2:-}"; [[ -z "$INSTALL_DIR" ]] && die "--install-dir requires a path"; shift 2 ;;
    -h|--help)
      echo "Usage: sudo bash uninstall.sh [--purge] [--keep-servers] [--install-dir PATH] [-y]"
      exit 0 ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
done

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash uninstall.sh"

# Read install info if available
if [[ -f "$INSTALL_DIR/.install-info" ]]; then
  # Remember the CLI value: .install-info also defines INSTALL_DIR and would
  # otherwise override an explicit --install-dir.
  _CLI_INSTALL_DIR="$INSTALL_DIR"
  source "$INSTALL_DIR/.install-info" 2>/dev/null || true
  INSTALL_DIR="$_CLI_INSTALL_DIR"
fi

echo ""
echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║${NC}  ${BOLD}🗑️  GameServer Manager — Uninstaller${NC}                        ${RED}║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [[ "$PURGE" == "true" ]]; then
  warn "PURGE mode enabled!"
  warn "  - Database '$DB_NAME' will be dropped"
  warn "  - System user '$GSM_USER' will be removed"
  warn "  - Caddy configuration will be removed"
  warn "  - SteamCMD at '$STEAMCMD_DIR' will be removed"
  if [[ "$KEEP_SERVERS" != "true" ]]; then
    warn "  - Game servers at '$GAMESERVERS_DIR' will be DELETED"
  else
    log "  - Game servers at '$GAMESERVERS_DIR' will be KEPT"
  fi
  echo ""
fi

if [[ "$ASSUME_YES" != "true" ]]; then
  read -rp "Are you sure you want to uninstall? [y/N]: " confirm
  [[ "${confirm,,}" != "y" ]] && { log "Cancelled."; exit 0; }
fi

# Stop PM2 process
log "Stopping panel..."
su - "$GSM_USER" -c "pm2 delete gsm-panel" 2>/dev/null || true
su - "$GSM_USER" -c "pm2 save --force" 2>/dev/null || true
ok "Panel stopped"

# Remove Caddy config (keep Caddy installed unless --purge)
if [[ -f /etc/caddy/Caddyfile ]]; then
  if grep -q "gsm-panel\|GameServer Manager" /etc/caddy/Caddyfile 2>/dev/null; then
    log "Removing Caddy configuration..."
    echo "# Caddy — default config (GSM panel removed)" > /etc/caddy/Caddyfile
    systemctl reload caddy 2>/dev/null || true
    ok "Caddy configuration removed"
  fi
fi

# Remove log directories
if [[ -d /var/log/gsm-panel ]]; then
  rm -rf /var/log/gsm-panel
  ok "Panel logs removed"
fi

# Remove application directory
if [[ -d "$INSTALL_DIR" ]]; then
  log "Removing $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  ok "Application files removed"
fi

# Remove SteamCMD symlink
if [[ -L /usr/local/bin/steamcmd ]]; then
  rm -f /usr/local/bin/steamcmd
fi

if [[ "$PURGE" == "true" ]]; then
  # Drop database
  log "Dropping database '$DB_NAME'..."
  su - postgres -c "psql -c \"DROP DATABASE IF EXISTS $DB_NAME;\"" 2>/dev/null || true
  su - postgres -c "psql -c \"DROP ROLE IF EXISTS $DB_USER;\"" 2>/dev/null || true
  ok "Database removed"

  # Remove Caddy entirely
  if command -v caddy &>/dev/null; then
    log "Removing Caddy..."
    systemctl stop caddy 2>/dev/null || true
    systemctl disable caddy 2>/dev/null || true
    apt-get remove -y -qq caddy 2>/dev/null || true
    rm -rf /var/log/caddy 2>/dev/null || true
    rm -f /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null || true
    rm -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    ok "Caddy removed"
  fi

  # Remove SteamCMD
  if [[ -d "$STEAMCMD_DIR" ]]; then
    log "Removing SteamCMD at $STEAMCMD_DIR..."
    rm -rf "$STEAMCMD_DIR"
    ok "SteamCMD removed"
  fi

  # Remove game servers (unless --keep-servers)
  if [[ -d "$GAMESERVERS_DIR" && "$KEEP_SERVERS" != "true" ]]; then
    log "Removing game servers at $GAMESERVERS_DIR..."
    rm -rf "$GAMESERVERS_DIR"
    ok "Game servers removed"
  elif [[ -d "$GAMESERVERS_DIR" ]]; then
    warn "Game servers at $GAMESERVERS_DIR were kept (--keep-servers)"
  fi

  # Remove system user
  log "Removing system user '$GSM_USER'..."
  # Kill any remaining processes
  pkill -u "$GSM_USER" 2>/dev/null || true
  sleep 1
  userdel -r "$GSM_USER" 2>/dev/null || true
  ok "System user removed"
fi

echo ""
echo -e "${GREEN}[✓] GameServer Manager has been uninstalled.${NC}"
if [[ "$PURGE" != "true" ]]; then
  echo ""
  echo "  The following were kept:"
  echo "    - Database '$DB_NAME'"
  echo "    - System user '$GSM_USER'"
  echo "    - SteamCMD at '$STEAMCMD_DIR'"
  echo "    - Game servers at '$GAMESERVERS_DIR'"
  echo ""
  echo "  To fully remove everything:"
  echo "    sudo bash uninstall.sh --purge"
  echo ""
  echo "  To remove everything but keep game server files:"
  echo "    sudo bash uninstall.sh --purge --keep-servers"
fi
echo ""
