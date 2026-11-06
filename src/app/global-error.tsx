"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Last-resort error screen.
 *
 * `global-error.tsx` replaces the root layout when the layout itself fails, so
 * — unlike `error.tsx` — it cannot rely on the app's stylesheet, providers or
 * fonts still being mounted. Everything here is inline, on a plain background,
 * so the panel always has *something* readable to show instead of a blank
 * white page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#070b14",
          color: "#eaf2ff",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: "480px",
            width: "100%",
            border: "1px solid rgba(239,68,68,0.35)",
            background: "#111f34",
            borderRadius: "16px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "8px" }} aria-hidden>
            ⚠️
          </div>
          <h1 style={{ fontSize: "18px", margin: "0 0 8px" }}>
            The panel could not start this page
          </h1>
          <p style={{ fontSize: "14px", color: "#9db2d2", margin: "0 0 16px" }}>
            Your servers are unaffected. Retry the page, or reload the panel; if
            it keeps happening, check the panel logs.
          </p>
          <div
            style={{
              display: "flex",
              gap: "8px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#22d3ee",
                color: "#05202a",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #2a4264",
                background: "#17243a",
                color: "#9db2d2",
                fontSize: "14px",
                textDecoration: "none",
              }}
            >
              Back to the site
            </Link>
          </div>
          {error.digest && (
            <p style={{ fontSize: "11px", color: "#6980a5", margin: "16px 0 0" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
