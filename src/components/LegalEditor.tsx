"use client";

/**
 * The legal-pages editor (Site Editor → Legal pages).
 *
 * Saving a policy is not the same kind of edit as changing a hero title: it
 * changes what every visitor is agreeing to, and it retires the version that
 * existing customers accepted. So this screen is deliberately slower than the
 * rest of the Site Editor:
 *
 *   • The next version is shown before it is published, with how many people
 *     accepted the last one, so "this affects 43 customers" is visible.
 *   • Text is saved by its own button — it is part of the Site Editor form, but
 *     the documents are not sent with a hero-title edit.
 *   • "Restore shipped text" is a one-click undo: a blank box means the default
 *     is published, so undo never depends on having kept a copy.
 *   • The placeholders list is live; `{{contact}}` means nothing if the contact
 *     address is blank, and the panel says so right there.
 */

import { useCallback, useEffect, useState } from "react";

interface LegalEditorProps {
  /** Saves the rest of the Site Editor form (hero, nav, CSS…). */
  saving: boolean;
  onNotify: (message: string) => void;
}

interface LegalResponse {
  documents: {
    terms: { text: string; isDefault: boolean };
    privacy: { text: string; isDefault: boolean };
  };
  profile: { operatorName: string; contactEmail: string; jurisdiction: string };
  defaults: { terms: string; privacy: string };
  version: { version: string; date: string };
  placeholders: Array<{ key: string; value: string }>;
  acceptanceCounts: Array<{ version: string; count: number; lastAt: string }>;
  error?: string;
}

type DocId = "terms" | "privacy";

const TABS: Array<{ id: DocId; label: string; path: string }> = [
  { id: "terms", label: "Terms of Service", path: "/terms" },
  { id: "privacy", label: "Privacy Policy", path: "/privacy" },
];

const inputClass =
  "w-full px-3 sm:px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent";

