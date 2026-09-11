import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { lookupPublicList } from "@/lib/status-lookup";
import { publicThrottleAllowed } from "@/lib/public-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aggregated public status board.
 *
 * Lists every server its owner opted in to (`status_public`), answering the
 * community question "what's up right now?" on one shareable page — no
 * account, no login. Server-rendered with a 60-second meta refresh so it
 * works with JavaScript disabled; fully inline-styled so it stands alone.
 *
 * Each server also has its own unguessable deep link via /status/<token>;
 * this page is the opt-in directory alongside it.
 */

export const metadata: Metadata = {
  title: "Server Status",
  robots: { index: false, follow: false },
};

export default async function PublicStatusListPage() {
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "anon";
  const throttled = !publicThrottleAllowed(`public-status:${ip}`);

  // Only probe the fleet when the request itself is allowed.
  const servers = throttled ? [] : await lookupPublicList().catch(() => []);
  const online = servers.filter((s) => s.online).length;

  const wrap: React.CSSProperties = {
    minHeight: "100vh",
    padding: "40px 24px",
    background: "radial-gradient(1200px 600px at 50% -10%, #1e2a44 0%, #0b1020 55%, #070b14 100%)",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    color: "#e5e9f0",
  };
  const shell: React.CSSProperties = { maxWidth: 920, margin: "0 auto" };
  const card: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 16,
    background: "rgba(17, 24, 39, 0.85)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 14,
    padding: "16px 20px",
  };


  if (throttled) {
    return (
      <main style={wrap}>
        <div style={{ maxWidth: 460, margin: "0 auto", background: "rgba(17, 24, 39, 0.85)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 16, padding: "32px 28px" }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Slow down a moment</h1>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
            This page refreshed too many times in a row. It will be back in a
            minute — the limit protects the game servers behind it.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <meta httpEquiv="refresh" content="60" />
      <div style={shell}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>🎮 Server Status</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
            {online} of {servers.length} online · refreshes every 60s
          </p>
        </div>

        {servers.length === 0 ? (
          <div style={{ ...card, marginTop: 24, justifyContent: "center" }}>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 14 }}>
              No servers are listed here yet. Owners opt a server in with the
              “Public listing” toggle on its share link.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            {servers.map((s) => {
              const dot = s.online ? "#22c55e" : "#ef4444";
              const players =
                s.players !== null
                  ? `${s.players}${s.maxPlayers !== null ? ` / ${s.maxPlayers}` : ""}`
                  : "—";
              return (
                <div key={`${s.name}-${s.checkedAt}`} style={card}>
                  <span
                    aria-hidden
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: "50%",
                      background: dot,
                      boxShadow: `0 0 10px ${dot}`,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: "anywhere" }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{s.game}</div>
                  </div>
                  {s.map && (
                    <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 180, overflowWrap: "anywhere" }}>
                      {s.map}
                    </div>
                  )}
                  <div style={{ textAlign: "right", minWidth: 92 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{players}</div>
                    <div style={{ fontSize: 11, color: dot, fontWeight: 600 }}>
                      {s.online ? "🟢 Online" : "🔴 Offline"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ marginTop: 24, fontSize: 12, color: "#64748b" }}>
          Checked {new Date().toLocaleString()} ·{" "}
          <Link href="/api/public/status" style={{ color: "#7dd3fc", textDecoration: "none" }}>
            JSON
          </Link>
        </p>
      </div>
    </main>
  );
}
