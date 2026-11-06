/**
 * The public legal pages — `/terms` and `/privacy`.
 *
 * One component for both, because they are the same document rendered twice:
 * a server-rendered page (no client JavaScript required to read a policy),
 * with the same header, the same cross-links and the same footer that names the
 * version a reader is looking at.
 *
 * The article body comes from `parseLegalDocument`, which returns *data*, not
 * HTML. Every node is a React element, so an operator can paste whatever they
 * like into the editor and it will be displayed, never executed.
 */

import Link from "next/link";
import {
  legalDocument,
  type LegalBlock,
  type LegalDocumentId,
  type LegalInline,
} from "@/lib/legal";
import { loadLegalDocuments, type LegalDocuments } from "@/lib/legal-store";

export const dynamic = "force-dynamic";

const SHELL = "min-h-screen bg-bg-primary text-text-primary";
const CARD = "rounded-2xl border border-border bg-bg-card";

function Inline({ nodes }: { nodes: LegalInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === "bold") {
          return (
            <strong key={index} className="font-semibold text-text-primary">
              {node.text}
            </strong>
          );
        }
        if (node.kind === "link") {
          const external = /^https?:\/\//i.test(node.href);
          return (
            <a
              key={index}
              href={node.href}
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              {...(external ? { rel: "noreferrer noopener", target: "_blank" } : {})}
            >
              {node.text}
            </a>
          );
        }
        return <span key={index}>{node.text}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "title":
            return (
              <h1 key={index} className="text-2xl sm:text-3xl font-bold tracking-tight">
                <Inline nodes={block.inlines} />
              </h1>
            );
          case "heading":
            return (
              <h2
                key={index}
                className="text-base sm:text-lg font-semibold text-text-primary pt-4 scroll-mt-6"
              >
                <Inline nodes={block.inlines} />
              </h2>
            );
          case "bullets":
            return (
              <ul key={index} className="list-disc pl-5 space-y-1.5 text-sm text-text-secondary leading-relaxed">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline nodes={item} />
                  </li>
                ))}
              </ul>
            );
          case "ordered":
            return (
              <ol
                key={index}
                start={block.start}
                className="list-decimal pl-5 space-y-1.5 text-sm text-text-secondary leading-relaxed"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline nodes={item} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={index} className="text-sm text-text-secondary leading-relaxed">
                <Inline nodes={block.inlines} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Nav({ current, isAdmin }: { current: LegalDocumentId; isAdmin: boolean }) {
  const links = [
    { href: "/", label: "← Home" },
    { href: "/terms", label: "Terms of Service", id: "terms" as const },
    { href: "/privacy", label: "Privacy Policy", id: "privacy" as const },
    { href: "/shop", label: "🛒 Store" },
  ];
  return (
    <nav className="flex flex-wrap items-center gap-1.5 sm:gap-2" aria-label="Legal pages">
      {links.map((link) => {
        const isCurrent = "id" in link && link.id === current;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent ? "page" : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm border transition-colors ${
              isCurrent
                ? "border-accent/40 bg-accent/15 text-accent font-medium"
                : "border-border bg-bg-secondary text-text-secondary hover:text-accent hover:border-accent/30"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href="/#site-editor"
          className="px-3 py-1.5 rounded-lg text-xs sm:text-sm border border-border bg-bg-secondary text-text-muted hover:text-accent hover:border-accent/30"
          title="Edit the published text from the panel"
        >
          ✏️ Edit
        </Link>
      )}
    </nav>
  );
}

/**
 * Render one document.
 *
 * A database that cannot be reached is not fatal here: `loadLegalDocuments`
 * falls back to the shipped text, and if even that fails the page shows the
 * default rather than a 500. A customer looking for the refund policy should
 * get the policy, not an error page.
 */
export default async function LegalPage({
  id,
  isAdmin = false,
}: {
  id: LegalDocumentId;
  isAdmin?: boolean;
}) {
  let legal: LegalDocuments;
  try {
    legal = await loadLegalDocuments();
  } catch {
    const { buildLegalDocuments } = await import("@/lib/legal-store");
    legal = buildLegalDocuments({ values: {} });
  }

  const meta = legalDocument(id);
  const document = legal.documents[id];
  const other = legal.documents[id === "terms" ? "privacy" : "terms"];
  const otherMeta = legalDocument(id === "terms" ? "privacy" : "terms");

  return (
    <main className={SHELL}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <header className="space-y-4">
          <Nav current={id} isAdmin={isAdmin} />
          <div>
            <p className="text-xs uppercase tracking-widest text-text-muted">
              {legal.profile.panelName}
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-1">{meta.title}</h1>
            <p className="text-xs text-text-muted mt-2">
              Last updated {legal.version.date} ·{" "}
              <span className="font-mono" title="The version recorded when you accept these terms">
                v{legal.version.version}
              </span>
            </p>
          </div>
        </header>

        <article className={`${CARD} p-5 sm:p-8`}>
          <Blocks blocks={document.blocks} />
        </article>

        <section className={`${CARD} p-5 sm:p-6 space-y-3`}>
          <h2 className="text-sm font-semibold">Also worth reading</h2>
          <p className="text-sm text-text-secondary">
            The {otherMeta.title.toLowerCase()} explains what data this service keeps and why. It is
            part of the same agreement.
          </p>
          <Link
            href={otherMeta.path}
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Read the {otherMeta.title}
          </Link>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted pt-2">
          <span>
            © {new Date().getFullYear()} {legal.profile.operatorName || legal.profile.panelName}
          </span>
          <div className="flex flex-wrap gap-3">
            <Link href="/terms" className="hover:text-text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/" className="hover:text-text-primary transition-colors">
              Home
            </Link>
            <Link href="/status" className="hover:text-text-primary transition-colors">
              Status
            </Link>
          </div>
        </footer>

        <p className="text-[11px] text-text-muted/80 border-t border-border pt-4">
          {other.title} and this document were supplied with the {legal.profile.panelName} software as
          a starting point for the operator and are not legal advice.
        </p>
      </div>
    </main>
  );
}
