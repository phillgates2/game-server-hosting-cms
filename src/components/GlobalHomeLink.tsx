"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function GlobalHomeLink() {
  const pathname = usePathname();

  return (
    <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
      <Link
        href="/"
        aria-label="Go to homepage"
        title="Homepage"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-card/90 text-text-primary shadow-md backdrop-blur hover:bg-bg-hover sm:h-auto sm:w-auto sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm sm:font-medium sm:shadow-lg"
      >
        <span className="sm:hidden" aria-hidden="true">🏠</span>
        <span className="hidden sm:inline">Homepage</span>
      </Link>
      <Link
        href="/?view=frontpage#frontpage"
        aria-label="Go to public frontpage"
        title="Frontpage"
        className="hidden sm:flex items-center justify-center rounded-lg border border-border bg-bg-card/90 px-3 py-2 text-sm font-medium text-text-primary shadow-lg backdrop-blur hover:bg-bg-hover"
      >
        {pathname === "/" ? "Frontpage" : "Public Frontpage"}
      </Link>
    </div>
  );
}