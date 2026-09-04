/**
 * `spec/v2/core/conformance.md` — an advertised conformance fixture is a claim
 * the host must be able to honour (suite 2.0.0, target major 2; unaided).
 *
 * `fixtures[]` in discovery gates scenarios: `isFixtureAdvertised(id)` decides
 * whether a scenario runs at all. So a host whose advertised list and seeded set
 * drift apart fails somewhere else entirely — the scenario gated on the missing
 * fixture attempts, fails on a run that cannot be created, and the failure is
 * attributed to that scenario's requirement rather than to the advertisement
 * that was wrong. That misattribution is what this scenario exists to catch.
 *
 * **This scenario shipped with a second leg that was wrong, and the correction
 * matters more than the check.** That leg asserted the advertised ids are a
 * SUBSET of `conformance/fixtures/` — "the vocabulary is closed, so an id the
 * corpus does not define is a typo or an invention". The vocabulary is not
 * closed. Host-supplied fixtures are the normal case: dozens of ids the
 * scenarios gate on are deliberately not shipped, and `v2-approver-enforced`
 * says so in its own docstring — it needs an approval fixture whose
 * `approversList` names a principal the suite is not, and records `blocked`
 * naming it precisely because "no such fixture ships in `conformance/fixtures/`".
 *
 * So the leg failed a host for doing exactly what the corpus asks. It was found
 * by running the suite against the reference host, which advertised two
 * host-supplied fixtures and was marked non-conformant for it. Set membership
 * cannot distinguish a typo from a legitimate host fixture, and a check that
 * cannot tell those apart is not a check — it is a coin flip that happens to
 * land on "fail" for correct hosts.
 *
 * What survives is the leg that was always sound: an advertised fixture MUST be
 * creatable. That holds whoever defines it, and it is the one that catches the
 * drift the misattribution comes from.
 *
 * @see spec/v2/core/conformance.md
 * @see conformance/src/scenarios/v2-approver-enforced.test.ts (a host-supplied fixture, by design)
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0168.advertised-fixtures-exist';
const DOC = 'spec/v2/core/conformance.md §Fixtures';
/** Creating one run per advertised fixture would be a load test, not a check. */
const SAMPLE = 5;

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function advertisedIds(doc: Record<string, unknown>): string[] {
  const raw = doc['fixtures'];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

describe('v2-advertised-fixtures-exist (conformance.md §Fixtures)', () => {
  it('a sampled advertised fixture is actually creatable, not just listed', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const ids = advertisedIds(doc);
    if (ids.length === 0) return softSkip('inapplicable', 'the host advertises no fixtures[]');

    // Deterministic sample: the first N by sort order, so a failure is
    // reproducible and a host cannot pass by luck of ordering.
    const sample = [...ids].sort().slice(0, SAMPLE);
    const unreachable: string[] = [];
    let attempted = 0;
    for (const id of sample) {
      const res = await http(() => driver.post('/runs', { workflowId: id, inputs: {} }));
      if (res === null) {
        return softSkip('blocked', `POST /runs was unreachable while sampling advertised fixtures (stopped at ${id})`);
      }
      attempted += 1;
      // 201 is the claim honoured. A 4xx that names the workflow as unknown is
      // the drift this leg exists to catch; any other status is a different
      // problem and is not judged here.
      if (res.status !== 201) unreachable.push(`${id} → ${res.status}`);
    }
    if (attempted === 0) return softSkip('blocked', 'no advertised fixture could be attempted');
    expect(
      unreachable,
      req(ID, DOC, `an advertised fixture MUST be creatable: fixtures[] gates whether a scenario runs at all, so a listed-but-unseeded fixture makes some OTHER scenario fail on a run that cannot exist, and the failure is attributed to the wrong requirement (${unreachable.length} of ${attempted} sampled: ${unreachable.join(', ')})`),
    ).toEqual([]);
  });
});
