/**
 * `spec/v2/core/idempotency.md` Concurrency row — the loser of a same-key race
 * (RFC 0213 §B; suite 2.37.0, target major 2; unaided; one run created).
 *
 * Of concurrent same-key requests a host MUST process exactly one. The others
 * MAY wait and receive the winner's response only if it is a final outcome,
 * marked `OpenWOP-Idempotent-Replay: true`; otherwise the host MUST answer
 * `409 idempotency_in_flight` with no retry timing in `details`, and SHOULD set
 * `Retry-After`. The v2 counterpart of the major-1 `highConcurrency.test.ts`.
 *
 * N = 5 parallel `POST /runs` with one key. The record is in flight only
 * while the winning create request is being handled — not while its run
 * executes — so a host that answers create in milliseconds rarely refuses a
 * loser; the fixture choice does not widen that window:
 *   - exactly one distinct runId across the successes (two runs = the claim
 *     was not honored);
 *   - every success but one carries `OpenWOP-Idempotent-Replay: true`;
 *   - every refusal is `409 idempotency_in_flight`, carries no
 *     `details.retryAfter*`, and a `Retry-After`, when present, parses.
 *
 * Non-vacuity: overlap is not guaranteed. When no request was refused in flight
 * the LOSER leg records `partial-witness` — the 409 branch never ran, so a pass
 * is not claimed for it.
 *
 * Two `it`s over ONE race (2.37.x). §B names two requirement ids and both were
 * cited from a single `it`, so only the last of them could ever get a ledger
 * row; the winner id was recorded on no host. The race is driven once and
 * memoised — driving it twice would measure two unrelated races and halve the
 * chance that either overlaps — and each leg now carries its own id, so the
 * winner clause keeps its verdict when the 409 branch does not run.
 *
 * @see spec/v2/core/idempotency.md
 * @see RFCS/0213-three-unstated-v2-outcomes.md §B
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/idempotency.md Concurrency';
const ID_ONE = 'openwop.requirement.0213.in-flight-one-winner';
const ID_LOSER = 'openwop.requirement.0213.in-flight-loser-outcome';
const FIXTURE = 'conformance-delay';
const N = 5;

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
function parsesRetryAfter(v: string): boolean { return /^\d+$/.test(v.trim()) || !Number.isNaN(Date.parse(v)); }

/** The race's outcome, or the reason it could not be driven. */
type Race =
  | { readonly kind: 'ran'; readonly all: readonly OpenWOPResponse[]; readonly successes: readonly OpenWOPResponse[]; readonly refusals: readonly OpenWOPResponse[] }
  | { readonly kind: 'blocked'; readonly reason: string };

/**
 * ONE race, read by both legs.
 *
 * RFC 0213 §B names two requirement ids, and until 2.37.x both were cited from
 * a SINGLE `it()`. The ledger keys on the id and `setup.ts` takes one
 * `explicitId` per test, so only the LAST one cited got a row:
 * `0213.in-flight-one-winner` was never recorded on any host, and nothing said
 * so. (Found by `check-req-only.mjs` rule (d) the moment it learned to resolve a
 * `const` handed to `req()` — it had compared only call-site literals, so the
 * violation was invisible when this file was written.)
 *
 * Splitting the legs must not split the EXERCISE: the record is in flight only
 * while the winning create is being handled, so driving the race twice would
 * measure two unrelated races and halve the chance that either overlaps. The
 * race is therefore memoised here and both legs await the same result — the
 * house pattern from `v2-subject-link-record.test.ts`.
 */
let race: Promise<Race> | undefined;
function theRace(): Promise<Race> {
  return (race ??= drive());
}

