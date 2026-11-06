/**
 * Terms of Service / Privacy Policy: the parts that must not be wrong.
 *
 * A legal page has one job that is easy to get subtly wrong — stating what a
 * person agreed to — so these tests pin the decisions rather than the prose:
 *
 *   • the parser renders the shipped documents into the blocks the page needs,
 *     and treats pasted HTML as text (no XSS on a page everyone loads);
 *   • `{{placeholders}}` resolve from settings, and an unset contact address is
 *     visible rather than silently blank;
 *   • a version changes when the words change and not when they do not;
 *   • a stale acceptance is refused, but a panel that cannot resolve a version
 *     does not refuse every signup and every sale.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JURISDICTION,
  LEGAL_DOCUMENTS,
  MAX_LEGAL_TEXT_LENGTH,
  MISSING_CONTACT_TEXT,
  checkLegalAcceptance,
  isSafeLegalHref,
  isValidLegalContact,
  legalDocument,
  legalPlaceholders,
  legalVersion,
  normaliseAcceptedDocuments,
  normaliseLegalText,
  parseLegalDocument,
  parseLegalInline,
  renderLegalText,
} from "../src/lib/legal";
import { DEFAULT_LEGAL_TEXTS } from "../src/lib/legal-documents";
import { buildLegalDocuments, formatLegalDate } from "../src/lib/legal-view";

const PROFILE = {
  panelName: "Example Hosting",
  operatorName: "Example Hosting Pty Ltd",
  contactEmail: "support@example.com",
  jurisdiction: "Queensland, Australia",
  updated: "7 November 2026",
};

describe("shipped documents", () => {
  test("both documents exist on their own path with a title", () => {
    assert.equal(LEGAL_DOCUMENTS.length, 2);
    assert.equal(legalDocument("terms").path, "/terms");
    assert.equal(legalDocument("privacy").path, "/privacy");
    assert.equal(legalDocument("terms").title, "Terms of Service");
    assert.equal(legalDocument("privacy").title, "Privacy Policy");
  });

  test("the default text parses into headings, paragraphs and lists", () => {
    for (const [id, text] of Object.entries(DEFAULT_LEGAL_TEXTS)) {
      const blocks = parseLegalDocument(text);
      assert.ok(blocks.some((b) => b.kind === "title"), `${id}: missing title block`);
      assert.ok(blocks.some((b) => b.kind === "heading"), `${id}: missing section headings`);
      assert.ok(blocks.some((b) => b.kind === "paragraph"), `${id}: missing paragraphs`);
      assert.ok(blocks.some((b) => b.kind === "bullets"), `${id}: missing bullet lists`);
      // Nothing may render as an empty paragraph: they are pure whitespace on
      // the page and a sign the parser mishandled a blank line.
      for (const block of blocks) {
        if (block.kind === "paragraph") {
          assert.ok(block.inlines.some((inline) => inline.text.trim().length > 0), `${id}: empty paragraph`);
        }
      }
    }
  });

  test("every placeholder used by the shipped text is a known one", () => {
    const placeholders = legalPlaceholders(PROFILE);
    const known = new Set(Object.keys(placeholders));
    for (const [id, text] of Object.entries(DEFAULT_LEGAL_TEXTS)) {
      for (const match of text.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
        assert.ok(known.has(match[1].toLowerCase()), `${id}: unknown placeholder ${match[0]}`);
      }
    }
  });

  test("the terms keep the consumer-law floor and the privacy policy names its third parties", () => {
    // These are the clauses an operator is most tempted to delete while
    // tightening a template, and the ones whose absence would mislead a buyer.
    assert.match(DEFAULT_LEGAL_TEXTS.terms, /Australian Consumer Law/);
    assert.match(DEFAULT_LEGAL_TEXTS.terms, /No uptime guarantee/);
    assert.match(DEFAULT_LEGAL_TEXTS.terms, /at least 16/);
    assert.match(DEFAULT_LEGAL_TEXTS.privacy, /Stripe/);
    assert.match(DEFAULT_LEGAL_TEXTS.privacy, /Discord/);
    assert.match(DEFAULT_LEGAL_TEXTS.privacy, /bcrypt/);
    assert.match(DEFAULT_LEGAL_TEXTS.privacy, /gsm_token/);
  });

  test("the shipped text fits the storage cap", () => {
    for (const text of Object.values(DEFAULT_LEGAL_TEXTS)) {
      assert.ok(text.length < MAX_LEGAL_TEXT_LENGTH / 2, "defaults should leave room to edit");
    }
  });
});

describe("inline parsing", () => {
  test("splits bold and links, keeping surrounding text", () => {
    const nodes = parseLegalInline("Read **this** and [that](https://example.com).");
    assert.deepEqual(nodes, [
      { kind: "text", text: "Read " },
      { kind: "bold", text: "this" },
      { kind: "text", text: " and " },
      { kind: "link", text: "that", href: "https://example.com" },
      { kind: "text", text: "." },
    ]);
  });

  test("markdown inside the default documents renders as data, never as HTML", () => {
    const nodes = parseLegalInline('<script>alert("x")</script> **bold**');
    assert.ok(nodes.every((node) => node.kind !== "link"));
    // Text *and* bold nodes are plain strings; only a link node would prove
    // something was interpreted.
    const text = nodes
      .filter((node) => node.kind === "text" || node.kind === "bold")
      .map((node) => node.text)
      .join("");
    // The characters survive; they are simply never interpreted. React escapes
    // them, and no path here produces raw HTML.
    assert.equal(text, '<script>alert("x")</script> bold');
    assert.ok(nodes.some((node) => node.kind === "bold" && node.text === "bold"));
  });

  test("a bad href is emitted as literal text instead of a link", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.example", " http://a b"]) {
      const nodes = parseLegalInline(`[click](${href})`);
      assert.ok(nodes.every((node) => node.kind !== "link"), `${href} must not become a link`);
      assert.match(nodes.map((node) => ("text" in node ? node.text : "")).join(""), /\[click\]/);
    }
  });

  test("an unclosed emphasis marker is left alone", () => {
    const nodes = parseLegalInline("**unclosed");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "text");
  });

  test("isSafeLegalHref accepts only what a policy links to", () => {
    assert.equal(isSafeLegalHref("https://oaic.gov.au"), true);
    assert.equal(isSafeLegalHref("mailto:a@b.example"), true);
    assert.equal(isSafeLegalHref("/privacy"), true);
    assert.equal(isSafeLegalHref("#section-3"), true);
    assert.equal(isSafeLegalHref("javascript:alert(1)"), false);
    assert.equal(isSafeLegalHref("//evil.example"), false);
    assert.equal(isSafeLegalHref(""), false);
  });
});

describe("document blocks", () => {
  test("separates titles, headings, lists and paragraphs", () => {
    const blocks = parseLegalDocument(
      ["# Title", "", "Intro line.", "", "## Section", "- one", "- two", "", "1. first", "2. second"].join("\n")
    );
    assert.deepEqual(blocks.map((b) => b.kind), [
      "title",
      "paragraph",
      "heading",
      "bullets",
      "ordered",
    ]);
    const bullets = blocks.find((b) => b.kind === "bullets");
    assert.equal(bullets && bullets.kind === "bullets" ? bullets.items.length : 0, 2);
  });

  test("a wrapped list item continues instead of becoming a paragraph", () => {
    const blocks = parseLegalDocument("- a long\n  continued line\n- second");
    assert.equal(blocks.length, 1);
    const list = blocks[0];
    assert.equal(list.kind, "bullets");
    if (list.kind === "bullets") {
      assert.equal(list.items.length, 2);
      assert.match(list.items[0].map((i) => ("text" in i ? i.text : "")).join(""), /long continued line/);
    }
  });

  test("CRLF input parses the same as LF", () => {
    const lf = parseLegalDocument("## A\n\ntext");
    const crlf = parseLegalDocument("## A\r\n\r\ntext");
    assert.deepEqual(lf, crlf);
  });

  test("empty input is an empty document, not a crash", () => {
    assert.deepEqual(parseLegalDocument(""), []);
    assert.deepEqual(parseLegalDocument("   \n\n\t"), []);
  });
});

describe("placeholders", () => {
  test("fills the profile values and tolerates spaced braces", () => {
    const values = legalPlaceholders(PROFILE);
    assert.equal(values.panel, "Example Hosting");
    assert.equal(values.operator, "Example Hosting Pty Ltd");
    assert.equal(values.contact, "support@example.com");
    assert.equal(
      renderLegalText("{{panel}} / {{ operator }} / {{contact}}", values),
      "Example Hosting / Example Hosting Pty Ltd / support@example.com"
    );
  });

  test("falls back to the panel name when no operator is set", () => {
    const values = legalPlaceholders({ ...PROFILE, operatorName: "  " });
    assert.equal(values.operator, "Example Hosting");
  });

  test("an unset contact address is visible, not blank", () => {
    const values = legalPlaceholders({ ...PROFILE, contactEmail: "" });
    assert.equal(values.contact, MISSING_CONTACT_TEXT);
    assert.equal(values.contact_link, MISSING_CONTACT_TEXT);
    assert.equal(renderLegalText("Write to {{contact}}.", values), `Write to ${MISSING_CONTACT_TEXT}.`);
  });

  test("a configured contact becomes a mailto link", () => {
    const values = legalPlaceholders(PROFILE);
    assert.equal(values.contact_link, "[support@example.com](mailto:support@example.com)");
  });

  test("an unknown token is left visible so the typo can be found", () => {
    const values = legalPlaceholders(PROFILE);
    assert.equal(renderLegalText("Hello {{nmae}}", values), "Hello {{nmae}}");
  });

  test("an unset jurisdiction still names a governing law", () => {
    const values = legalPlaceholders({ ...PROFILE, jurisdiction: "" });
    assert.equal(values.jurisdiction, DEFAULT_JURISDICTION);
  });
});

describe("versioning", () => {
  test("changes when the words change", () => {
    assert.notEqual(legalVersion("a", "b"), legalVersion("a", "c"));
    assert.notEqual(legalVersion("a", "b"), legalVersion("b", "a"));
  });

  test("is stable for identical text", () => {
    assert.equal(legalVersion("same", "text"), legalVersion("same", "text"));
    assert.equal(legalVersion("").length, 16);
  });

  test("a re-save of unchanged documents keeps the same version", () => {
    const input = (values: Record<string, string>) =>
      buildLegalDocuments({ values, updatedAt: null, now: new Date("2026-11-07T00:00:00Z") });
    const a = input({});
    const b = input({ legal_terms_text: "", legal_privacy_text: "" });
    assert.equal(a.version.version, b.version.version);
  });

  test("editing one document publishes a different version", () => {
    const base = buildLegalDocuments({ values: {} });
    const edited = buildLegalDocuments({ values: { legal_terms_text: "# Different terms" } });
    assert.notEqual(base.version.version, edited.version.version);
    assert.match(edited.version.version, /^\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/);
  });

  test("an untouched document is dated by the text, not by today", () => {
    // Otherwise every policy would re-version at midnight and invalidate every
    // acceptance captured the day before, without a word changing.
    const midnight = buildLegalDocuments({ values: {}, now: new Date("2027-03-04T00:00:00Z") });
    const later = buildLegalDocuments({ values: {}, now: new Date("2029-08-09T00:00:00Z") });
    assert.equal(midnight.version.version, later.version.version);
    assert.match(midnight.version.date, /2026/);
  });

  test("a saved document is dated by when it was saved", () => {
    const saved = buildLegalDocuments({
      values: { legal_terms_text: "# Mine" },
      updatedAt: new Date("2027-03-04T10:00:00Z"),
    });
    assert.equal(saved.version.date, "4 March 2027");
    assert.match(saved.version.version, /^2027-03-04-/);
  });

  test("formatLegalDate is stable regardless of server locale", () => {
    assert.equal(formatLegalDate(new Date("2026-11-07T23:30:00Z")), "7 November 2026");
  });
});

describe("stored values", () => {
  test("normalises line endings and trims", () => {
    const result = normaliseLegalText("  # Title\r\n\r\nBody  ");
    assert.equal(result.ok, true);
    assert.equal(result.value, "# Title\n\nBody");
  });

  test("blank means 'use the shipped default'", () => {
    assert.equal(normaliseLegalText("   ").value, "");
    assert.equal(normaliseLegalText(null).value, "");
  });

  test("strips control characters that would be invisible in the editor", () => {
    assert.equal(normaliseLegalText("a\u0000b\u0007c").value, "abc");
    assert.equal(normaliseLegalText("keep\ttabs\nand lines").value, "keep\ttabs\nand lines");
  });

  test("refuses an oversized document", () => {
    const result = normaliseLegalText("x".repeat(MAX_LEGAL_TEXT_LENGTH + 1));
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /limited to/);
  });

  test("contact addresses: empty is allowed, rubbish is not", () => {
    assert.equal(isValidLegalContact(""), true);
    assert.equal(isValidLegalContact("support@example.com"), true);
    assert.equal(isValidLegalContact("not-an-email"), false);
    assert.equal(isValidLegalContact("a@b"), false);
    assert.equal(isValidLegalContact("a b@example.com"), false);
    assert.equal(isValidLegalContact(`${"x".repeat(250)}@example.com`), false);
  });
});

describe("buildLegalDocuments", () => {
  const build = (values: Record<string, string>, updatedAt: Date | null = null) =>
    buildLegalDocuments({ values, updatedAt, now: new Date("2026-11-07T00:00:00Z") });

  test("a fresh install publishes the shipped text and says so", () => {
    const legal = build({});
    assert.equal(legal.documents.terms.isDefault, true);
    assert.equal(legal.documents.privacy.isDefault, true);
    assert.equal(legal.documents.terms.rendered.includes("{{"), false);
    assert.match(legal.documents.terms.rendered, /Terms of Service/);
  });

  test("stored text wins and is marked as edited", () => {
    const legal = build({ legal_terms_text: "# My terms\n\nNothing refundable." });
    assert.equal(legal.documents.terms.isDefault, false);
    assert.match(legal.documents.terms.rendered, /Nothing refundable/);
    assert.equal(legal.documents.privacy.isDefault, true, "the other document is unaffected");
  });

  test("clearing a document restores the shipped text rather than publishing a blank page", () => {
    const legal = build({ legal_terms_text: "   " });
    assert.equal(legal.documents.terms.isDefault, true);
    assert.ok(legal.documents.terms.blocks.length > 0);
  });

  test("uses panel_name for the site and the operator fallback", () => {
    const legal = build({ panel_name: "Brisbane Servers" });
    assert.equal(legal.profile.panelName, "Brisbane Servers");
    assert.match(legal.documents.terms.rendered, /Brisbane Servers/);
    assert.doesNotMatch(legal.documents.terms.rendered, /\{\{operator\}\}/);
  });

  test("the placeholder warnings reach the reader when nothing is configured", () => {
    const legal = build({});
    assert.match(legal.documents.privacy.rendered, /contact address not configured/);
  });

  test("an edited document keeps its resolved placeholders", () => {
    const legal = build({
      legal_terms_text: "# Short\n\nWritten by {{operator}} — {{contact_link}}.",
      legal_operator_name: "Northside Gaming",
      legal_contact_email: "help@northside.example",
    });
    assert.match(legal.documents.terms.rendered, /Written by Northside Gaming/);
    assert.match(legal.documents.terms.rendered, /\[help@northside\.example\]\(mailto:help@northside\.example\)/);
  });
});

describe("acceptance gate", () => {
  test("an unticked box is refused with its own reason", () => {
    const result = checkLegalAcceptance({ accepted: false, shownVersion: "v1", currentVersion: "v1" });
    assert.equal(result.ok, false);
    assert.equal(result.failure, "not-accepted");
  });

  test("a missing or non-boolean acceptance is never treated as consent", () => {
    for (const accepted of [undefined, null, "true", 1, "yes"]) {
      assert.equal(
        checkLegalAcceptance({ accepted, shownVersion: "v1", currentVersion: "v1" }).ok,
        false,
        `${String(accepted)} must not count as consent`
      );
    }
  });

  test("a version that changed under the form is refused as stale, not as 'not accepted'", () => {
    const result = checkLegalAcceptance({ accepted: true, shownVersion: "v1", currentVersion: "v2" });
    assert.equal(result.ok, false);
    assert.equal(result.failure, "stale");
    assert.match(result.error ?? "", /changed/i);
  });

  test("a missing version is refused rather than assumed current", () => {
    for (const shownVersion of [undefined, null, "", "  ", 42]) {
      const result = checkLegalAcceptance({ accepted: true, shownVersion, currentVersion: "v1" });
      assert.equal(result.ok, false);
      assert.equal(result.failure, "bad-version");
    }
  });

  test("the exact current version is accepted, whitespace tolerated", () => {
    assert.equal(checkLegalAcceptance({ accepted: true, shownVersion: "2026-11-07-abc", currentVersion: "2026-11-07-abc" }).ok, true);
    assert.equal(checkLegalAcceptance({ accepted: true, shownVersion: " 2026-11-07-abc ", currentVersion: "2026-11-07-abc" }).ok, true);
  });

  test("document ids normalise to a stable, deduplicated pair", () => {
    assert.deepEqual(normaliseAcceptedDocuments("both"), ["terms", "privacy"]);
    assert.deepEqual(normaliseAcceptedDocuments(["privacy", "terms", "terms"]), ["terms", "privacy"]);
    assert.deepEqual(normaliseAcceptedDocuments("terms"), ["terms"]);
    assert.deepEqual(normaliseAcceptedDocuments(undefined), []);
    assert.deepEqual(normaliseAcceptedDocuments(["admin", 42]), []);
  });
});
