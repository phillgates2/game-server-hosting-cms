/**
 * Five-field cron parsing for the scheduler.
 *
 * The scheduler used to guess the next run with parseInt on two of the five
 * fields: a step like "every 30 minutes" became NaN (an invalid timestamp
 * stored in the database) and a list like "5,10" was silently treated as 5.
 * This is the real subset of cron anyone uses in a game panel: '*', numbers,
 * ranges, lists and '/n' steps, with the standard dom/dow OR rule.
 */

export interface CronSchedule {
  minutes: Set<number>; // 0-59
  hours: Set<number>; // 0-23
  daysOfMonth: Set<number>; // 1-31
  months: Set<number>; // 1-12
  daysOfWeek: Set<number>; // 0-6 (Sunday = 0, 7 normalised to 0)
  /** True when the field is `*` — matters for the dom/dow OR rule. */
  domStar: boolean;
  dowStar: boolean;
}

const FIELD_SPECS = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (7 = Sunday)
] as const;

/** Parse one star, a number, a range, a step, or a comma list of any of these. */
function parseField(raw: string, { min, max }: { min: number; max: number }): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    if (part === "") return null;
    const stepMatch = part.match(/^(?:(?:\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!stepMatch) return null;
    const [, loStr, hiStr, stepStr] = stepMatch;
    let lo: number;
    let hi: number;
    if (loStr === undefined) {
      lo = min;
      hi = max;
    } else {
      lo = Number(loStr);
      hi = hiStr === undefined ? lo : Number(hiStr);
    }
    if (lo > hi) return null;
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (step < 1) return null;
    // Day-of-week 7 is Sunday, which cron spells 0.
    for (let v = lo; v <= hi; v += step) {
      const value = max === 7 && v === 7 ? 0 : v;
      if (value < min || value > (max === 7 ? 6 : max)) continue;
      out.add(value);
    }
    if (out.size === 0) return null;
  }
  return out;
}

/** Parse a 5-field cron expression, or null when it is not valid cron. */
export function parseCron(expr: string | null | undefined): CronSchedule | null {
  if (typeof expr !== "string") return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  if (parts.some((p) => p.length > 64)) return null;

  const minutes = parseField(parts[0], FIELD_SPECS[0]);
  const hours = parseField(parts[1], FIELD_SPECS[1]);
  const daysOfMonth = parseField(parts[2], FIELD_SPECS[2]);
  const months = parseField(parts[3], FIELD_SPECS[3]);
  const daysOfWeek = parseField(parts[4], FIELD_SPECS[4]);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domStar: parts[2].trim() === "*",
    dowStar: parts[4].trim() === "*",
  };
}

const MAX_ITERATIONS = 500_000; // ~11 months of minutes; long enough for any schedule

/**
 * The next instant matching the schedule strictly after `from` (minute
 * granularity, seconds zeroed), or null when none exists within the horizon.
 */
export function nextRunAfter(schedule: CronSchedule, from: Date): Date | null {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  let iterations = 0;
  while (iterations++ < MAX_ITERATIONS) {
    const month = next.getMonth() + 1;
    if (!schedule.months.has(month)) {
      // Jump to the first day of the next month, 00:00.
      next.setDate(1);
      next.setHours(0, 0, 0, 0);
      next.setMonth(next.getMonth() + 1);
      continue;
    }

    const dom = next.getDate();
    const dow = next.getDay();
    const domMatch = schedule.domStar || schedule.daysOfMonth.has(dom);
    const dowMatch = schedule.dowStar || schedule.daysOfWeek.has(dow);
    // Standard cron: when both dom and dow are restricted, either may match.
    const dayOk = (schedule.domStar && schedule.dowStar)
      ? true
      : schedule.domStar
        ? dowMatch
        : schedule.dowStar
          ? domMatch
          : domMatch || dowMatch;

    if (!dayOk) {
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      continue;
    }

    if (!schedule.hours.has(next.getHours())) {
      next.setHours(next.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!schedule.minutes.has(next.getMinutes())) {
      next.setMinutes(next.getMinutes() + 1);
      continue;
    }

    return next;
  }
  return null;
}

/** Convenience wrapper the API routes use: parse and compute in one go. */
export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const schedule = parseCron(expr);
  return schedule ? nextRunAfter(schedule, from) : null;
}

/** True when a string is a usable 5-field cron expression. */
export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}
