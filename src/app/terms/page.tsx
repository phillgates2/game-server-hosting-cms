import type { Metadata } from "next";
import { headers } from "next/headers";
import LegalPage from "@/components/LegalPage";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { loadLegalDocuments } from "@/lib/legal-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Terms of Service.
 *
 * Rendered on the server from the stored text so it is readable with
 * JavaScript disabled, indexable, and identical for everyone — and so the
 * version stamped on the page is the version an acceptance will be checked
 * against.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const legal = await loadLegalDocuments();
    return {
      title: `Terms of Service · ${legal.profile.panelName}`,
      description: `The terms that apply to ${legal.profile.panelName}: accounts, servers, the community features and anything bought from the store.`,
    };
  } catch {
    return { title: "Terms of Service" };
  }
}

export default async function TermsPage() {
  // The ✏️ shortcut is only shown to someone who can actually save the
  // document; a visitor never sees a dead button.
  let isAdmin = false;
  try {
    const auth = await getCurrentUser(await headers());
    isAdmin = Boolean(auth && (await hasPermission(auth.userId, "panel.settings", auth.keyScope)));
  } catch {
    isAdmin = false;
  }
  return <LegalPage id="terms" isAdmin={isAdmin} />;
}
