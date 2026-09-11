/**
 * Public status share links.
 *
 * Lets a server owner hand out a URL that shows "up + players" to people who
 * have no panel account (the community, a status page, a Discord sidebar).
 *
 * Security model: the token IS the authorisation. It is 32 random bytes
 * (256 bits of entropy), so it cannot be guessed or brute-forced, and the
 * public endpoint returns nothing but the status fields — no install path,
 * no config, no owner, no port internals it does not already publish to the
 * game's query protocol. Anyone with the link can see the status; revoking
 * the link means clearing the token.
 */

import { randomBytes } from "node:crypto";

export const STATUS_TOKEN_BYTES = 32;
export const STATUS_TOKEN_RE = /^[a-f0-9]{64}$/;

/** A fresh unguessable share token (64 hex characters). */
export function generateStatusToken(): string {
  return randomBytes(STATUS_TOKEN_BYTES).toString("hex");
}

/** True when a string is exactly the shape the column stores. */
export function isValidStatusToken(token: unknown): token is string {
  return typeof token === "string" && STATUS_TOKEN_RE.test(token);
}

export interface PublicServerStatus {
  name: string;
  game: string;
  online: boolean;
  players: number | null;
  maxPlayers: number | null;
  map: string | null;
  /** ISO time the status was checked. */
  checkedAt: string;
}

/**
 * Shape the public payload from a board probe.
 *
 * Deliberately tiny: this is the ONLY thing the anonymous endpoint may
 * return. Adding a field here is a deliberate privacy decision, so keep it
 * minimal — no ids, no addresses, no paths, no webhooks.
 */
export function publicStatusPayload(input: {
  name: string;
  gameName: string | null;
  running: boolean;
  probe: {
    ok: boolean;
    players?: number;
    maxPlayers?: number;
    map?: string;
  };
  now?: Date;
}): PublicServerStatus {
  const online = input.running && input.probe.ok;
  return {
    name: input.name,
    game: input.gameName || "Game server",
    online,
    players: typeof input.probe.players === "number" ? input.probe.players : null,
    maxPlayers: typeof input.probe.maxPlayers === "number" ? input.probe.maxPlayers : null,
    map: input.probe.map || null,
    checkedAt: (input.now ?? new Date()).toISOString(),
  };
}


// ── Embed snippets for community websites ─────────────────────────────────

/**
 * The iframe variant: paste-and-done, styled by the panel's own page.
 * Height fits a handful of servers; the page scrolls if there are more.
 */
export function buildEmbedIframe(origin: string, heightPx = 480): string {
  const base = origin.replace(/\/+$/, "");
  return `<iframe src="${base}/status" title="Server Status" loading="lazy" style="width:100%;max-width:920px;height:${heightPx}px;border:0;border-radius:12px;background:#0b1020"></iframe>`;
}

/**
 * The script widget variant: fetches the public JSON (CORS-open) and renders
 * a compact list, fully inline-styled so it drops into any site theme.
 */
export function buildEmbedWidget(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `<div id="gsm-status"></div>
<script>
(function () {
  var el = document.getElementById("gsm-status");
  fetch("${base}/api/public/status")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var rows = (d.servers || []).map(function (s) {
        var dot = s.online ? "#22c55e" : "#ef4444";
        var players = s.players === null ? "—" : s.players + (s.maxPlayers !== null ? "/" + s.maxPlayers : "");
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#111827;border:1px solid rgba(148,163,184,.18);border-radius:10px;margin-bottom:8px;font:14px system-ui,sans-serif;color:#e5e9f0">'
          + '<span style="width:10px;height:10px;border-radius:50%;background:' + dot + ';box-shadow:0 0 8px ' + dot + '"></span>'
          + '<span style="flex:1;font-weight:600">' + (s.name || "").replace(/[<>&]/g, "") + "</span>"
          + '<span style="color:#94a3b8">👥 ' + players + "</span></div>";
      });
      el.innerHTML = rows.length ? rows.join("") : '<p style="font:13px system-ui;color:#94a3b8">No servers listed.</p>';
    })
    .catch(function () { el.innerHTML = ""; });
})();
</script>`;
}
