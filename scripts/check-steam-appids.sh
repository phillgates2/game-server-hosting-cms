#!/usr/bin/env bash
# Validate every SteamCMD app id the panel's templates use, against the real
# Steam network. Steam's Web API hides depot-only (dedicated-server) apps, so
# this must run where steamcmd can - i.e. on one of your nodes:
#
#   bash scripts/check-steam-appids.sh            # uses /opt/steamcmd
#   STEAMCMD_BIN=/usr/games/steamcmd bash scripts/check-steam-appids.sh
#
# For each app id, steamcmd fetches the app info; a valid, public depot shows
# a DepotID line. Hidden/app-only ids (client apps) are NOT expected here -
# every id in the list is a server app.
set -u

STEAMCMD_BIN="${STEAMCMD_BIN:-/opt/steamcmd/steamcmd.sh}"
if [ ! -x "$STEAMCMD_BIN" ]; then
  echo "steamcmd not found at $STEAMCMD_BIN (set STEAMCMD_BIN to its path)" >&2
  exit 1
fi

cd "$(dirname "$0")/.." || exit 1
LIST=$(npx tsx -e '
  import { gameTemplates } from "./src/db/games";
  for (const t of gameTemplates) if (t.steamAppId) console.log(`${t.slug}\t${t.steamAppId}`);
' 2>/dev/null)
if [ -z "$LIST" ]; then
  echo "could not read the game template app ids (run from the repo root via npm)" >&2
  exit 1
fi

pass=0; fail=0
while IFS=$'\t' read -r slug appid; do
  [ -z "$slug" ] && continue
  # app_print_info prints the depot list for public server apps; a few frames
  # is enough to prove the id exists and is downloadable anonymously.
  out=$("$STEAMCMD_BIN" +login anonymous +app_info_update 1 +app_print_info "$appid" +quit 2>&1)
  if echo "$out" | grep -q "DepotID"; then
    echo "  [ ok ] $slug ($appid)"
    pass=$((pass + 1))
  else
    echo "  [FAIL] $slug ($appid)"
    echo "$out" | grep -viE "^(Steam|Redirecting|Logging|Executing|^\s*$)" | tail -3 | sed 's/^/         /'
    fail=$((fail + 1))
  fi
done <<< "$LIST"

echo
echo "$pass app id(s) ok, $fail failed"
[ "$fail" -eq 0 ]
