/**
 * The install key — Stage 42.
 *
 * The CD-key panel gate (GSM-XXXX-XXXX keys handed to users) was removed.
 * What survives is a single pure decision used by the web installer: when
 * the operator configured a master key, claiming a fresh panel requires it.
 * No key configured -> the first install stays open (pre-gate behaviour).
 * Re-installs are already protected by login + panel.install permission.
 */

/** Master/install keys shorter than this are never accepted. */
export const INSTALL_KEY_MIN_LENGTH = 16;

/**
 * First-run install access check (pure — the route passes env values in).
 */
export function checkInstallAccessKey(input: {
  masterKeyConfigured: boolean;
  masterKey: string | null;
  presented: unknown;
}): { ok: boolean; reason?: string } {
  if (!input.masterKeyConfigured) return { ok: true };
  const presented = typeof input.presented === "string" ? input.presented.trim() : "";
  if (presented.length < INSTALL_KEY_MIN_LENGTH) {
    return { ok: false, reason: "The operator master key is required to install this panel." };
  }
  if (input.masterKey === null || presented !== input.masterKey) {
    return { ok: false, reason: "That key does not open this panel. Check the operator master key and try again." };
  }
  return { ok: true };
}
