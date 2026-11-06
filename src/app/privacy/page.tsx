import type { Metadata } from "next";
import { headers } from "next/headers";
import LegalPage from "@/components/LegalPage";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { loadLegalDocuments } from "@/lib/legal-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Privacy Policy.
 *
 * The data-handling counterpart to /terms, built the same way: stored text,
 * server-rendered, with the version a reader is agreeing to stamped on it.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const legal = await loadLegalDocuments();
    return {
      title: `Privacy Policy · ${legal.profile.panelName}`,
      description: `What personal information ${legal.profile.panelName} collects, why, who it is shared with, how long it is kept and how to get it back or have it deleted.`,
    };
  } catch {
    return { title: "Privacy Policy" };
  }
}

export default async function PrivacyPage() {
  let isAdmin = false;
  try {
    const auth = await getCurrentUser(await headers());
    isAdmin = Boolean(auth && (await hasPermission(auth.userId, "panel.settings", auth.keyScope)));
  } catch {
    isAdmin = false;
  }
  return <LegalPage id="privacy" isAdmin={isAdmin} />;
}
