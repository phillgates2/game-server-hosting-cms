/**
 * Age verification for account registration.
 *
 * Under Australian law — the Online Safety Amendment (Social Media Minimum
 * Age) Act 2024, in force from 10 December 2025 — people under 16 cannot
 * hold accounts on platforms with social/community features, and operators
 * must take reasonable steps to prevent it. This panel hosts community
 * features (forum, chat), so self-registration is gated at 16 by default.
 *
 * The minimum age and the gate itself are panel settings (see
 * panel-settings.ts / auth-policy.ts); this module is the pure decision
 * logic so it can be unit-tested without a database and imported from the
 * edge runtime.
 */

/** The Australian statutory minimum account age. */
export const AUSTRALIAN_MINIMUM_ACCOUNT_AGE = 16;

/** Shown whenever an under-age registration is refused. */
export const AGE_LAW_NOTICE =
  "Under Australian law (Online Safety Amendment (Social Media Minimum Age) Act 2024), people under 16 cannot hold an account.";

export interface AgeCheckResult {
  ok: boolean;
  /** Why a check failed: malformed input vs. a genuine under-age refusal. */
  reason?: "invalid" | "under-age";
  error?: string;
  /** Whole years of age, when the date of birth parsed. */
  age?: number;
}

/**
 * Whole years lived between `dob` and `at`, anniversary-based.
 *
 * A person reaches an age on the anniversary of their birth date. Someone
 * born on 29 February reaches each anniversary on 1 March in non-leap
 * years — the simple comparison below produces exactly that, since 28 Feb
 * sorts before the (month, day) pair and 1 March after it.
 */
export function ageInYears(dob: Date, at: Date): number {
  let years = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeAnniversary =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return years;
}

/**
 * Parse an ISO `YYYY-MM-DD` date of birth — the exact shape a browser
 * `<input type="date">` submits.
 *
 * Returns null for anything malformed (wrong shape, month 13, 31 Feb —
 * including values the Date constructor would silently roll over), in the
 * future, or implausibly old (> 120 years).
 */
export function parseDateOfBirth(raw: unknown, now: Date = new Date()): Date | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dob = new Date(Date.UTC(year, month - 1, day));
  // The Date constructor rolls impossible dates forward (2026-02-31 → 3
  // March). Re-reading the components catches that silently-wrong class.
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return null;
  }
  if (dob.getTime() > now.getTime()) return null;
  if (ageInYears(dob, now) > 120) return null;
  return dob;
}

/**
 * Decide whether a submitted date of birth satisfies a minimum age.
 *
 * `reason` distinguishes a bad/missing date (route answers 400) from a
 * valid-but-under-age one (route answers 403 and quotes the law).
 */
export function checkMinimumAge(
  rawDob: unknown,
  minimumAge: number,
  now: Date = new Date()
): AgeCheckResult {
  const dob = parseDateOfBirth(rawDob, now);
  if (!dob) {
    return {
      ok: false,
      reason: "invalid",
      error: "Enter a valid date of birth (YYYY-MM-DD). It cannot be in the future.",
    };
  }
  const age = ageInYears(dob, now);
  if (age < minimumAge) {
    return {
      ok: false,
      reason: "under-age",
      age,
      error: `You must be at least ${minimumAge} years old to create an account. ${AGE_LAW_NOTICE}`,
    };
  }
  return { ok: true, age };
}
