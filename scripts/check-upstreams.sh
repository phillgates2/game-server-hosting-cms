#!/usr/bin/env bash
# Check that every upstream URL the game installers depend on is still alive,
# and that the JSON-parsing expressions in those installers still match what
# the API returns today.
#
#   bash scripts/check-upstreams.sh
#
# This talks to the public internet, so it is intentionally NOT part of
# `npm run verify` - upstreams go down for reasons that have nothing to do
# with this repo. Run it when an installer starts failing in the wild.

pass=0; fail=0
ok()   { echo "  [ ok ] $*"; pass=$((pass+1)); }
bad()  { echo "  [FAIL] $*"; fail=$((fail+1)); }

head_ok() { curl -fsIL --max-time 25 -A "Mozilla/5.0 (GSM-Panel upstream check)" "$1" >/dev/null 2>&1; }

echo "── Static download endpoints ──────────────────────────────────────────"
while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  if head_ok "$url"; then ok "$name"; else bad "$name -> $url"; fi
done <<'EOF'
SteamCMD tarball|https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
Factorio headless|https://factorio.com/get-download/stable/headless/linux64
Xonotic 0.8.6|https://dl.xonotic.org/xonotic-0.8.6.zip
ET:Legacy x86_64|https://www.etlegacy.com/download/file/715
ET:Legacy i386|https://www.etlegacy.com/download/file/716
Mojang manifest|https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
PaperMC API|https://fill.papermc.io/v3/projects/paper
EOF

echo ""
echo "── API shape checks (do our grep patterns still match?) ───────────────"

# Minecraft: manifest -> version json -> server url + required java
MANIFEST=$(curl -fsSL --max-time 25 "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json" 2>/dev/null)
LATEST=$(echo "$MANIFEST" | grep -oP '"release"\s*:\s*"\K[^"]+' | head -1)
if [ -n "$LATEST" ]; then ok "Mojang latest release parsed: $LATEST"; else bad "Mojang: could not parse latest release"; fi

VJ_URL=$(echo "$MANIFEST" | grep -oP '"id":\s*"'"$LATEST"'".{0,500}?"url":\s*"\Khttps?://[^"]+' | head -1)
if [ -n "$VJ_URL" ]; then ok "Mojang version JSON URL parsed"; else bad "Mojang: could not parse version JSON URL"; fi

if [ -n "$VJ_URL" ]; then
  VJSON=$(curl -fsSL --max-time 25 "$VJ_URL" 2>/dev/null)
  SRV=$(echo "$VJSON" | grep -oP '"server"\s*:\s*\{[^}]*"url"\s*:\s*"\K[^"]+' | head -1)
  [ -n "$SRV" ] && ok "Mojang server.jar URL parsed" || bad "Mojang: could not parse server.jar URL"
  RJ=$(echo "$VJSON" | grep -oP '"majorVersion"\s*:\s*\K[0-9]+' | head -1)
  [ -n "$RJ" ] && ok "Mojang required Java parsed: $RJ" || bad "Mojang: could not parse majorVersion"
fi

# PaperMC
PV=$(curl -fsSL --max-time 25 "https://fill.papermc.io/v3/projects/paper" 2>/dev/null \
     | grep -oP '"[0-9]+\.[0-9]+(\.[0-9]+)?"' | tr -d '"' | sort -V | tail -1)
if [ -n "$PV" ]; then ok "Paper latest version parsed: $PV"; else bad "Paper: could not parse version list"; fi
if [ -n "$PV" ]; then
  BJ=$(curl -fsSL --max-time 25 "https://fill.papermc.io/v3/projects/paper/versions/$PV/builds/latest" 2>/dev/null)
  BID=$(echo "$BJ" | grep -oP '"id"\s*:\s*\K[0-9]+' | head -1)
  DURL=$(echo "$BJ" | grep -oP '"server:default"\s*:\s*\{.*?"url"\s*:\s*"\Khttps?://[^"]+' | head -1)
  SHA=$(echo "$BJ" | grep -oP '"sha256"\s*:\s*"\K[0-9a-f]{64}' | head -1)
  [ -n "$BID" ]  && ok "Paper build id parsed: $BID"   || bad "Paper: could not parse build id"
  [ -n "$DURL" ] && ok "Paper download URL parsed"      || bad "Paper: could not parse download URL"
  [ -n "$SHA" ]  && ok "Paper sha256 parsed"            || bad "Paper: could not parse sha256"
fi

# GitHub release assets
gh_asset() { # $1 repo, $2 grep filter, $3 label
  local j u
  j=$(curl -fsSL --max-time 25 -H "Accept: application/vnd.github+json" \
       "https://api.github.com/repos/$1/releases/latest" 2>/dev/null)
  u=$(echo "$j" | grep -oP '"browser_download_url"\s*:\s*"\K[^"]+' | grep -- "$2" | head -1)
  if [ -n "$u" ]; then ok "$3 asset found"; else bad "$3: no asset matching '$2'"; fi
}
gh_asset "Pryaxis/TShock"            "-linux-x64-"  "TShock (Terraria)"
gh_asset "compujuckel/AssettoServer" "-linux-x64"   "AssettoServer"

# Bedrock link API
BR=$(curl -fsSL --max-time 25 "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links" 2>/dev/null \
     | grep -oP '"downloadType":"serverBedrockLinux","downloadUrl":"\K[^"]+' | head -1)
if [ -n "$BR" ]; then ok "Bedrock download URL parsed"; else bad "Bedrock: link API did not yield a URL"; fi

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
