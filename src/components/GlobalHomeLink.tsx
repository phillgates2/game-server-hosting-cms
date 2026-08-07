"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function GlobalHomeLink() {
  const pathname = usePathname();

  if (pathname === "/") {
    return null;
  }

  return (
    <Link
      href="/"
      aria-label="Go to home"
      title="Home"
      className="fixed top-4 left-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-card/90 text-text-primary shadow-md backdrop-blur hover:bg-bg-hover sm:h-auto sm:w-auto sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm sm:font-medium sm:shadow-lg"
    >
      <span className="sm:hidden" aria-hidden="true">🏠</span>
      <span className="hidden sm:inline">Home</span>
    </Link>
  );
}