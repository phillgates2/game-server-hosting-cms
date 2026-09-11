/**
 * Tests for the Discord OAuth sign-in decision matrix.
 *
 * These pin the two outcomes that matter most: OAuth can never bypass
 * two-factor authentication, and it can never create an account that the
 * Australian minimum-age gate says must declare a date of birth.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { oauthLoginDecision, discordRedirectUri, OAUTH_STATE_COOKIE } from "../src/lib/discord-oauth";

describe("oauthLoginDecision — existing accounts", () => {
  test("an active account without 2FA signs straight in", () => {
    assert.equal(
      oauthLoginDecision({
        accountExists: true,
        accountActive: true,
        twoFactorEnabled: false,
        registrationEnabled: true,
        ageVerificationEnabled: true,
      }),
      "sign_in"
    );
  });

  test("suspended/banned accounts are refused even with everything else permissive", () => {
    assert.equal(
      oauthLoginDecision({
        accountExists: true,
        accountActive: false,
        twoFactorEnabled: false,
        registrationEnabled: true,
        ageVerificationEnabled: false,
      }),
      "suspended"
    );
  });

  test("2FA accounts must use password + code — OAuth never sidesteps TOTP", () => {
    assert.equal(
      oauthLoginDecision({
        accountExists: true,
        accountActive: true,
        twoFactorEnabled: true,
        registrationEnabled: true,
        ageVerificationEnabled: false,
      }),
      "2fa"
    );
  });
});

describe("oauthLoginDecision — new accounts", () => {
  test("created when registration is open and no age gate applies", () => {
    assert.equal(
      oauthLoginDecision({
        accountExists: false,
        accountActive: false,
        twoFactorEnabled: false,
        registrationEnabled: true,
        ageVerificationEnabled: false,
      }),
      "create"
    );
  });

  test("refused when self-registration is closed", () => {
    assert.equal(
      oauthLoginDecision({
        accountExists: false,
        accountActive: false,
        twoFactorEnabled: false,
        registrationEnabled: false,
        ageVerificationEnabled: false,
      }),
      "no_register"
    );
  });

  test("refused when the age gate is on — a DOB declaration is mandatory", () => {
    // This is the Australian-law hole-closer: OAuth cannot prove age, so it
    // must not mint accounts while the gate requires a declared DOB — even
    // though registration itself is open.
    assert.equal(
      oauthLoginDecision({
        accountExists: false,
        accountActive: false,
        twoFactorEnabled: false,
        registrationEnabled: true,
        ageVerificationEnabled: true,
      }),
      "age_gate"
    );
  });

  test("registration-closed wins over the age gate (both refuse; the message differs)", () => {
    assert.equal(
      oauthLoginDecision({
        accountExists: false,
        accountActive: false,
        twoFactorEnabled: false,
        registrationEnabled: false,
        ageVerificationEnabled: true,
      }),
      "no_register"
    );
  });
});

describe("flow plumbing", () => {
  test("the redirect URI is always the panel's own callback", () => {
    assert.equal(
      discordRedirectUri("https://panel.example.com"),
      "https://panel.example.com/api/auth/discord/callback"
    );
  });

  test("the state cookie has a stable, namespaced name", () => {
    assert.equal(OAUTH_STATE_COOKIE, "gsm_oauth_state");
  });
});
