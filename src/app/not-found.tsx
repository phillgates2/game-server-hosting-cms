import Link from "next/link";

/**
 * Branded 404.
 *
 * The old default was the framework's unstyled white page, which on a dark
 * gaming panel reads like the site broke rather than like a missing URL.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-bg-card p-6 text-center">
        <p className="text-4xl font-bold text-accent" aria-hidden>
          404
        </p>
        <h1 className="text-lg font-semibold">That page doesn&apos;t exist</h1>
        <p className="text-sm text-text-secondary">
          The link may be old, or the page may have been renamed. The homepage
          and the control panel are still where you left them.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Go to the homepage
          </Link>
          <Link
            href="/status"
            className="rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover"
          >
            Server status
          </Link>
        </div>
      </div>
    </div>
  );
}
