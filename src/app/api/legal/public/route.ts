import { NextResponse } from "next/server";
import { loadLegalDocuments } from "@/lib/legal-store";

export const runtime = "nodejs";

/**
 * The published legal version, for the surfaces that ask people to accept it.
 *
 * Public and read-only, and it exposes nothing but the version string and the
 * two paths: registration and checkout need to know which version they are
 * about to record, and both happen before an account exists. The documents
 * themselves are on /terms and /privacy — this is not a second copy.
 *
 * Cacheable for a minute (the text changes when an operator saves, not per
 * request) but *not* longer, because a stale version here would be rejected by
 * the acceptance gate.
 */
export async function GET() {
  try {
    const legal = await loadLegalDocuments();
    return NextResponse.json(
      {
        version: legal.version.version,
        updated: legal.version.date,
        documents: [
          { id: "terms", title: "Terms of Service", path: "/terms" },
          { id: "privacy", title: "Privacy Policy", path: "/privacy" },
        ],
      },
      { headers: { "cache-control": "public, max-age=60" } }
    );
  } catch {
    // No database, no version. The callers treat an empty version as "do not
    // block the customer" — refusing a sale because a settings read failed
    // would be the worse failure.
    return NextResponse.json({ version: "", updated: "", documents: [] });
  }
}
