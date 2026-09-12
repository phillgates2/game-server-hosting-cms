import type { Metadata } from "next";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { API_DOCS, countDocumentedEndpoints } from "@/lib/api-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API Reference — GameServer Manager",
  robots: { index: false, follow: false },
};

const METHOD_COLORS: Record<string, string> = {
  GET: "#22c55e",
  POST: "#38bdf8",
  PATCH: "#f59e0b",
  DELETE: "#ef4444",
  PUT: "#a78bfa",
};

/**
 * Curated API reference for session users and API-key integrators.
 * Session-gated: it maps the panel's surface, so it is not public.
 */
export default async function ApiDocsPage() {
  const hdrs = await headers();
  const auth = await getCurrentUser(hdrs).catch(() => null);

  if (!auth) {
    return (
      <main style={{ minHeight: "100vh", background: "#0b1020", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>🔒 Sign in required</h1>
          <p style={{ color: "#94a3b8" }}>The API reference is only visible to panel users.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0b1020", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", padding: "32px 16px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>📖 API Reference</h1>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            {countDocumentedEndpoints()} documented endpoints · authenticate with your session cookie or an{" "}
            <strong>API key</strong> (<code style={code}>Authorization: Bearer gsm_…</code> header). Paths use <code style={code}>:id</code> placeholders.
          </p>
          <p style={{ color: "#64748b", fontSize: 13 }}>
            Canonical source is the route files under <code style={code}>src/app/api</code> — this page documents the
            endpoints integrators use.
          </p>
        </header>

        {API_DOCS.map((group) => (
          <section key={group.title} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 18, borderBottom: "1px solid #1e293b", paddingBottom: 8 }}>
              {group.icon} {group.title}
            </h2>
            {group.note && <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8 }}>{group.note}</p>}
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {group.endpoints.map((ep) => (
                <div key={`${ep.method} ${ep.path}`} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ color: METHOD_COLORS[ep.method] ?? "#e2e8f0", fontWeight: 700, fontSize: 13, width: 56 }}>{ep.method}</span>
                    <code style={{ ...code, fontSize: 14 }}>{ep.path}</code>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", border: "1px solid #1e293b", borderRadius: 999, padding: "2px 10px" }}>{ep.auth}</span>
                  </div>
                  <p style={{ margin: "6px 0 0", color: "#cbd5e1", fontSize: 13 }}>{ep.description}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

const code: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 6,
  padding: "2px 6px",
  fontFamily: "ui-monospace, monospace",
};
