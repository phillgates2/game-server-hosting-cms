import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, settings } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { clientIpForRecord } from "@/lib/ip-allowlist";
import {
  CONTACT_EMAIL_KEY,
  JURISDICTION_KEY,
  LEGAL_PROFILE_KEYS,
  LEGAL_TEXT_KEYS,
  OPERATOR_NAME_KEY,
  PRIVACY_TEXT_KEY,
  TERMS_TEXT_KEY,
  isValidLegalContact,
  normaliseLegalText,
} from "@/lib/legal";
import { DEFAULT_LEGAL_TEXTS } from "@/lib/legal-documents";
import { buildLegalDocuments, loadLegalDocuments } from "@/lib/legal-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Legal pages for the admin editor.
 *
 * GET  — the stored text, the operator profile, the shipped defaults and the
 *        version currently published. The editor needs all four: the text to
 *        edit, the placeholders to preview with, the defaults to restore, and
 *        the version so it can warn that saving publishes a new one.
 * POST — save. Blank text restores the shipped default (a real "undo"), and
 *        every save bumps the version, which is what makes previously recorded
 *        acceptances identifiable as "the old terms".
 *
 * Separate from `/api/site-settings` on purpose: that endpoint is a generic
 * key/value upsert for appearance, and the documents need real validation
 * (length, control characters, a legal contact address) plus an audit trail.
 */

const READ_KEYS = [...LEGAL_TEXT_KEYS, ...LEGAL_PROFILE_KEYS];

async function requireEditor(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (!(await hasPermission(auth.userId, "panel.settings", auth.keyScope))) {
    return { error: NextResponse.json({ error: "Permission denied" }, { status: 403 }) } as const;
  }
  return { auth } as const;
}

export async function GET(req: NextRequest) {
  const gate = await requireEditor(req);
  if ("error" in gate) return gate.error;

  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value, updatedAt: settings.updatedAt })
      .from(settings)
      .where(inArray(settings.key, READ_KEYS));

    const values: Record<string, string> = {};
    let updatedAt: Date | null = null;
    for (const row of rows) {
      values[row.key] = row.value ?? "";
      if (LEGAL_TEXT_KEYS.includes(row.key as (typeof LEGAL_TEXT_KEYS)[number])) {
        if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
      }
    }

    const published = buildLegalDocuments({ values, updatedAt });

    // History is the operator's own audit trail for the documents: how many
    // people accepted each published version. The table is created on demand
    // (first acceptance), so a deployment that has never captured consent has
    // no table at all — and that is a normal answer, not an error.
    let acceptanceCounts: Array<{ version: string; count: number; lastAt: string }> = [];
    try {
      const { sql } = await import("drizzle-orm");
      const history = await db.execute(sql`
        SELECT version, COUNT(*)::int AS count, MAX(accepted_at) AS last_at
        FROM legal_acceptances
        GROUP BY version
        ORDER BY MAX(accepted_at) DESC
        LIMIT 50
      `);
      acceptanceCounts = (history.rows as Array<{
        version: string;
        count: number;
        last_at: string | Date;
      }>).map((row) => ({
        version: row.version,
        count: Number(row.count),
        lastAt: new Date(row.last_at).toISOString(),
      }));
    } catch {
      acceptanceCounts = [];
    }

    return NextResponse.json({
      documents: {
        terms: { text: published.documents.terms.text, isDefault: published.documents.terms.isDefault },
        privacy: { text: published.documents.privacy.text, isDefault: published.documents.privacy.isDefault },
      },
      profile: {
        operatorName: values[OPERATOR_NAME_KEY] ?? "",
        contactEmail: values[CONTACT_EMAIL_KEY] ?? "",
        jurisdiction: values[JURISDICTION_KEY] ?? "",
      },
      defaults: {
        terms: DEFAULT_LEGAL_TEXTS.terms,
        privacy: DEFAULT_LEGAL_TEXTS.privacy,
      },
      version: published.version,
      /** Placeholders an operator may use, with the value each resolves to. */
      placeholders: [
        { key: "panel", value: published.profile.panelName },
        { key: "operator", value: published.profile.operatorName || published.profile.panelName },
        { key: "contact", value: published.profile.contactEmail },
        { key: "jurisdiction", value: published.profile.jurisdiction },
        { key: "updated", value: published.profile.updated },
        { key: "year", value: String(new Date().getUTCFullYear()) },
      ],
      acceptanceCounts,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load the legal pages", 500);
  }
}

function asText(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return "";
  return value;
}

export async function POST(req: NextRequest) {
  const gate = await requireEditor(req);
  if ("error" in gate) return gate.error;

  // CSRF is enforced globally in src/proxy.ts for every state-changing /api
  // request, so this route does not repeat the check.

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  // ── Validate everything before writing anything ───────────────────────────
  const updates: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const [id, key] of [
    ["terms", TERMS_TEXT_KEY],
    ["privacy", PRIVACY_TEXT_KEY],
  ] as const) {
    const raw = asText(input[id]);
    if (raw === null) continue;
    const check = normaliseLegalText(raw);
    if (!check.ok) errors[key] = check.error ?? "Invalid text";
    else updates[key] = check.value;
  }

  const operatorName = asText(input.operatorName);
  if (operatorName !== null) {
    const trimmed = operatorName.trim();
    if (trimmed.length > 200) errors[OPERATOR_NAME_KEY] = "Keep the operator name under 200 characters";
    else updates[OPERATOR_NAME_KEY] = trimmed;
  }

  const contactEmail = asText(input.contactEmail);
  if (contactEmail !== null) {
    const trimmed = contactEmail.trim();
    if (!isValidLegalContact(trimmed)) {
      errors[CONTACT_EMAIL_KEY] = "Enter a valid email address, or leave it empty";
    } else {
      updates[CONTACT_EMAIL_KEY] = trimmed;
    }
  }

  const jurisdiction = asText(input.jurisdiction);
  if (jurisdiction !== null) {
    const trimmed = jurisdiction.trim();
    if (trimmed.length > 120) errors[JURISDICTION_KEY] = "Keep the jurisdiction under 120 characters";
    else updates[JURISDICTION_KEY] = trimmed;
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Some fields need fixing", errors }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      const [existing] = await db
        .select({ id: settings.id })
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      if (existing) {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value });
      }
    }

    // The version now published — changed documents get a new fingerprint,
    // which is precisely what a reader's acceptance will be checked against.
    const published = await loadLegalDocuments();

    await db
      .insert(auditLog)
      .values({
        userId: gate.auth.userId,
        action: "legal.update",
        entityType: "settings",
        details: {
          keys: Object.keys(updates),
          // Only the ids, never the bodies: an audit row is not a document
          // store, and a policy can be 80 KB.
          documents: Object.keys(updates).filter((key) =>
            (LEGAL_TEXT_KEYS as readonly string[]).includes(key)
          ),
          version: published.version.version,
        },
        ipAddress: clientIpForRecord(req.headers),
      })
      .catch(() => {
        // An unwritable audit log must not cost the operator their edit.
      });

    return NextResponse.json({
      ok: true,
      version: published.version,
      documents: {
        terms: {
          isDefault: published.documents.terms.isDefault,
          characters: published.documents.terms.rendered.length,
        },
        privacy: {
          isDefault: published.documents.privacy.isDefault,
          characters: published.documents.privacy.rendered.length,
        },
      },
    });
  } catch (e: unknown) {
    return apiError(e, "Could not save the legal pages", 500);
  }
}
