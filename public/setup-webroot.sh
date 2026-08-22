#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  GameServer Manager — point the default web root at the panel
# ═══════════════════════════════════════════════════════════════════════════════
#
#  A fresh Ubuntu/Debian box with Apache or nginx already installed serves the
#  stock "It works!" / "Welcome to nginx!" page from /var/www/html on port 80.
#  After installing the panel, visiting the server in a browser still lands on
#  that placeholder instead of the panel, which looks like a broken install.
#
#  This script makes port 80 serve the panel instead. It prefers a reverse
#  proxy over an HTTP redirect: a redirect to :3000 only works if that port is
#  exposed to the visitor, whereas a proxy keeps everything on port 80 and
#  works through routers, firewalls and corporate networks that only allow 80.
#
#  Usage:  sudo bash setup-webroot.sh [OPTIONS]
#
#  Options:
#    --port PORT       Panel port (default: read from .env, else 3000)
#    --install-dir P   Panel directory (default: /opt/gsm-panel)
#    --redirect-only   Do not touch the web server config; just replace the
#                      files in /var/www/html with an HTML redirect page
#    --webroot PATH    Document root to write the redirect into
#                      (default: /var/www/html)
#    --revert          Undo: restore the most recent backup of whatever this
#                      script changed
#    -y, --yes         No prompts
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[GSM]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

INSTALL_DIR="/opt/gsm-panel"
WEBROOT="/var/www/html"
PANEL_PORT=""
REDIRECT_ONLY="false"
REVERT="false"
ASSUME_YES="false"
BACKUP_DIR="/var/backups/gsm-webroot"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)          PANEL_PORT="${2:-}"; [[ -z "$PANEL_PORT" ]] && die "--port needs a value"; shift 2 ;;
    --install-dir)   INSTALL_DIR="${2:-}"; [[ -z "$INSTALL_DIR" ]] && die "--install-dir needs a path"; shift 2 ;;
    --webroot)       WEBROOT="${2:-}"; [[ -z "$WEBROOT" ]] && die "--webroot needs a path"; shift 2 ;;
    --redirect-only) REDIRECT_ONLY="true"; shift ;;
    --revert)        REVERT="true"; shift ;;
    -y|--yes)        ASSUME_YES="true"; shift ;;
    -h|--help)
      sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
done

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash setup-webroot.sh"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}🌐  Point the web root at GameServer Manager${NC}                ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Revert ───────────────────────────────────────────────────────────────────
if [[ "$REVERT" == "true" ]]; then
  [[ -d "$BACKUP_DIR" ]] || die "No backups found in $BACKUP_DIR"
  LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -type d -name '20*' | sort | tail -1)
  [[ -n "$LATEST" ]] || die "No backups found in $BACKUP_DIR"

  log "Restoring from $LATEST"
  if [[ -f "$LATEST/manifest.txt" ]]; then
    while IFS='|' read -r saved original; do
      [[ -z "$saved" || -z "$original" ]] && continue
      if [[ -e "$LATEST/$saved" ]]; then
        mkdir -p "$(dirname "$original")"
        cp -a "$LATEST/$saved" "$original"
        log "  restored $original"
      fi
    done < "$LATEST/manifest.txt"
  fi

  for svc in apache2 nginx lighttpd; do
    systemctl is-active "$svc" &>/dev/null && systemctl reload "$svc" 2>/dev/null || true
  done
  ok "Reverted. Re-run without --revert to reapply."
  exit 0
fi