export default function LegalEditor({ saving, onNotify }: LegalEditorProps) {
  const [loaded, setLoaded] = useState<LegalResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [activeDoc, setActiveDoc] = useState<DocId>("terms");
  const [terms, setTerms] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const apply = useCallback((data: LegalResponse) => {
    setLoaded(data);
    setTerms(data.documents.terms.text);
    setPrivacy(data.documents.privacy.text);
    setOperatorName(data.profile.operatorName);
    setContactEmail(data.profile.contactEmail);
    setJurisdiction(data.profile.jurisdiction);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/legal", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as LegalResponse | null;
      if (!res.ok || !data?.documents) {
        setLoadError(data?.error || `Could not load the legal pages (HTTP ${res.status}).`);
        return;
      }
      apply(data);
    } catch {
      setLoadError("Could not load the legal pages — the panel may be restarting.");
    }
  }, [apply]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const touch = () => setDirty(true);

  const currentText = activeDoc === "terms" ? terms : privacy;
  const defaultText = loaded?.defaults[activeDoc] ?? "";
  const isDefault = currentText.trim() === "";

  async function saveDocuments() {
    if (saveState === "saving") return;
    setSaveState("saving");
    setSaveError("");
    setFieldErrors({});
    try {
      const res = await fetch("/api/legal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms, privacy, operatorName, contactEmail, jurisdiction }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFieldErrors(data?.errors ?? {});
        setSaveError(data?.error || "Could not save the legal pages.");
        return;
      }
      // Reload rather than trusting local state: the server decides the new
      // version fingerprint, and the acceptance counts change with it.
      await load();
      onNotify("Legal pages saved — the published version has changed.");
    } catch {
      setSaveError("Network error — the pages were not saved.");
    } finally {
      setSaveState("idle");
    }
  }

  if (loadError) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 sm:p-6 space-y-3">
        <p className="text-sm font-medium text-danger">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-4 py-2 bg-bg-secondary border border-border rounded-lg text-sm hover:border-accent/30"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-6 space-y-3">
        <div className="h-5 w-48 rounded bg-bg-secondary animate-pulse" />
        <div className="h-32 rounded bg-bg-secondary animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">📜 Legal pages</h3>
          <p className="text-xs text-text-muted mt-1 max-w-xl">
            The Terms of Service and Privacy Policy published at{" "}
            {TABS.map((tab, index) => (
              <span key={tab.id}>
                {index > 0 && " and "}
                <a href={tab.path} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {tab.path}
                </a>
              </span>
            ))}
            . Leave a document empty to publish the version supplied with the software.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-text-muted">Published</p>
          <p className="text-xs font-mono text-text-secondary">v{loaded.version.version}</p>
          <p className="text-[10px] text-text-muted">{loaded.version.date}</p>
        </div>
      </div>

      {/* ── Operator details ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1" htmlFor="legal-operator">
            Operator name
          </label>
          <input
            id="legal-operator"
            value={operatorName}
            onChange={(e) => { setOperatorName(e.target.value); touch(); }}
            placeholder={loaded.placeholders.find((p) => p.key === "panel")?.value || "Your business"}
            className={inputClass}
          />
          <p className="text-[10px] text-text-muted mt-1">The company or person the documents speak for.</p>
          {fieldErrors.legal_operator_name && (
            <p className="text-[10px] text-danger mt-1">{fieldErrors.legal_operator_name}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1" htmlFor="legal-contact">
            Contact email
          </label>
          <input
            id="legal-contact"
            type="email"
            value={contactEmail}
            onChange={(e) => { setContactEmail(e.target.value); touch(); }}
            placeholder="support@example.com"
            className={inputClass}
          />
          <p className={`text-[10px] mt-1 ${contactEmail.trim() ? "text-text-muted" : "text-warning"}`}>
            {contactEmail.trim()
              ? "Used for support, privacy requests and complaints."
              : "Empty — the published pages will say “contact address not configured”."}
          </p>
          {fieldErrors.legal_contact_email && (
            <p className="text-[10px] text-danger mt-1">{fieldErrors.legal_contact_email}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1" htmlFor="legal-jurisdiction">
            Governing law
          </label>
          <input
            id="legal-jurisdiction"
            value={jurisdiction}
            onChange={(e) => { setJurisdiction(e.target.value); touch(); }}
            placeholder="Queensland, Australia"
            className={inputClass}
          />
          <p className="text-[10px] text-text-muted mt-1">Used in the disputes section of the terms.</p>
          {fieldErrors.legal_jurisdiction && (
            <p className="text-[10px] text-danger mt-1">{fieldErrors.legal_jurisdiction}</p>
          )}
        </div>
      </div>

      {/* ── Document tabs ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((tab) => {
          const text = tab.id === "terms" ? terms : privacy;
          const usingDefault = text.trim() === "";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveDoc(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeDoc === tab.id
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-bg-secondary border-border text-text-secondary hover:border-accent/30"
              }`}
              aria-pressed={activeDoc === tab.id}
            >
              {tab.label}
              {usingDefault && <span className="ml-1.5 text-[10px] text-text-muted">default</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-muted">
          {isDefault
            ? "This document is empty — the shipped text below is what visitors see."
            : `${currentText.length.toLocaleString("en-US")} characters`}
        </span>
        <span className="text-text-muted">·</span>
        <button
          type="button"
          onClick={() => {
            const target = activeDoc;
            if (target === "terms") setTerms(defaultText);
            else setPrivacy(defaultText);
            touch();
          }}
          className="text-accent hover:underline"
        >
          Load shipped text into the editor
        </button>
        <button
          type="button"
          onClick={() => {
            if (activeDoc === "terms") setTerms("");
            else setPrivacy("");
            touch();
          }}
          disabled={isDefault}
          className="text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          Restore shipped default on save
        </button>
        <button
          type="button"
          onClick={() => window.open(activeDoc === "terms" ? "/terms" : "/privacy", "_blank")}
          className="text-text-secondary hover:text-text-primary"
        >
          View published page ↗
        </button>
      </div>

      <textarea
        value={currentText}
        onChange={(e) => {
          if (activeDoc === "terms") setTerms(e.target.value);
          else setPrivacy(e.target.value);
          touch();
        }}
        rows={16}
        spellCheck
        aria-label={`${activeDoc === "terms" ? "Terms of Service" : "Privacy Policy"} text`}
        placeholder={defaultText}
        className="w-full px-3 sm:px-4 py-3 bg-bg-secondary border border-border rounded-lg text-xs sm:text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <details className="bg-bg-secondary/60 border border-border rounded-lg p-3">
        <summary className="text-xs font-medium cursor-pointer">
          Formatting &amp; placeholders
        </summary>
        <div className="mt-3 space-y-2 text-xs text-text-secondary">
          <p>
            <code className="text-accent"># Title</code>,{" "}
            <code className="text-accent">## Section</code>,{" "}
            <code className="text-accent">- bullet</code>,{" "}
            <code className="text-accent">1. numbered</code>,{" "}
            <code className="text-accent">**bold**</code>,{" "}
            <code className="text-accent">[label](https://…)</code>. Blank lines separate
            paragraphs. Raw HTML is shown, not interpreted.
          </p>
          <p className="text-text-muted">These are filled in when the page renders:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {loaded.placeholders.map((placeholder) => (
              <div key={placeholder.key} className="flex items-baseline gap-2">
                <code className="text-accent font-mono">{`{{${placeholder.key}}}`}</code>
                <span className="text-text-muted truncate">
                  {placeholder.value || <em>not set</em>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </details>

      {/* ── Acceptance history ───────────────────────────────────────────── */}
      <div className="border border-border rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium">Acceptances</p>
        {loaded.acceptanceCounts.length === 0 ? (
          <p className="text-xs text-text-muted">
            Nobody has accepted a published version yet. Registration and store checkout record the
            version each person agreed to.
          </p>
        ) : (
          <ul className="space-y-1">
            {loaded.acceptanceCounts.map((row) => (
              <li key={row.version} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-mono text-text-secondary">v{row.version}</span>
                <span className="text-text-muted">
                  {row.count} acceptance{row.count === 1 ? "" : "s"} · last{" "}
                  {new Date(row.lastAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-text-muted">
          Saving changes publishes a new version. People who accepted an older one keep that record —
          nothing is rewritten.
        </p>
      </div>

      {saveError && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          {saveError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void saveDocuments()}
          disabled={saveState === "saving" || saving || !dirty}
          className="px-6 py-2.5 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving…" : "📜 Save legal pages"}
        </button>
        <p className="text-xs text-text-muted">
          {dirty
            ? "Unsaved changes to the documents or operator details."
            : "Saved by its own button — the Save Changes button above does not publish these."}
        </p>
      </div>
    </div>
  );
}
