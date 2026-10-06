/**
 * v2 — `dataResidency` admission control (`spec/v2/core/runs.md` §Refusals and
 * §`dataResidency`). The v1 twin is `data-residency-admission`.
 *
 * A host advertising `dataResidency` MUST honour or reject a `residency`
 * constraint on `POST /runs`, and MUST NOT accept and ignore one:
 *
 *   reject   a region outside `dataResidency.regions` answers
 *            `422 residency_unavailable` and creates no run;
 *   accept   a region inside `dataResidency.regions` is not refused for its
 *            residency: the create answers `201`.
 *
 * The legs drive the normative create route only; no seam. The refused region
 * is made up by the suite and checked against the advertised list, so it can
 * never collide with a real one. The accept leg posts the `conformance-noop`
 * fixture workflow; a host that does not install it answers 404 and the leg is
 * `inapplicable` rather than a pass. Physical confinement is an operator SHOULD
 * and cannot be observed on the wire.
 *
 * An empty `regions` list still binds the reject leg: the host honours
 * residency in no region, so every constraint MUST be refused. Until 2.45.22
 * both legs skipped on an empty list, so a host advertising no region that
 * silently accepted and ignored every constraint passed.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `dataResidency` absent or a
 * malformed `regions` ⇒ `inapplicable`; an empty `regions` ⇒ `inapplicable` for
 * the accept leg only; a 429 ⇒ `blocked` (the run budget, not the wire).
 *
 * @see spec/v2/core/runs.md §Refusals
 * @see spec/v2/core/runs.md §`dataResidency`
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';

const DOC = 'spec/v2/core/runs.md §dataResidency';
const ID_REJECT = 'openwop.requirement.data-residency.reject-unadvertised-region';
const ID_ACCEPT = 'openwop.requirement.data-residency.accept-advertised-region';
const NOOP = 'conformance-noop';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** The advertised regions, or a skip reason. */
async function advertisedRegions(): Promise<string[] | { disposition: 'blocked' | 'inapplicable'; reason: string }> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { disposition: 'blocked', reason: UNREADABLE };
  const rec = await familyAdvertised('dataResidency');
  if (!rec) return { disposition: 'inapplicable', reason: 'the host does not advertise dataResidency' };
  // An empty list is a claim, not an absence: the host honours residency in no
  // region, so it MUST refuse every residency constraint. Only a malformed list
  // is left to the record leg.
  if (!Array.isArray(rec['regions'])) return { disposition: 'inapplicable', reason: 'dataResidency.regions is not an array (the record leg owns that)' };
  return rec['regions'].filter((r): r is string => typeof r === 'string' && r.length > 0);
}

/** Cancel a run the host created, so a failing row leaves nothing behind. */
async function cancelIfCreated(res: OpenWOPResponse): Promise<string | undefined> {
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (typeof runId !== 'string') return undefined;
  await http(() => driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {}));
  return runId;
}

describe('v2 dataResidency admission (runs.md §dataResidency)', () => {
  it('a region outside dataResidency.regions answers 422 residency_unavailable and creates no run', async () => {
    const regions = await advertisedRegions();
    if (!Array.isArray(regions)) return softSkip(regions.disposition, regions.reason);
    let bogus = 'zz-conformance-nowhere';
    while (regions.includes(bogus)) bogus += '-x';

    const res = await http(() => driver.post('/runs', { workflowId: NOOP, residency: { region: bogus } }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const runId = await cancelIfCreated(res);

    expect(res.status, req(ID_REJECT, DOC, `an unadvertised region ("${bogus}") MUST be refused with 422 (got ${res.status} ${readErrorCode(res.json) ?? ''})`.trim())).toBe(422);
    expect(readErrorCode(res.json), req(ID_REJECT, DOC, 'the refusal MUST carry the registered code residency_unavailable')).toBe('residency_unavailable');
    expect(runId, req(ID_REJECT, DOC, `a refused residency request MUST create no run (the response carried runId ${String(runId)})`)).toBeUndefined();
  });

  it('a region inside dataResidency.regions is accepted', async () => {
    const regions = await advertisedRegions();
    if (!Array.isArray(regions)) return softSkip(regions.disposition, regions.reason);
    const region = regions[0];
    if (region === undefined) return softSkip('inapplicable', 'dataResidency.regions is empty: there is no advertised region to accept (the reject leg still binds)');

    const res = await http(() => driver.post('/runs', { workflowId: NOOP, residency: { region } }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    await cancelIfCreated(res);
    if (res.status === 404 && readErrorCode(res.json) !== 'residency_unavailable') {
      return softSkip('inapplicable', `the host does not install the ${NOOP} fixture workflow (404 ${readErrorCode(res.json) ?? ''}); the accept leg needs a workflow to create`.trim());
    }

    expect(readErrorCode(res.json), req(ID_ACCEPT, DOC, `an advertised region ("${region}") MUST NOT be refused residency_unavailable`)).not.toBe('residency_unavailable');
    expect(res.status, req(ID_ACCEPT, DOC, `a create with an advertised region MUST answer 201 (got ${res.status} ${readErrorCode(res.json) ?? ''})`.trim())).toBe(201);
  });
});
