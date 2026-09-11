/**
 * Shared pieces of the Discord OAuth login flow.
 *
 * Kept out of the route files so the authorize endpoint and the callback
 * cannot drift apart, and so the security checks have one place to point at.
 */

export const OAUTH_STATE_COOKIE = "gsm_oauth_state";

/** Where Discord sends the user back; must match the portal registration. */
export function discordRedirectUri(origin: string): string {
  return `${origin}/api/auth/discord/callback`;
}

export interface OauthAccountState {
  /** A panel account already matches the Discord email. */
  accountExists: boolean;
  /** The matched account's status is "active" (ignored when it does not exist). */
  accountActive: boolean;
  /** The matched account has two-factor authentication enabled. */
  twoFactorEnabled: boolean;
  /** Self-registration is open on this panel. */
  registrationEnabled: boolean;
  /** The Australian minimum-age gate is on (new accounts must declare a DOB). */
  ageVerificationEnabled: boolean;
}

export type OauthDecision =
  | "sign_in"    // existing active account without 2FA
  | "suspended"  // exists but not active
  | "2fa"        // exists but password+TOTP is the only way in
  | "no_register"// no account and self-registration is closed
  | "age_gate"   // no account and a DOB declaration is legally required
  | "create";    // no account; registration open and no age gate

/**
 * Decide what an OAuth sign-in does for a given Discord identity.
 *
 * The two refusal paths that matter legally are encoded here and unit-
 * tested: OAuth never bypasses 2FA, and it never creates an account that
 * should have declared a date of birth.
 */
export function oauthLoginDecision(s: OauthAccountState): OauthDecision {
  if (s.accountExists) {
    if (!s.accountActive) return "suspended";
    if (s.twoFactorEnabled) return "2fa";
    return "sign_in";
  }
  if (!s.registrationEnabled) return "no_register";
  if (s.ageVerificationEnabled) return "age_gate";
  return "create";
}
