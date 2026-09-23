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
 * the file records `partial-witness` — the 409 branch never ran, so a pass is
 * not claimed for it.
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

describe('v2 idempotency-in-flight (idempotency.md Concurrency, RFC 0213 §B)', () => {
  it('concurrent same-key creates yield one run; each loser is a marked replay of a final outcome or 409 idempotency_in_flight with no retry timing in details', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const key = `openwopconf-inflight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const body = { workflowId: FIXTURE, inputs: { delayMs: 1500 } };
    const results = await Promise.all(Array.from({ length: N }, () => http(() => driver.post('/runs', body, { headers: { 'Idempotency-Key': key } }))));
    if (results.some((r) => r === null)) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const rs = results as OpenWOPResponse[];
    const first = rs.find((r) => r.status >= 200 && r.status < 300);
    if (first === undefined) {
      const codes = rs.map((r) => `${r.status} ${readErrorCode(r.json) ?? ''}`.trim()).join(', ');
      if (rs.every((r) => r.status === 404 || r.status === 422)) return softSkip('blocked', `the ${FIXTURE} fixture is not runnable (${codes})`);
    }
    const successes = rs.filter((r) => r.status >= 200 && r.status < 300);
    const refusals = rs.filter((r) => !(r.status >= 200 && r.status < 300));
    expect(successes.length, req(ID_ONE, DOC, `at least one of ${N} same-key creates MUST complete (statuses: ${rs.map((r) => r.status).join(',')})`)).toBeGreaterThan(0);
    const runIds = new Set(successes.map((r) => (r.json as { runId?: unknown } | null)?.runId).filter((x): x is string => typeof x === 'string'));
    expect(runIds.size, req(ID_ONE, DOC, `a host MUST NOT process two same-key requests: distinct runIds ${[...runIds].join(', ')}`)).toBe(1);
    const unmarked = successes.filter((r) => r.headers.get('openwop-idempotent-replay') !== 'true');
    expect(unmarked.length, req(ID_LOSER, DOC, `exactly one success is the winner; every other MUST carry OpenWOP-Idempotent-Replay: true (${unmarked.length} of ${successes.length} unmarked)`)).toBe(1);
    for (const r of refusals) {
      const code = readErrorCode(r.json);
      expect({ status: r.status, code }, req(ID_LOSER, DOC, `a loser that is not a replay MUST be 409 idempotency_in_flight (got ${r.status} ${String(code)})`)).toEqual({ status: 409, code: 'idempotency_in_flight' });
      const details = (r.json as { details?: Record<string, unknown> } | null)?.details ?? {};
      const timing = Object.keys(details).filter((k) => /^retryAfter/i.test(k));
      expect(timing, req(ID_LOSER, 'spec/v2/core/errors.md §Retry timing', `retry timing MUST NOT travel in details (found ${timing.join(', ')})`)).toEqual([]);
      const ra = r.headers.get('retry-after');
      if (ra !== null) expect(parsesRetryAfter(ra), req(ID_LOSER, DOC, `a Retry-After that is present MUST parse (got ${ra})`)).toBe(true);
    }
    if (refusals.length === 0) return softSkip('blocked', `no loser was refused in flight — all ${N} answers were successes, so the 409 branch did not run on this host`);
  }, 60_000);
});
