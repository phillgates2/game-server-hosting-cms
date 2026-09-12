/**
 * License heartbeat: licensed panels re-prove their activation against the
 * master panel every LICENSE_HEARTBEAT_INTERVAL. Honest failure model:
 *
 *   - An EXPLICIT rejection (revoked / expired / unknown activation) locks
 *     the panel immediately — the provider said no, so no grace.
 *   - An UNREACHABLE server starts a grace window (default 72h): networks
 *     and master panels have bad days, and a paying customer should not be
 *     bricked by a DNS hiccup. Still unreachable after the grace → locked.
 *
 * "Locked" blocks NEW logins with a 402 and shows a banner; existing data is
 * never touched. Recovery: fix the key, or set GSM_LICENSE_MODE=master on a
 * box you own.
 */

export const LICENSE_HEARTBEAT_INTERVAL_MS = 6 * 3_600_000;
export const LICENSE_GRACE_HOURS = 72;

export const LICENSE_SETTING_LAST_CHECK = "license_last_check_at";
export const LICENSE_SETTING_LAST_STATUS = "license_last_status"; // ok | rejected | unreachable
export const LICENSE_SETTING_LAST_CODE = "license_last_code";
export const LICENSE_SETTING_INVALID_SINCE = "license_invalid_since";
export const LICENSE_SETTING_MESSAGE = "license_message";

export type HeartbeatVerdict = "ok" | "rejected" | "unreachable";
export type LicensePanelState = "ok" | "grace" | "locked";

/**
 * Pure state machine for the grace/lock decision.
 * `invalidSinceMs` is the moment the current failure streak started (null
 * while healthy). Explicit rejections lock immediately; unreachability only
 * starts (or continues) the grace clock.
 */
export function evaluateLicenseHeartbeat(input: {
  verdict: HeartbeatVerdict;
  invalidSinceMs: number | null;
  nowMs: number;
  graceMs: number;
}): { state: LicensePanelState; invalidSinceMs: number | null } {
  if (input.verdict === "ok") {
    return { state: "ok", invalidSinceMs: null };
  }
  if (input.verdict === "rejected") {
    return { state: "locked", invalidSinceMs: input.nowMs };
  }
  // unreachable: grace window
  const since = input.invalidSinceMs ?? input.nowMs;
  const locked = input.nowMs - since >= input.graceMs;
  return { state: locked ? "locked" : "grace", invalidSinceMs: since };
}

/** Human banner text for each state. */
export function licenseStateBanner(input: {
  state: LicensePanelState;
  code: string | null;
  message: string | null;
  invalidSinceMs: number | null;
  graceMs: number;
  nowMs: number;
}): string | null {
  if (input.state === "ok") return null;
  if (input.state === "locked") {
    return `🔒 License invalid (${input.code ?? "rejected"}) — new logins are blocked. Renew the key with your provider, or set GSM_LICENSE_MODE=master on this box if it is the key desk.${input.message ? ` ${input.message}` : ""}`;
  }
  const elapsedMs = input.invalidSinceMs !== null ? input.nowMs - input.invalidSinceMs : 0;
  const remainingH = Math.max(0, Math.ceil((input.graceMs - elapsedMs) / 3_600_000));
  return `⚠️ License could not be verified (license server unreachable). The panel locks in ~${remainingH}h if this persists. Check network access to the master panel.`;
}

// ── Orchestrator (called from the scheduler tick) ───────────────────────────

/**
 * Run one heartbeat pass. Best-effort everywhere: licensing diagnostics must
 * never break task execution. Returns the resulting state.
 */
