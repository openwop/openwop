/**
 * How long a webhook scenario waits for a host's retry schedule to play out.
 *
 * The advertised `webhooks.retryPolicy` facet is closed over exactly
 * `{ maxAttempts, backoff }`: a host has NO way to put its intervals on the
 * wire, so the suite cannot derive how long exhaustion takes and has to choose
 * a window. Every window it has chosen so far has convicted a durable host:
 *
 *   2.0.1   a hard 20 s failed a host whose first backoff was 30 s.
 *   2.34.1  a hard 90 s cap fails a host retrying at 15 / 30 / 60 / 120 s with
 *           `maxAttempts: 5` — attempts at t0, +15, +45, +105, +225 s. The
 *           dead-letter leg read the sink ~120 s before that host exhausts, and
 *           recorded `executed-fail` ("MUST be routed to the sink, not dropped")
 *           about a host that delivers, retries five times and dead-letters
 *           correctly. To pass it would have had to cut its PRODUCTION retry
 *           window from ~225 s to ~75 s for every real subscriber. Reported by a
 *           tier-2 host before it advertised the facet, from its own constants.
 *
 * An instrument must not choose a host's durability. So the cap is
 * OPERATOR-RAISABLE — the shape `OPENWOP_DURABILITY_OBSERVATION_CEILING_MS`
 * already has for RFC 0158's kill rows — and NEVER LOWERABLE: a value below the
 * default, or not a number, is ignored, so no operator can shrink the window to
 * hide a slow retry. A raised window is still bounded, so a host that never
 * retries still fails; it only fails later.
 *
 * RFC 0225 (suite 2.44.0): a host MAY advertise `retryPolicy.maxElapsedMs`,
 * the longest from a delivery's first attempt to its dead-lettering. When it
 * does, the wait is that bound plus a 30 s grace (the env var can still only
 * raise it; clamped to the 1 h maximum), and a row convicts only once the wait
 * has passed the advertised bound — the host's own promise, not a deadline the
 * suite chose.
 */
export const RETRY_WAIT_FLOOR_MS = 20_000;
export const DEFAULT_RETRY_WAIT_CAP_MS = 90_000;
/** A typo guard, not a policy: an hour per wait is longer than any retry schedule worth certifying in one sitting. */
export const MAX_RETRY_WAIT_CAP_MS = 3_600_000;
export const RETRY_WAIT_ENV = 'OPENWOP_WEBHOOK_RETRY_WAIT_MS';
/** RFC 0225: slack past an advertised `maxElapsedMs` for delivery latency and the sink write. */
export const ADVERTISED_BOUND_GRACE_MS = 30_000;

export interface AdvertisedRetryPolicy { readonly backoff?: string; readonly maxAttempts?: number; readonly maxElapsedMs?: unknown }

/** The advertised `retryPolicy.maxElapsedMs` (RFC 0225), or null when absent or not a positive integer. */
export function advertisedMaxElapsedMs(policy: AdvertisedRetryPolicy | null): number | null {
  const v = policy?.maxElapsedMs;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/** Whether a wait of `waitedMs` reached past the host's advertised bound plus the grace — the only point a row may convict. */
export function pastAdvertisedBound(policy: AdvertisedRetryPolicy | null, waitedMs: number): boolean {
  const bound = advertisedMaxElapsedMs(policy);
  return bound !== null && waitedMs >= bound + ADVERTISED_BOUND_GRACE_MS;
}

export function retryWaitCapMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[RETRY_WAIT_ENV]);
  if (!Number.isFinite(raw) || raw < DEFAULT_RETRY_WAIT_CAP_MS) return DEFAULT_RETRY_WAIT_CAP_MS;
  return Math.min(Math.floor(raw), MAX_RETRY_WAIT_CAP_MS);
}

/**
 * The floor stays 20 s so a host that advertises nothing is measured exactly as
 * before; an advertised `exponential` / `fixed` backoff widens it to the cap.
 */
export function retryWaitFor(policy: AdvertisedRetryPolicy | null, capMs: number): number {
  if (policy === null) return RETRY_WAIT_FLOOR_MS;
  const bound = advertisedMaxElapsedMs(policy);
  if (bound !== null) return Math.min(MAX_RETRY_WAIT_MS, Math.max(bound + ADVERTISED_BOUND_GRACE_MS, capMs));
  const backoff = String(policy.backoff ?? '');
  return backoff === 'exponential' || backoff === 'fixed' ? Math.min(MAX_RETRY_WAIT_MS, capMs) : RETRY_WAIT_FLOOR_MS;
}

/**
 * The longest `retryWaitFor` can return, whatever a host advertises or an
 * operator sets (suite 2.44.1).
 *
 * vitest fixes a test's timeout when the test is REGISTERED, before any
 * discovery document is read, so a timeout cannot follow the host's advertised
 * `maxElapsedMs`. 2.44.0 derived them from the cap alone (90 s by default):
 * a host advertising 600000 had its dead-letter leg killed at 210 s ("Test
 * timed out in 210000ms"), before its own bound plus the grace elapsed. That is
 * the 2.0.2 defect again: a wait longer than the timeout that governs it. The
 * timeout is only a backstop — every wait is bounded by its own window — so it
 * is derived from the largest window instead.
 */
export const MAX_RETRY_WAIT_MS = MAX_RETRY_WAIT_CAP_MS;

/** The timeout for a test that runs `waits` sequential retry waits, plus `slackMs` for the HTTP round trips around them. */
export function retryTestTimeoutMs(waits: number, slackMs: number): number {
  return waits * MAX_RETRY_WAIT_MS + slackMs;
}

/** What a row says when its window closed before the host's schedule did. Computed, so the numbers a host reads are the ones the run used. */
export function windowClosedNote(seen: number, maxAttempts: number, waitedMs: number, capMs: number): string {
  const raised = capMs > DEFAULT_RETRY_WAIT_CAP_MS;
  return `${seen} of the advertised ${maxAttempts} attempts arrived inside the ${waitedMs}ms this scenario waits, and the delivery is not in the sink yet. `
    + 'webhooks.retryPolicy advertises no maxElapsedMs (RFC 0225), so the suite cannot tell a slow conformant schedule from a host that stopped retrying, and it does not convict on a deadline it chose. A host can advertise retryPolicy.maxElapsedMs to have its own bound used. '
    + (raised
      ? `${RETRY_WAIT_ENV} is already raised to ${capMs}ms; set it above the SUM of this host's backoff intervals (at most ${MAX_RETRY_WAIT_CAP_MS}ms).`
      : `Set ${RETRY_WAIT_ENV} above the SUM of this host's backoff intervals (default ${DEFAULT_RETRY_WAIT_CAP_MS}ms; it can be raised, never lowered) and re-run.`);
}
