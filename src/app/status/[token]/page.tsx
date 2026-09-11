import type { Metadata } from "next";
import { headers } from "next/headers";
import { lookupPublicStatus } from "@/lib/status-lookup";
import { publicThrottleAllowed } from "@/lib/public-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read-only status page.
 *
 * No account, no login, no session — the unguessable token in the URL is the
 * only key. Server-rendered with a 60-second meta refresh so it works with
 * JavaScript disabled; everything is inline-styled so the page stands alone
 * even where the panel's stylesheets are not loaded.
 */

interface Props {
  params: Promise<{ token: string }>;
}

// A static title on purpose: probing here would double every page load and
// would fire for garbage tokens too. The page body carries the live status.
export const metadata: Metadata = {
  title: "Server Status",
  robots: { index: false, follow: false },
};

export default async function PublicStatusPage({ params }: Props) {
  const { token } = await params;

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "anon";
  const throttled = !publicThrottleAllowed(`public-status:${ip}`);

  // Only probe the game server when the request itself is allowed.
  const status = throttled ? null : await lookupPublicStatus(token).catch(() => null);

  const wrap: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "radial-gradient(1200px 600px at 50% -10%, #1e2a44 0%, #0b1020 55%, #070b14 100%)",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    color: "#e5e9f0",
  };
  const card: React.CSSProperties = {
    width: "100%",
    maxWidth: 460,
    background: "rgba(17, 24, 39, 0.85)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 16,
    padding: "32px 28px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
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

  if (!status) {
    return (
      <main style={wrap}>
        <div style={card}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Status link not found</h1>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
            This link is invalid or has been revoked by the server owner. Ask
            them for a fresh share link.
          </p>
        </div>
      </main>
    );
  }

  const dot = status.online ? "#22c55e" : "#ef4444";
  const players =
    status.players !== null
      ? `${status.players}${status.maxPlayers !== null ? ` / ${status.maxPlayers}` : ""}`
      : "—";

  return (
    <main style={wrap}>
      {/* The page answers "is it up?" without JavaScript; this keeps it fresh. */}
      <meta httpEquiv="refresh" content="60" />
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: dot,
              boxShadow: `0 0 12px ${dot}`,
              flexShrink: 0,
            }}
          />
          <h1 style={{ margin: 0, fontSize: 22, overflowWrap: "anywhere" }}>{status.name}</h1>
        </div>
        <p style={{ margin: "6px 0 20px", color: "#94a3b8", fontSize: 14 }}>{status.game}</p>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 600,
            color: dot,
            background: status.online ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${status.online ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
          }}
        >
          {status.online ? "🟢 Online" : "🔴 Offline"}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 22 }}>
          <div style={{ background: "rgba(2, 6, 23, 0.5)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>Players</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{players}</div>
          </div>
          <div style={{ background: "rgba(2, 6, 23, 0.5)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>Map</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4, overflowWrap: "anywhere" }}>{status.map ?? "—"}</div>
          </div>
        </div>

        <p style={{ marginTop: 22, marginBottom: 0, fontSize: 12, color: "#64748b" }}>
          Checked {new Date(status.checkedAt).toLocaleString()} · refreshes every 60s ·{" "}
          <a
            href={`/api/public/status/${token}`}
            style={{ color: "#7dd3fc", textDecoration: "none" }}
          >
            JSON
          </a>
        </p>
      </div>
    </main>
  );
}
