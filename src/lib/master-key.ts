/**
 * The UNIFIED master key: one secret, three powers —
 *
 *   1. PANEL LOGIN   — opens the CD-key access gate (joins the env-based
 *      GSM_PANEL_MASTER_KEY; this adds a UI-managed key stored hash-only).
 *   2. LICENSE BYPASS — accepted as a valid license key everywhere (install,
 *      validation, public check) with unlimited activations.
 *   3. SHOP ADMIN   — sent as X-Master-Key, it authorizes the license desk
 *      and shop admin APIs without a login session (scriptable operations).
 *
 * Storage is hash-only (sha256) in settings.panel_master_key_hash; the
 * plaintext exists exactly once, in the generate response.
 */

import { timingSafeEqual } from "node:crypto";

export const MASTER_KEY_SETTING = "panel_master_key_hash";
export const MASTER_KEY_HEADER = "x-master-key";
export const MASTER_KEY_PREFIX = "GSMM";
/** System identity used when a request authenticates via master key. */
export const MASTER_KEY_USER_ID = 0;

/** Generate a fresh master key: GSMM-<48 hex>. */
export async function generateMasterKey(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return `${MASTER_KEY_PREFIX}-${randomBytes(24).toString("hex")}`;
}

export async function hashMasterKey(key: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Plausible shape check (used before hashing work is spent). */
export function looksLikeMasterKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 16;
}

/** Is a master key currently configured (env or stored)? */
export async function masterKeyConfigured(): Promise<{ env: boolean; stored: boolean }> {
  const env = (process.env.GSM_PANEL_MASTER_KEY ?? "").trim().length >= 16;
  let stored = false;
  try {
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, MASTER_KEY_SETTING)).limit(1);
    stored = !!row?.value;
  } catch { /* no settings yet */ }
  return { env, stored };
}

/**
 * Verify a presented master key against BOTH sources: the env escape hatch
 * (exact match, existing semantics) and the stored hash.
 */
/** Constant-time compare so neither branch leaks the match length through timing. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function verifyMasterKey(presented: unknown): Promise<boolean> {
  if (!looksLikeMasterKey(presented)) return false;
  const key = (presented as string).trim();

  // Both branches compare with the same helper: a plain `===` on the env key
  // would let the comparison timing differ from the hash branch's.
  const env = process.env.GSM_PANEL_MASTER_KEY;
  if (env && env.length >= 16 && constantTimeEqual(key, env.trim())) return true;

  try {
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, MASTER_KEY_SETTING)).limit(1);
    if (!row?.value) return false;
    return constantTimeEqual(await hashMasterKey(key), row.value);
  } catch {
    return false;
  }
}

export interface MasterBootstrapPlan {
  generateMasterKey: boolean;
  createSigningKey: boolean;
  seedStarterProduct: boolean;
}

/**
 * Pure first-run plan for a fresh master install: generate the master key
 * only when no key exists anywhere, and seed signing key + starter product
 * only when they are missing. Re-runs never duplicate anything.
 */
export function planMasterBootstrap(input: {
  envMasterKey: boolean;
  storedMasterKey: boolean;
  signingKeyPresent: boolean;
  productCount: number;
}): MasterBootstrapPlan {
  return {
    generateMasterKey: !input.envMasterKey && !input.storedMasterKey,
    createSigningKey: !input.signingKeyPresent,
    seedStarterProduct: input.productCount <= 0,
  };
}

/** Extract the master key from a request header (shop/license admin APIs). */
export function masterKeyFromRequest(req: { headers: { get(name: string): string | null } }): string | null {
  const raw = req.headers.get(MASTER_KEY_HEADER);
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * Unified admin authorization: master key OR session+permission.
 * Master-key callers get the synthetic system identity (userId 0).
 */
export async function authorizeMasterOrSession(
  req: { headers: Headers },
  permission: string
): Promise<{ auth: { userId: number; role: string } | null; res: import("next/server").NextResponse | null }> {
  const { NextResponse } = await import("next/server");

  const presented = masterKeyFromRequest(req);
  if (presented && (await verifyMasterKey(presented))) {
    return { auth: { userId: MASTER_KEY_USER_ID, role: "admin" }, res: null };
  }

  const { getCurrentUser } = await import("./auth");
  const { hasPermission } = await import("./permissions");
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { auth: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await hasPermission(auth.userId, permission, auth.keyScope))) {
    return { auth: null, res: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
  }
  return { auth: { userId: auth.userId as number, role: auth.role }, res: null };
}
