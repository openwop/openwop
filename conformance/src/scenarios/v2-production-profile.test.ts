/**
 * v2 — the `production` bar beyond backpressure
 * (`spec/v2/core/conformance.md` §Production profile). Gated on `production`.
 *
 * `v2-production-backpressure` witnesses the `backpressure` facet. This file
 * takes the two other rules a suite can cause:
 *
 *   idempotency   "MUST tolerate at least five retries of one `Idempotency-Key`
 *                 within its retention". Unaided: one `createRun` under a fresh
 *                 key, then five sequential retries with the same key and the
 *                 same bytes. Every retry answers the first response's status
 *                 with the same `runId` and `OpenWOP-Idempotent-Replay: true`
 *                 (`idempotency.md` §Outcomes, `runs.md` §Request headers). A
 *                 host that evicts after a retry count, answers a later retry
 *                 `409`, or mints a second run fails. Within retention: the
 *                 retries land seconds after the first, and a record MUST be
 *                 kept 24 hours.
 *   retention     `retention` facet: "An expired run MUST answer `404
 *                 not_found` or `410 run_expired`". Expiry takes at least seven
 *                 days on a public host, so this leg is operator-aided, as at
 *                 v1 (`production-retention-expiry`): `OPENWOP_TEST_EXPIRED_RUN_ID`
 *                 names a run already expired, or — where the host advertises
 *                 `retention.testForceExpire: true` —
 *                 `OPENWOP_TEST_FORCE_EXPIRE_URL` (`{runId}` substituted, method
 *                 `OPENWOP_TEST_FORCE_EXPIRE_METHOD`, default `POST`) expires a
 *                 run the suite just created.
 *
 * Not here, and why: `debugBundle` has no v2 read (RFC 0207 §C.11 — no
 * operation in `api/v2/openapi.yaml`), so its redaction and truncation rules
 * have no wire to witness at major 2. Persistence across restart needs a
 * process kill (RFC 0158's seam), and the logging rule is not observable.
 *
 * Dispositions: no `production` ⇒ `inapplicable` (gate
 * `openwop.family.production`). No `retention` facet, or a host that offers no
 * expiry seam and an operator who named no expired run ⇒ `inapplicable` (the
 * facet is the opt-in, as a fixture is). `testForceExpire: true` with no URL
 * supplied, a create refused, or a force-expire refused ⇒ `blocked`.
 *
 * @see spec/v2/core/conformance.md §Production profile
 * @see spec/v2/core/idempotency.md §Outcomes
 * @see conformance/fixtures.md §conformance-idempotent
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { gateFamily } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID_RETRIES = 'openwop.requirement.0009.idempotency-five-retries';
const ID_EXPIRED = 'openwop.requirement.0009.retention-expired-run';
const DOC = 'spec/v2/core/conformance.md §Production profile';
const IDEMPOTENT = 'conformance-idempotent';
const NOOP = 'conformance-noop';
const RETRIES = 5;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
const runIdOf = (r: OpenWOPResponse): unknown => (isRecord(r.json) ? r.json['runId'] : undefined);

describe('v2 production profile (conformance.md §Production profile)', () => {
  it('a host claiming production replays one Idempotency-Key across five retries without a second run', async () => {
    if ((await gateFamily('production')) === null) return softSkip('inapplicable', 'the host does not advertise production (gate recorded under openwop.family.production)');
    // conformance-idempotent is the fixture made for this (fixtures.md); noop is the fallback every host seeds.
    const body = isFixtureAdvertised(IDEMPOTENT) ? { workflowId: IDEMPOTENT, inputs: { nonce: randomUUID() } } : { workflowId: NOOP };
    const headers = { 'Idempotency-Key': randomUUID() };

    const first = await http(() => driver.post('/runs', body, { headers }));
    if (first === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (first.status === 429 || first.status >= 500) return softSkip('blocked', `the first create answered ${first.status} — a retryable outcome is never cached, so there is no record to retry against`);
    const runId = runIdOf(first);
    if (first.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs {workflowId: ${body.workflowId}} answered ${first.status} ${readErrorCode(first.json) ?? ''} — the create was refused (fixture not seeded?)`.trim());

    for (let i = 1; i <= RETRIES; i++) {
      const retry = await http(() => driver.post('/runs', body, { headers }));
      expect(retry, req(ID_RETRIES, DOC, `retry ${i} of ${RETRIES} under one Idempotency-Key MUST be answered (fetch failed)`)).not.toBeNull();
      if (retry === null) continue;
      expect(retry.status, req(ID_RETRIES, 'spec/v2/core/idempotency.md §Outcomes', `retry ${i} of ${RETRIES} MUST return the cached response — status ${first.status} — not ${retry.status} ${readErrorCode(retry.json) ?? ''}`.trim())).toBe(first.status);
      expect(runIdOf(retry), req(ID_RETRIES, 'spec/v2/core/runs.md §Request headers', `retry ${i} of ${RETRIES}: a replayed create MUST NOT create a second run — the cached body names ${runId}`)).toBe(runId);
      expect(retry.headers.get('openwop-idempotent-replay'), req(ID_RETRIES, 'spec/v2/core/idempotency.md §Outcomes', `retry ${i} of ${RETRIES} is served from cache and MUST carry OpenWOP-Idempotent-Replay: true`)).toBe('true');
    }
  });

  it('an expired run answers 404 not_found or 410 run_expired', async () => {
    const production = await gateFamily('production');
    if (production === null) return softSkip('inapplicable', 'the host does not advertise production (gate recorded under openwop.family.production)');
    const retention = production['retention'];
    if (!isRecord(retention)) return softSkip('inapplicable', 'the host does not advertise production.retention — the expiry rule binds the retention facet');

    let expired = process.env['OPENWOP_TEST_EXPIRED_RUN_ID'];
    if (expired === undefined) {
      if (retention['testForceExpire'] !== true) return softSkip('inapplicable', 'production.retention.testForceExpire is not true and OPENWOP_TEST_EXPIRED_RUN_ID is unset — the host offers no expiry seam and expiry takes at least 7 days, so the rule is not reachable from outside');
      const url = process.env['OPENWOP_TEST_FORCE_EXPIRE_URL'];
      if (url === undefined) return softSkip('blocked', 'the host advertises retention.testForceExpire, but OPENWOP_TEST_FORCE_EXPIRE_URL is unset — the operator has not said where the hook is');
      const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
      const runId = created === null ? undefined : runIdOf(created);
      if (created === null || created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created?.status ?? 'no response'} — there is no run to expire`);
      const forced = await http(() => driver.request(process.env['OPENWOP_TEST_FORCE_EXPIRE_METHOD'] ?? 'POST', url.replace('{runId}', encodeURIComponent(runId))));
      if (forced === null || forced.status < 200 || forced.status >= 300) return softSkip('blocked', `the force-expire hook answered ${forced?.status ?? 'no response'} — the run was not expired`);
      expired = runId;
    }

    const target: string = expired;
    const res = await http(() => driver.get(`/runs/${encodeURIComponent(target)}`));
    if (res === null) return softSkip('blocked', 'GET /runs/{expiredRunId} unreachable (fetch failed)');
    const code = readErrorCode(res.json);
    expect(
      (res.status === 404 && code === 'not_found') || (res.status === 410 && code === 'run_expired'),
      req(ID_EXPIRED, DOC, `an expired run MUST answer 404 not_found or 410 run_expired through the error envelope (got ${res.status} ${code ?? 'no code'})`),
    ).toBe(true);
    expect(typeof (isRecord(res.json) ? res.json['message'] : undefined), req(ID_EXPIRED, 'spec/v2/core/errors.md', 'the refusal is the canonical envelope: message is a string')).toBe('string');
  });
});
