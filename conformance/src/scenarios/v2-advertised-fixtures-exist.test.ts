/**
 * `spec/v2/core/conformance.md` — an advertised conformance fixture is a claim
 * the host must be able to honour (suite 2.0.0, target major 2; unaided).
 *
 * `fixtures[]` in discovery gates scenarios: `isFixtureAdvertised(id)` decides
 * whether a scenario runs at all. Nothing checked that an advertised id names a
 * fixture the corpus actually defines, or that the host can serve it. A host
 * whose advertised list and seeded set drift apart therefore fails somewhere
 * else entirely — the scenario gated on the missing fixture attempts, fails on
 * a run that cannot be created, and the failure is attributed to that
 * scenario's requirement rather than to the advertisement that was wrong.
 *
 * No host is currently known to exhibit this. A tier-2 host was thought to
 * (46 seeded against 47 advertised) and then verified and retracted it — the
 * count had been eyeballed from an array literal rather than measured, and the
 * two sets are in fact identical. The scenario is kept because the failure mode
 * is a property of the gating mechanism, not of that host: `fixtures[]` decides
 * whether a scenario runs, so a wrong advertisement is charged to whatever runs
 * next. Leg 1 is also the stronger check — an id the corpus catalog does not
 * define is wrong however well a host's own two lists agree with each other.
 *
 * Two legs, both cheap:
 *   1. the advertised ids are a subset of the corpus fixture catalog — the
 *      vocabulary is closed, so an id the corpus does not define is a typo or
 *      an invention, not a capability;
 *   2. a bounded sample of advertised fixtures is actually creatable, so the
 *      list is a claim about reachable state rather than a wish.
 *
 * @see spec/v2/core/conformance.md
 * @see conformance/fixtures.md
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { FIXTURES_DIR } from '../lib/paths.js';

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
  it('every advertised fixture id is one the corpus defines', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const ids = advertisedIds(doc);
    if (ids.length === 0) return softSkip('inapplicable', 'the host advertises no fixtures[] — there is no claim to falsify');
    if (FIXTURES_DIR === null || !existsSync(FIXTURES_DIR)) {
      return softSkip('blocked', 'the fixture catalog is absent from this layout, so an advertised id cannot be checked against it');
    }
    const catalog = new Set(
      readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, '')),
    );
    const unknown = ids.filter((id) => !catalog.has(id));
    expect(
      unknown,
      req(ID, DOC, `every id in fixtures[] MUST name a fixture the corpus defines — the vocabulary is closed, so an id the catalog does not carry is a typo or an invention rather than a capability (${unknown.length} unknown of ${ids.length}: ${unknown.slice(0, 5).join(', ')})`),
    ).toEqual([]);
  });

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
