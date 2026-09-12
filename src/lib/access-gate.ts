/**
 * The install-time key boundary (Stage 42).
 *
 * The CD-key login gate was REMOVED: signing in takes a username and
 * password (plus 2FA, session and IP-allowlist gates). The only key that
 * gates anything now is the OPERATOR MASTER KEY, checked once — when a
 * fresh panel is claimed through the web installer. Re-installs are
 * protected by login + panel.install permission, upgrades need no key.
 *
 * GSM_PANEL_MASTER_KEY lives in the environment (>= 16 chars). It doubles
 * as an unlimited license key and the X-Master-Key admin credential — see
 * src/lib/master-key.ts.
 */

export { checkInstallAccessKey } from "./access-keys";

export const PANEL_MASTER_KEY_ENV = "GSM_PANEL_MASTER_KEY";

import { INSTALL_KEY_MIN_LENGTH } from "./access-keys";
export const PANEL_MASTER_KEY_MIN_LENGTH = INSTALL_KEY_MIN_LENGTH;
