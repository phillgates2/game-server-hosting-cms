"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error screen.
 *
 * Next's built-in page in production is a bare "Application error: a
 * client-side exception has occurred", which tells an operator nothing and
 * offers no way out. This one keeps the panel's framing, offers a retry (the
 * error boundary re-renders the segment) and a way back to a screen that works.
 *
 * The exception message is only shown outside production: it is useful in
 * development and can leak internals from a live panel.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  const showDetail = process.env.NODE_ENV !== "production";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-danger/30 bg-bg-card p-6 text-center">
        <span className="block text-3xl" aria-hidden>
          ⚠️
        </span>
        <h1 className="text-lg font-semibold">This screen hit an error</h1>
        <p className="text-sm text-text-secondary">
          Nothing was lost — the rest of the panel is still running. Try the
          screen again, or go back to the homepage.
        </p>
        {showDetail && (
          <p className="break-all rounded-lg bg-bg-secondary p-2 font-mono text-[11px] text-text-muted">
            {error.message || "Unknown error"}
            {error.digest ? ` (${error.digest})` : ""}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover"
          >
            Back to the site
          </Link>
        </div>
        {error.digest && (
          <p className="text-[11px] text-text-muted">
            Reference <code className="text-text-secondary">{error.digest}</code>{" "}
            for the panel logs.
          </p>
        )}
      </div>
    </div>
  );
}
