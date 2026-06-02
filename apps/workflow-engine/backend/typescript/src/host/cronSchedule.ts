/**
 * Minimal wall-clock cron evaluator for the scheduler daemon (RFC 0052 §B).
 *
 * The durable job store (schedulingService.ts) stores `cronExpr` as an opaque
 * string and a separate in-memory tick seam drives conformance. To fire jobs on
 * a real cadence, the daemon needs to compute the next wall-clock fire time from
 * `cronExpr`. This module is that evaluator — deliberately dependency-free.
 *
 * Supported: standard 5-field cron `minute hour day-of-month month day-of-week`
 * with `*`, lists (`1,2,3`), ranges (`1-5`), and steps (`* / n`, `a-b/n`).
 * Day-of-week is 0-7 (0 and 7 both Sunday). When BOTH day-of-month and
 * day-of-week are restricted, a match is their UNION (standard Vixie-cron rule).
 * This covers every cadence the UI offers (hourly, daily, weekdays, weekly) and
 * the common hand-written forms.
 *
 * Timezone: when a job carries an IANA `timezone`, the cron fields are evaluated
 * against the wall-clock in THAT zone (DST-correct, because each candidate
 * instant is rendered to local fields via `Intl`). Absent a timezone, fields are
 * evaluated in UTC (the fast path).
 *
 * Anything that fails to parse yields `null` from `computeNextFire` — the daemon
 * logs and skips such a job rather than crashing the sweep.
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

const MINUTE_MS = 60_000;
/** Hard cap on the forward search — mirrors the advertised maxFutureHorizon.
 *  A cron with no match inside this window (a misconfiguration) yields null. */
const SEARCH_HORIZON_MS = 30 * 24 * 60 * 60 * 1000 + MINUTE_MS;

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** Whether day-of-month was explicitly restricted (not `*`). */
  domRestricted: boolean;
  /** Whether day-of-week was explicitly restricted (not `*`). */
  dowRestricted: boolean;
}

/** Expand one cron field token (e.g. `*`, `1-5`, `* /2`, `0,30`) into the set of
 *  matching integers, or null when the token is malformed / out of range. */
function parseField(token: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of token.split(',')) {
    if (part.length === 0) return null;
    let range = part;
    let step = 1;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      range = part.slice(0, slash);
      const stepStr = part.slice(slash + 1);
      step = Number(stepStr);
      if (!Number.isInteger(step) || step <= 0) return null;
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [loStr, hiStr] = range.split('-');
      lo = Number(loStr);
      hi = Number(hiStr);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    } else {
      lo = Number(range);
      hi = lo;
      if (!Number.isInteger(lo)) return null;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

/** Parse a 5-field cron expression, or null when malformed. Exported for tests. */
export function parseCron(cronExpr: string): CronFields | null {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dowRaw = parseField(fields[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  // Normalize day-of-week: 7 → 0 (both Sunday).
  const dow = new Set<number>();
  for (const v of dowRaw) dow.add(v === 7 ? 0 : v);
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: fields[2] !== '*',
    dowRestricted: fields[4] !== '*',
  };
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  dow: number; // 0-6, Sunday=0
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Build a reusable timezone formatter (construction is expensive, so the
 *  caller builds one per computeNextFire call rather than per candidate). */
function tzFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
}

/** Render an instant to wall-clock fields using a prebuilt timezone formatter. */
function wallClockInTz(ms: number, dtf: Intl.DateTimeFormat): WallClock {
  const parts = dtf.formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // hour12:false can render midnight as "24" on some ICU builds — normalize.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    dow: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Render an instant to wall-clock fields in UTC (fast path). */
function wallClockUtc(ms: number): WallClock {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

function matches(wc: WallClock, c: CronFields): boolean {
  if (!c.minute.has(wc.minute)) return false;
  if (!c.hour.has(wc.hour)) return false;
  if (!c.month.has(wc.month)) return false;
  // Standard cron day matching: if both DOM and DOW are restricted, a match on
  // EITHER is sufficient (union); if only one is restricted, it must match; if
  // neither is restricted, any day matches.
  const domOk = c.dom.has(wc.day);
  const dowOk = c.dow.has(wc.dow);
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  if (c.domRestricted) return domOk;
  if (c.dowRestricted) return dowOk;
  return true;
}

/**
 * Compute the next wall-clock fire time strictly after `afterMs` for `cronExpr`,
 * as epoch milliseconds (aligned to the minute). Returns null when the
 * expression is malformed or has no match within the search horizon.
 *
 * @param cronExpr standard 5-field cron expression
 * @param afterMs  search strictly after this instant (epoch ms)
 * @param timezone optional IANA timezone; UTC when omitted
 */
export function computeNextFire(cronExpr: string, afterMs: number, timezone?: string): number | null {
  const c = parseCron(cronExpr);
  if (!c) return null;
  // Build the timezone formatter ONCE (construction is heavy; the loop can run
  // tens of thousands of minutes for a sparse cron).
  const dtf = timezone ? tzFormatter(timezone) : null;
  // Start at the next whole minute strictly after `afterMs`.
  let candidate = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = afterMs + SEARCH_HORIZON_MS;
  while (candidate <= limit) {
    const wc = dtf ? wallClockInTz(candidate, dtf) : wallClockUtc(candidate);
    if (matches(wc, c)) return candidate;
    candidate += MINUTE_MS;
  }
  return null;
}