async function drive(): Promise<Race> {
  if (!(await discovery())) return { kind: 'blocked', reason: 'v2 discovery unreachable' };
  const key = `openwopconf-inflight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const body = { workflowId: FIXTURE, inputs: { delayMs: 1500 } };
  const results = await Promise.all(Array.from({ length: N }, () => http(() => driver.post('/runs', body, { headers: { 'Idempotency-Key': key } }))));
  if (results.some((r) => r === null)) return { kind: 'blocked', reason: 'POST /runs unreachable (fetch failed)' };
  const rs = results as OpenWOPResponse[];
  const first = rs.find((r) => r.status >= 200 && r.status < 300);
  if (first === undefined) {
    const codes = rs.map((r) => `${r.status} ${readErrorCode(r.json) ?? ''}`.trim()).join(', ');
    if (rs.every((r) => r.status === 404 || r.status === 422)) return { kind: 'blocked', reason: `the ${FIXTURE} fixture is not runnable (${codes})` };
  }
  return {
    kind: 'ran',
    all: rs,
    successes: rs.filter((r) => r.status >= 200 && r.status < 300),
    refusals: rs.filter((r) => !(r.status >= 200 && r.status < 300)),
  };
}

describe('v2 idempotency-in-flight (idempotency.md Concurrency, RFC 0213 §B)', () => {
  it('concurrent same-key creates yield exactly one run', async () => {
    const r = await theRace();
    if (r.kind === 'blocked') return softSkip('blocked', r.reason);
    expect(r.successes.length, req(ID_ONE, DOC, `at least one of ${N} same-key creates MUST complete (statuses: ${r.all.map((x) => x.status).join(',')})`)).toBeGreaterThan(0);
    const runIds = new Set(r.successes.map((x) => (x.json as { runId?: unknown } | null)?.runId).filter((x): x is string => typeof x === 'string'));
    expect(runIds.size, req(ID_ONE, DOC, `a host MUST NOT process two same-key requests: distinct runIds ${[...runIds].join(', ')}`)).toBe(1);
  }, 60_000);

  it('each loser is a marked replay of a final outcome, or 409 idempotency_in_flight with no retry timing in details', async () => {
    const r = await theRace();
    if (r.kind === 'blocked') return softSkip('blocked', r.reason);
    const unmarked = r.successes.filter((x) => x.headers.get('openwop-idempotent-replay') !== 'true');
    expect(unmarked.length, req(ID_LOSER, DOC, `exactly one success is the winner; every other MUST carry OpenWOP-Idempotent-Replay: true (${unmarked.length} of ${r.successes.length} unmarked)`)).toBe(1);
    for (const x of r.refusals) {
      const code = readErrorCode(x.json);
      expect({ status: x.status, code }, req(ID_LOSER, DOC, `a loser that is not a replay MUST be 409 idempotency_in_flight (got ${x.status} ${String(code)})`)).toEqual({ status: 409, code: 'idempotency_in_flight' });
      const details = (x.json as { details?: Record<string, unknown> } | null)?.details ?? {};
      const timing = Object.keys(details).filter((k) => /^retryAfter/i.test(k));
      expect(timing, req(ID_LOSER, 'spec/v2/core/errors.md §Retry timing', `retry timing MUST NOT travel in details (found ${timing.join(', ')})`)).toEqual([]);
      const ra = x.headers.get('retry-after');
      if (ra !== null) expect(parsesRetryAfter(ra), req(ID_LOSER, DOC, `a Retry-After that is present MUST parse (got ${ra})`)).toBe(true);
    }
    // Every loser replayed the winner: RFC 0213 §B permits exactly this (a
    // loser MAY wait and receive a final outcome, marked). The 409 branch did
    // not run, so the row is a partial witness — never `blocked`, which would
    // deny certification (RFC 0168 §E.1) to a host that did nothing wrong.
    // (#1525's fix, kept verbatim; `r.refusals` is the split form's spelling of
    // its `refusals`, and it now lands on the LOSER id it is about rather than
    // on a row shared with the winner clause.)
    if (r.refusals.length === 0) return softSkip('inapplicable', `no loser was refused in flight — all ${N} answers were successes (each loser a marked replay, which §B permits), so the 409 branch did not run on this host`);
  }, 60_000);
});
