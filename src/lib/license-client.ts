/**
 * License CLIENT: what a normal (non-master) installation checks before it
 * may install. Enforcement points: install.sh (shell, before anything is
 * laid down) and POST /api/install (web wizard, before the admin account
 * exists). Both fail CLOSED: no license server configured or unreachable
 * means no install.
 *
 * The master panel itself (the key desk) runs with GSM_LICENSE_MODE=master
 * and is exempt — that flag is only for the instance issuing the keys.
 */

export const LICENSE_SERVER_ENV = "GSM_LICENSE_SERVER";
export const LICENSE_MODE_ENV = "GSM_LICENSE_MODE";
export const LICENSE_VALIDATE_TIMEOUT_MS = 10_000;

export const LICENSE_SETTING_SERVER = "license_server";
export const LICENSE_SETTING_ACTIVATED_AT = "license_activated_at";
export const LICENSE_SETTING_FINGERPRINT = "license_fingerprint";

/** Is this installation the master panel (key desk)? */
export function isLicenseMasterMode(): boolean {
  return (process.env[LICENSE_MODE_ENV] ?? "").trim().toLowerCase() === "master";
}

/** The configured license server URL, or null when unset. */
export function licenseServerUrl(): string | null {
  const raw = (process.env[LICENSE_SERVER_ENV] ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export interface ValidateOutcome {
  ok: boolean;
  code: string;
  message: string;
}

/** Pure interpretation of the license server's HTTP answer. */
export function interpretValidateResponse(input: {
  status: number;
  body: unknown;
}): ValidateOutcome {
  const b = (input.body ?? {}) as Record<string, unknown>;
  if (input.status === 200 && b.ok === true) {
    return { ok: true, code: "ok", message: typeof b.message === "string" ? b.message : "License key accepted." };
  }
  if (input.status === 429) {
    return {
      ok: false,
      code: "rate-limited",
      message: "The license server is rate-limiting attempts — wait a minute and try again.",
    };
  }
  const code = typeof b.code === "string" ? b.code : "invalid";
  const message =
    typeof b.error === "string" && b.error
      ? b.error
      : "The license key was rejected by the license server.";
  return { ok: false, code, message };
}

/** Pure decision: may the install proceed, given environment + outcome? */
export function decideInstallLicense(input: {
  masterMode: boolean;
  serverConfigured: boolean;
  outcome: ValidateOutcome | null; // null = server unreachable / no key presented
  keyPresented: boolean;
}): { ok: boolean; reason?: string } {
  if (input.masterMode) return { ok: true };
  if (!input.serverConfigured) {
    return {
      ok: false,
      reason:
        "No license server is configured. Set GSM_LICENSE_SERVER to the master panel URL (or run this instance as the master with GSM_LICENSE_MODE=master).",
    };
  }
  if (!input.keyPresented) {
    return { ok: false, reason: "A license key is required to install this panel. Enter the key you were given." };
  }
  if (!input.outcome || !input.outcome.ok) {
    return {
      ok: false,
      reason: input.outcome?.message ?? "The license server could not be reached — installation refused.",
    };
  }
  return { ok: true };
}

export const LICENSE_OFFLINE_TOKEN_ENV = "GSM_LICENSE_OFFLINE_TOKEN";
export const LICENSE_OFFLINE_PUBKEY_ENV = "GSM_LICENSE_OFFLINE_PUBKEY";

/**
 * Full install decision: master bypass > explicit offline token path >
 * online key validation. Everything fails closed.
 */
export function decideInstallLicenseExtended(input: {
  masterMode: boolean;
  serverConfigured: boolean;
  onlineOutcome: ValidateOutcome | null;
  keyPresented: boolean;
  offlineTokenPresented: boolean;
  offlineOutcome: { ok: boolean; reason?: string } | null;
}): { ok: boolean; reason?: string; mode: "master" | "offline" | "online" } {
  if (input.masterMode) return { ok: true, mode: "master" };
  if (input.offlineTokenPresented) {
    if (!input.offlineOutcome || !input.offlineOutcome.ok) {
      return {
        ok: false,
        mode: "offline",
        reason: input.offlineOutcome?.reason ?? "The offline license token could not be verified.",
      };
    }
    return { ok: true, mode: "offline" };
  }
  const online = decideInstallLicense({
    masterMode: false,
    serverConfigured: input.serverConfigured,
    outcome: input.onlineOutcome,
    keyPresented: input.keyPresented,
  });
  return { ...online, mode: "online" };
}

/**
 * Validate a key against the license server. Returns null when the server
 * is unreachable (the caller decides fail-closed).
 */
export async function validateLicenseRemote(input: {
  serverUrl: string;
  key: string;
  hostname: string;
  panelUrl: string;
  /** Fingerprint re-check (heartbeat): carries no key material at all. */
  fingerprint?: string;
}): Promise<ValidateOutcome | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_VALIDATE_TIMEOUT_MS);
    try {
      const payload = input.fingerprint
        ? { fingerprint: input.fingerprint, hostname: input.hostname, panelUrl: input.panelUrl }
        : { key: input.key, hostname: input.hostname, panelUrl: input.panelUrl };
      const res = await fetch(`${input.serverUrl}/api/license/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return interpretValidateResponse({ status: res.status, body });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}


// ── Offline pre-signed tokens (air-gapped installs) ────────────────────────
// The master panel signs a short JSON payload with its Ed25519 private key;
// the offline installer verifies the signature against the PUBLIC key it was
// handed and checks the expiry — no network, no key material on the client.

export const OFFLINE_TOKEN_VERSION = 1;
export const OFFLINE_TOKEN_MAX_DAYS = 365;

export interface OfflineTokenPayload {
  v: number;
  keyId: number;
  label: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
}

export function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

export function b64urlDecode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

/** Split and sanity-shape a token. Pure string work, no crypto. */
export function parseOfflineToken(token: unknown): { payloadJson: string; payloadBytes: Buffer; sig: Buffer } | null {
  if (typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const payloadBytes = b64urlDecode(parts[0]);
  const sig = b64urlDecode(parts[1]);
  if (!payloadBytes || !sig || sig.length === 0) return null;
  const payloadJson = payloadBytes.toString("utf8");
  try {
    JSON.parse(payloadJson);
  } catch {
    return null;
  }
  return { payloadJson, payloadBytes, sig };
}

/** Pure verdict once parse/signature/expiry facts are known. */
export function decideOfflineToken(input: {
  parsed: boolean;
  signatureValid: boolean;
  expired: boolean;
}): { ok: boolean; reason?: string } {
  if (!input.parsed) return { ok: false, reason: "The offline license token is malformed." };
  if (!input.signatureValid) return { ok: false, reason: "The offline license token failed signature verification — it was not issued by the master panel." };
  if (input.expired) return { ok: false, reason: "The offline license token has expired — ask for a fresh one." };
  return { ok: true };
}

/** Full local verification: parse, Ed25519-verify, check expiry. */
export async function verifyOfflineToken(input: {
  token: string;
  publicKeyPem: string;
  nowMs: number;
}): Promise<{ ok: boolean; reason?: string; payload?: OfflineTokenPayload }> {
  const parsed = parseOfflineToken(input.token);
  if (!parsed) {
    return { ok: false, reason: "The offline license token is malformed." };
  }
  let signatureValid = false;
  try {
    const { verify } = await import("node:crypto");
    signatureValid = verify(null, parsed.payloadBytes, input.publicKeyPem, parsed.sig);
  } catch {
    signatureValid = false; // bad PEM shape = not valid
  }
  let payload: OfflineTokenPayload | undefined;
  let expired = true;
  if (signatureValid) {
    try {
      const candidate = JSON.parse(parsed.payloadJson) as OfflineTokenPayload;
      if (
        candidate &&
        candidate.v === OFFLINE_TOKEN_VERSION &&
        Number.isFinite(candidate.expiresAtMs) &&
        Number.isFinite(candidate.issuedAtMs) &&
        Number.isInteger(candidate.keyId)
      ) {
        payload = candidate;
        expired = input.nowMs >= candidate.expiresAtMs;
      }
    } catch {
      payload = undefined;
    }
  }
  const decision = decideOfflineToken({ parsed: true, signatureValid, expired: signatureValid ? expired : true });
  return { ok: decision.ok, reason: decision.reason, payload };
}

/** Master-side signer: build + sign a token payload. */
export async function buildOfflineToken(input: {
  keyId: number;
  label: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
  privateKeyPem: string;
}): Promise<string> {
  const payload: OfflineTokenPayload = {
    v: OFFLINE_TOKEN_VERSION,
    keyId: input.keyId,
    label: input.label,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
  };
  const payloadJson = JSON.stringify(payload);
  const { sign } = await import("node:crypto");
  const sig = sign(null, Buffer.from(payloadJson, "utf8"), input.privateKeyPem);
  return `${b64urlEncode(payloadJson)}.${b64urlEncode(sig)}`;
}

/** Normalize a possibly-base64-wrapped PEM coming from .env or a textarea. */
export function normalizePublicKeyPem(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) return trimmed;
  // Single-line base64-of-PEM (how install.sh stores it in .env).
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("BEGIN PUBLIC KEY")) return decoded;
  } catch {
    /* not base64 */
  }
  return null;
}