# ── Work out the panel port ──────────────────────────────────────────────────
if [[ -z "$PANEL_PORT" ]]; then
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    PANEL_PORT=$(grep -E "^PORT=" "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
  fi
  if [[ -z "$PANEL_PORT" && -f "$INSTALL_DIR/.install-info" ]]; then
    PANEL_PORT=$(grep -E "^PANEL_PORT=" "$INSTALL_DIR/.install-info" 2>/dev/null | head -1 | cut -d= -f2- || true)
  fi
  PANEL_PORT="${PANEL_PORT:-3000}"
fi

if ! [[ "$PANEL_PORT" =~ ^[0-9]+$ ]] || [[ "$PANEL_PORT" -lt 1 || "$PANEL_PORT" -gt 65535 ]]; then
  die "Invalid panel port: '$PANEL_PORT'"
fi
log "Panel port: $PANEL_PORT"

# Warn (don't fail) if the panel isn't answering — the proxy config is still
# valid, the panel may simply be stopped right now.
if curl -sf --max-time 3 "http://127.0.0.1:$PANEL_PORT/api/health" >/dev/null 2>&1; then
  ok "Panel is responding on port $PANEL_PORT"
else
  warn "Panel is not responding on port $PANEL_PORT right now"
  warn "Continuing anyway — start it later with:  gsm start"
fi

# ── Back up anything we are about to change ──────────────────────────────────
STAMP=$(date -u +"%Y%m%d-%H%M%S")
THIS_BACKUP="$BACKUP_DIR/$STAMP"
mkdir -p "$THIS_BACKUP"
: > "$THIS_BACKUP/manifest.txt"

save() {
  # save <path> <label>
  local original="$1" label="$2"
  [[ -e "$original" ]] || return 0
  cp -a "$original" "$THIS_BACKUP/$label"
  echo "$label|$original" >> "$THIS_BACKUP/manifest.txt"
  log "  backed up $original"
}

# ── Detect what is serving port 80 ───────────────────────────────────────────
HAS_APACHE="false"; HAS_NGINX="false"; HAS_LIGHTTPD="false"; HAS_CADDY="false"
command -v apache2ctl &>/dev/null || command -v apachectl &>/dev/null && HAS_APACHE="true"
[[ -d /etc/apache2 ]] && HAS_APACHE="true"
command -v nginx &>/dev/null && HAS_NGINX="true"
command -v lighttpd &>/dev/null && HAS_LIGHTTPD="true"
command -v caddy &>/dev/null && HAS_CADDY="true"

PORT80_OWNER=""
if command -v ss &>/dev/null; then
  PORT80_OWNER=$(ss -tlnp 2>/dev/null | awk '$4 ~ /:80$/ {print $NF}' | grep -oP 'users:\(\("\K[^"]+' | head -1 || true)
fi
[[ -n "$PORT80_OWNER" ]] && log "Port 80 is currently held by: $PORT80_OWNER"

# ── Redirect-only mode: just rewrite the document root ───────────────────────
write_redirect_page() {
  local root="$1"
  mkdir -p "$root"

  # Back up whatever is there so --revert can put it back.
  if [[ -f "$root/index.html" ]]; then save "$root/index.html" "index.html"; fi
  if [[ -f "$root/index.nginx-debian.html" ]]; then save "$root/index.nginx-debian.html" "index.nginx-debian.html"; fi

  # The redirect is built client-side from the browser's own hostname, so the
  # page works whether the box is reached by IP, hostname or domain.
  cat > "$root/index.html" <<HTMLEOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GameServer Manager</title>
<script>
  // Preserve the host the visitor typed; only swap the port.
  (function () {
    var target = window.location.protocol + "//" + window.location.hostname + ":$PANEL_PORT/";
    window.location.replace(target);
  })();
</script>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f1117; color:#e6e8ee;
         font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { text-align:center; padding:2rem 2.5rem; }
  .spin { width:38px; height:38px; margin:0 auto 1.25rem; border-radius:50%;
          border:3px solid #2a2f3e; border-top-color:#5b8cff; animation:s .8s linear infinite; }
  @keyframes s { to { transform:rotate(360deg); } }
  h1 { font-size:1.1rem; font-weight:600; margin:0 0 .4rem; }
  p  { color:#9aa3b8; font-size:.9rem; margin:0; }
  a  { color:#5b8cff; }
</style>
</head>
<body>
  <div class="card">
    <div class="spin"></div>
    <h1>Redirecting to GameServer Manager…</h1>
    <p>If nothing happens, <a id="fallback" href="/">open the panel</a>.</p>
  </div>
  <script>
    document.getElementById("fallback").href =
      window.location.protocol + "//" + window.location.hostname + ":$PANEL_PORT/";
  </script>
</body>
</html>
HTMLEOF

  chmod 644 "$root/index.html"

  # Debian's nginx package ships its own placeholder that takes precedence in
  # the default index order; move it aside so ours actually shows.
  if [[ -f "$root/index.nginx-debian.html" ]]; then
    mv "$root/index.nginx-debian.html" "$root/index.nginx-debian.html.disabled"
  fi

  ok "Wrote redirect page to $root/index.html"
}

# ── Apache: reverse proxy ────────────────────────────────────────────────────
configure_apache() {
  log "Configuring Apache as a reverse proxy..."

  local a2conf="/etc/apache2/sites-available/gsm-panel.conf"
  save "$a2conf" "gsm-panel.conf"
  save "/etc/apache2/sites-enabled/000-default.conf" "000-default.conf"

  a2enmod proxy proxy_http proxy_wstunnel headers rewrite >/dev/null 2>&1 \
    || warn "Could not enable all Apache modules — proxying may not work"

  cat > "$a2conf" <<APACHEEOF
# GameServer Manager — reverse proxy
# Generated by setup-webroot.sh. Re-running the script overwrites this file.
<VirtualHost *:80>
    ProxyPreserveHost On
    ProxyRequests Off

    # WebSocket upgrade for live logs, RCON and metrics.
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:$PANEL_PORT/\$1 [P,L]

    ProxyPass        / http://127.0.0.1:$PANEL_PORT/
    ProxyPassReverse / http://127.0.0.1:$PANEL_PORT/

    # File-manager uploads need a generous body limit.
    LimitRequestBody 268435456

    ErrorLog  \${APACHE_LOG_DIR}/gsm-panel-error.log
    CustomLog \${APACHE_LOG_DIR}/gsm-panel-access.log combined
</VirtualHost>
APACHEEOF

  # The stock default vhost also answers on :80 and would win by name order.
  a2dissite 000-default >/dev/null 2>&1 || true
  a2ensite gsm-panel >/dev/null 2>&1 || die "a2ensite failed"

  if apache2ctl configtest >/dev/null 2>&1 || apachectl configtest >/dev/null 2>&1; then
    ok "Apache config is valid"
  else
    err "Apache config test failed — reverting"
    a2dissite gsm-panel >/dev/null 2>&1 || true
    a2ensite 000-default >/dev/null 2>&1 || true
    die "Apache was left as it was. Run with --redirect-only for the simpler approach."
  fi

  systemctl reload apache2 2>/dev/null || systemctl restart apache2 2>/dev/null || true
  ok "Apache now proxies port 80 to the panel"
}

# ── nginx: reverse proxy ─────────────────────────────────────────────────────
configure_nginx() {
  log "Configuring nginx as a reverse proxy..."

  local site="/etc/nginx/sites-available/gsm-panel"
  save "$site" "gsm-panel.nginx"
  save "/etc/nginx/sites-enabled/default" "nginx-default"

  cat > "$site" <<NGINXEOF
# GameServer Manager — reverse proxy
# Generated by setup-webroot.sh. Re-running the script overwrites this file.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # File-manager uploads.
    client_max_body_size 256M;

    location / {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;

        # WebSocket upgrade for live logs, RCON and metrics.
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Long-lived responses (log streaming) must not be cut off.
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
NGINXEOF

  mkdir -p /etc/nginx/sites-enabled
  ln -sf "$site" /etc/nginx/sites-enabled/gsm-panel
  # The packaged default is also `default_server` on :80 and would clash.
  rm -f /etc/nginx/sites-enabled/default

  if nginx -t >/dev/null 2>&1; then
    ok "nginx config is valid"
  else
    err "nginx config test failed — reverting"
    rm -f /etc/nginx/sites-enabled/gsm-panel
    [[ -e /etc/nginx/sites-available/default ]] && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
    nginx -t >/dev/null 2>&1 || true
    die "nginx was left as it was. Run with --redirect-only for the simpler approach."
  fi

  systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
  ok "nginx now proxies port 80 to the panel"
}

# ── lighttpd: reverse proxy ──────────────────────────────────────────────────
configure_lighttpd() {
  log "Configuring lighttpd as a reverse proxy..."
  local conf="/etc/lighttpd/conf-available/50-gsm-panel.conf"
  save "$conf" "50-gsm-panel.conf"

  mkdir -p /etc/lighttpd/conf-available
  cat > "$conf" <<LIGHTEOF
# GameServer Manager — reverse proxy
server.modules += ( "mod_proxy" )
\$HTTP["host"] =~ ".*" {
    proxy.server = ( "" => ( ( "host" => "127.0.0.1", "port" => $PANEL_PORT ) ) )
}
LIGHTEOF

  lighttpd-enable-mod gsm-panel >/dev/null 2>&1 || true
  if lighttpd -t -f /etc/lighttpd/lighttpd.conf >/dev/null 2>&1; then
    systemctl reload lighttpd 2>/dev/null || systemctl restart lighttpd 2>/dev/null || true
    ok "lighttpd now proxies port 80 to the panel"
  else
    warn "lighttpd config test failed — falling back to a redirect page"
    write_redirect_page "$WEBROOT"
  fi
}

# ── Decide what to do ────────────────────────────────────────────────────────
if [[ "$REDIRECT_ONLY" == "true" ]]; then
  log "Redirect-only mode — leaving the web server configuration alone"
  write_redirect_page "$WEBROOT"

elif [[ "$HAS_CADDY" == "true" && -f /etc/caddy/Caddyfile ]] && grep -q "reverse_proxy 127.0.0.1:$PANEL_PORT" /etc/caddy/Caddyfile 2>/dev/null; then
  ok "Caddy is already proxying to the panel — nothing to do"
  if [[ -d "$WEBROOT" ]] && [[ -f "$WEBROOT/index.html" || -f "$WEBROOT/index.nginx-debian.html" ]]; then
    log "A stale page still exists in $WEBROOT; it is not being served by Caddy."
  fi
  exit 0

elif [[ "$HAS_APACHE" == "true" ]]; then
  if [[ "$ASSUME_YES" != "true" ]]; then
    echo ""
    echo "  Apache is installed. Port 80 will be reverse-proxied to the panel"
    echo "  and the default site (000-default) will be disabled."
    read -rp "  Continue? [y/N]: " c; [[ "${c,,}" == "y" ]] || { log "Cancelled."; exit 0; }
  fi
  configure_apache

elif [[ "$HAS_NGINX" == "true" ]]; then
  if [[ "$ASSUME_YES" != "true" ]]; then
    echo ""
    echo "  nginx is installed. Port 80 will be reverse-proxied to the panel"
    echo "  and the packaged default site will be disabled."
    read -rp "  Continue? [y/N]: " c; [[ "${c,,}" == "y" ]] || { log "Cancelled."; exit 0; }
  fi
  configure_nginx

elif [[ "$HAS_LIGHTTPD" == "true" ]]; then
  configure_lighttpd

else
  warn "No Apache, nginx or lighttpd found."
  if [[ -d "$WEBROOT" ]]; then
    log "Writing a redirect page into $WEBROOT in case something serves it."
    write_redirect_page "$WEBROOT"
  else
    log "Nothing is serving port 80. The panel is reachable directly:"
    log "  http://<server-ip>:$PANEL_PORT"
    log "For HTTPS on a domain, re-run the installer with --caddy."
    exit 0
  fi
fi

# ── Verify ───────────────────────────────────────────────────────────────────
echo ""
log "Checking port 80..."
sleep 1
if curl -sfI --max-time 5 "http://127.0.0.1/" >/dev/null 2>&1; then
  BODY=$(curl -sf --max-time 5 "http://127.0.0.1/" 2>/dev/null | head -c 2000 || true)
  if echo "$BODY" | grep -qi "GameServer Manager\|Redirecting to GameServer"; then
    ok "Port 80 now serves the panel"
  elif echo "$BODY" | grep -qi "It works\|Welcome to nginx"; then
    warn "Port 80 still shows the default page — try:  sudo bash setup-webroot.sh --redirect-only"
  else
    ok "Port 80 responded (panel may still be starting)"
  fi
else
  warn "Port 80 did not respond. Is the web server running, and is port 80 open?"
fi

echo ""
echo -e "${GREEN}[✓] Done.${NC}"
echo ""
echo "  Panel:     http://<server-ip>/"
echo "  Direct:    http://<server-ip>:$PANEL_PORT"
echo "  Backup:    $THIS_BACKUP"
echo "  Undo:      sudo bash setup-webroot.sh --revert"
echo ""
