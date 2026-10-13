/**
 * v2 — the `agents.fanOut` seat (RFC 0243; its rules are the facet's
 * description in `spec/v2/facets/agents.schema.json`, `execution.md` §agents).
 *
 * Two legs:
 *
 *   1. Claims-check: a host advertising `agents.fanOut` advertises
 *      `agents.dispatch: true`. The leg is `agentsFanOutDispatchLeg` in
 *      `lib/family-advert-witness.ts` (wave 5).
 *   2. The refusal: a `core.dispatch` node pinning `fanOutPolicy: 'parallel'`
 *      with a `race` join is refused where the host does not admit it, and
 *      `details.requiredCapability` names the missing seat. v2 has no
 *      registration endpoint, so the refusal at load is not observable from
 *      outside. The suite observes the fallback: on a host advertising the
 *      fixture `conformance-dispatch-fanout-race`, if `getWorkflow` reads it,
 *      `createRun` naming it answers `400 validation_error` and creates no
 *      run. An unadvertised fixture, or one `getWorkflow` answers 404 for
 *      (refused at load), is `inapplicable`.
 *
 * @see spec/v2/facets/agents.schema.json §fanOut
 * @see RFCS/0243-dispatch-fan-out-seat.md
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { majorProfile } from '../lib/major-profile.js';
import { agentsFanOutDispatchLeg, fanOutRefusalSeats } from '../lib/family-advert-witness.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const DOC = 'agents.schema.json §fanOut';
const ID_DISPATCH = 'openwop.requirement.0243.fan-out-needs-dispatch';
const ID_REFUSED = 'openwop.requirement.0243.unadmitted-fan-out-refused';
const FIXTURE = 'conformance-dispatch-fanout-race';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

describe('v2 agents.fanOut (RFC 0243)', () => {
  it('a host advertising agents.fanOut advertises agents.dispatch: true', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('agents'))) return softSkip('inapplicable', 'the host does not advertise agents');
    const out = agentsFanOutDispatchLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_DISPATCH, x.doc, x.message)).toBe(true);
  });

  it('a readable workflow pinning an unadmitted fan-out is refused at createRun with validation_error naming the seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const agents = doc['agents'];
    if (!isRecord(agents) || agents['dispatch'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.dispatch: true, so it runs no core.dispatch node');
    const seats = fanOutRefusalSeats(agents, 'race', 'collect');
    if (seats === null) return softSkip('inapplicable', 'the host admits a parallel race join with collect, so the fixture is not refused');

    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `the host does not advertise fixture ${FIXTURE}`);

    const wf = await http(() => driver.get(`/workflows/${FIXTURE}`));
    if (wf === null) return softSkip('blocked', 'GET /workflows unreachable (fetch failed)');
    if (wf.status === 404) return softSkip('inapplicable', `${FIXTURE} is not readable: refused at load, or not seeded`);
    if (wf.status !== 200) return softSkip('blocked', `GET /workflows/${FIXTURE} answered ${wf.status}`);

    const res = await http(() => driver.post('/runs', { workflowId: FIXTURE }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const runId = (res.json as { runId?: unknown } | undefined)?.runId;
    if (res.status === 201 && typeof runId === 'string') await http(() => driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {}));

    expect(res.status, req(ID_REFUSED, DOC, `createRun naming a readable workflow the host does not admit MUST return 400 (got ${res.status} ${readErrorCode(res.json) ?? ''})`.trim())).toBe(400);
    expect(readErrorCode(res.json), req(ID_REFUSED, DOC, 'the refusal MUST carry validation_error')).toBe('validation_error');
    const details = isRecord(res.json) && isRecord(res.json['details']) ? res.json['details'] : {};
    expect(seats, req(ID_REFUSED, DOC, `details.requiredCapability MUST name the missing seat, one of ${seats.join(', ')} (got ${JSON.stringify(details['requiredCapability'])})`)).toContain(details['requiredCapability']);
  });
});