export async function runLicenseHeartbeat(nowMs: number = Date.now()): Promise<LicensePanelState> {
  const { db } = await import("@/db");
  const { settings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { isLicenseMasterMode, licenseServerUrl, LICENSE_SETTING_FINGERPRINT } = await import("./license-client");

  if (isLicenseMasterMode()) return "ok"; // the key desk validates nobody

  const load = async (key: string): Promise<string | null> => {
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
    return row?.value ?? null;
  };

  // Offline-licensed installs re-check nothing over the network — their
  // signed token expiry IS the license. Expired = rejected = lock now.
  const licenseMode = await load("license_mode");
  if (licenseMode === "offline") {
    const expiresRaw = await load("license_offline_expires_at");
    const expiresMs = expiresRaw ? new Date(expiresRaw).getTime() : NaN;
    const verdict: HeartbeatVerdict = Number.isFinite(expiresMs) && nowMs < expiresMs ? "ok" : "rejected";
    const result = evaluateLicenseHeartbeat({
      verdict,
      invalidSinceMs: null,
      nowMs,
      graceMs: LICENSE_GRACE_HOURS * 3_600_000,
    });
    const upsert = async (key: string, value: string | null): Promise<void> => {
      const { upsertSetting } = await import("./webhook-dispatch");
      await upsertSetting(key, value).catch(() => undefined);
    };
    await upsert(LICENSE_SETTING_LAST_CHECK, new Date(nowMs).toISOString());
    await upsert(LICENSE_SETTING_LAST_STATUS, verdict);
    await upsert(LICENSE_SETTING_LAST_CODE, verdict === "ok" ? null : "offline-token-expired");
    await upsert(LICENSE_SETTING_MESSAGE, verdict === "ok" ? null : "The offline license token has expired.");
    await upsert(LICENSE_SETTING_INVALID_SINCE, result.invalidSinceMs === null ? null : new Date(result.invalidSinceMs).toISOString());
    return result.state;
  }

  const serverUrl = licenseServerUrl();
  const fingerprint = await load(LICENSE_SETTING_FINGERPRINT);
  const activatedAt = await load("license_activated_at");
  // Never licensed in the first place (pre-licensing install): don't harass.
  if (!serverUrl || !fingerprint || !activatedAt) return "ok";

  const { validateLicenseRemote } = await import("./license-client");
  const { hostname } = await import("node:os");
  const outcome = await validateLicenseRemote({
    serverUrl,
    key: "", // fingerprint re-check carries no key
    hostname: hostname(),
    panelUrl: "",
    fingerprint,
  });

  const verdict: HeartbeatVerdict = outcome === null ? "unreachable" : outcome.ok ? "ok" : "rejected";
  const code = outcome === null ? null : outcome.code;
  const message = outcome === null ? null : outcome.message;

  const invalidSinceRaw = await load(LICENSE_SETTING_INVALID_SINCE);
  const invalidSinceMs = invalidSinceRaw ? new Date(invalidSinceRaw).getTime() : NaN;

  const result = evaluateLicenseHeartbeat({
    verdict,
    invalidSinceMs: Number.isFinite(invalidSinceMs) ? invalidSinceMs : null,
    nowMs,
    graceMs: LICENSE_GRACE_HOURS * 3_600_000,
  });

  const upsert = async (key: string, value: string | null): Promise<void> => {
    const { upsertSetting } = await import("./webhook-dispatch");
    await upsertSetting(key, value).catch(() => undefined);
  };
  await upsert(LICENSE_SETTING_LAST_CHECK, new Date(nowMs).toISOString());
  await upsert(LICENSE_SETTING_LAST_STATUS, verdict);
  await upsert(LICENSE_SETTING_LAST_CODE, code);
  await upsert(LICENSE_SETTING_MESSAGE, message);
  await upsert(LICENSE_SETTING_INVALID_SINCE, result.invalidSinceMs === null ? null : new Date(result.invalidSinceMs).toISOString());

  return result.state;
}

/** Current state for the UI/login gate, straight from stored settings. */
export async function currentLicenseState(): Promise<{
  state: LicensePanelState;
  code: string | null;
  message: string | null;
  banner: string | null;
  lastCheckAt: string | null;
}> {
  const { db } = await import("@/db");
  const { settings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { isLicenseMasterMode } = await import("./license-client");

  if (isLicenseMasterMode()) {
    return { state: "ok", code: null, message: null, banner: null, lastCheckAt: null };
  }

  const load = async (key: string): Promise<string | null> => {
    try {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
      return row?.value ?? null;
    } catch {
      return null;
    }
  };

  const status = await load(LICENSE_SETTING_LAST_STATUS);
  if (status === null) {
    // No heartbeat has run yet: report ok, the first tick will populate it.
    return { state: "ok", code: null, message: null, banner: null, lastCheckAt: null };
  }

  const invalidSinceRaw = await load(LICENSE_SETTING_INVALID_SINCE);
  const invalidSinceMs = invalidSinceRaw ? new Date(invalidSinceRaw).getTime() : null;
  const state: LicensePanelState =
    status === "ok" ? "ok" : evaluateLicenseHeartbeat({
      verdict: status === "rejected" ? "rejected" : "unreachable",
      invalidSinceMs: invalidSinceMs !== null && Number.isFinite(invalidSinceMs) ? invalidSinceMs : Date.now(),
      nowMs: Date.now(),
      graceMs: LICENSE_GRACE_HOURS * 3_600_000,
    }).state;

  const code = await load(LICENSE_SETTING_LAST_CODE);
  const message = await load(LICENSE_SETTING_MESSAGE);
  return {
    state,
    code,
    message,
    banner: licenseStateBanner({
      state,
      code,
      message,
      invalidSinceMs,
      graceMs: LICENSE_GRACE_HOURS * 3_600_000,
      nowMs: Date.now(),
    }),
    lastCheckAt: await load(LICENSE_SETTING_LAST_CHECK),
  };
}
