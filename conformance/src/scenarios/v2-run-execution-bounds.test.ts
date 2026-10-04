/**
 * v2 — run execution bounds (`spec/v2/core/runs.md` §`run` section; RFC 0058).
 * The v1 twin is `run-execution-bounds-shape`; the legs live in
 * `lib/run-bounds-witness.ts`, and what differs between majors (the run path,
 * the closed `configurable` shape, the event name) is the profile row.
 *
 *   shape     advertised `limits.maxRunDurationMs` (≥ 1000) and
 *             `limits.maxLoopIterations` (≥ 1) are well-formed;
 *   refused   NEW at v2, unaided: `configurable.run.runTimeoutMs: 0` is refused
 *             `400 validation_error` at create (`runs.md`: "An out-of-range
 *             recursionLimit or runTimeoutMs MUST return 400");
 *   breach    the `conformance-run-duration-breach` fixture with a 1 s timeout
 *             ends `failed` / `run_timeout` and emits `cap.breached
 *             { kind: 'run-duration' }` with `observed > limit`.
 *
 * Dispositions: `limits` not advertised, or neither facet ⇒ shape
 * `inapplicable`; no advertised fixture to name ⇒ refused `inapplicable`; the
 * breach fixture unadvertised ⇒ breach `inapplicable` (the fixture is the
 * opt-in, as for the budget and table-schema witnesses).
 *
 * Proven against a scratch double in `lib/run-bounds-witness.test.ts`.
 *
 * @see spec/v2/core/runs.md §run section, §Limits
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { getAdvertisedFixtures } from '../lib/fixtures.js';
import { majorProfile } from '../lib/major-profile.js';
import { driveBreach, judgeBreach, refusedLeg, shapeLeg, TIMEOUT_FIXTURE } from '../lib/run-bounds-witness.js';

const PROFILE = majorProfile(2);
const ID_SHAPE = 'openwop.requirement.runs.limits-bounds-shape';
const ID_REFUSED = 'openwop.requirement.runs.run-timeout-out-of-range-refused';
const ID_BREACH = 'openwop.requirement.runs.run-timeout-breach';

/** Any advertised fixture names a valid workflow, so a refusal can only be about runTimeoutMs. */
function aFixture(): string | undefined {
  const all = [...(getAdvertisedFixtures() ?? [])].sort();
  return all.includes('conformance-noop') ? 'conformance-noop' : all.includes(TIMEOUT_FIXTURE) ? TIMEOUT_FIXTURE : all[0];
}

describe('v2 run execution bounds (runs.md §run section)', () => {
  it('advertised limits.maxRunDurationMs and maxLoopIterations are well-formed', async () => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if (!(await familyAdvertised('limits'))) return softSkip('inapplicable', 'the host does not advertise limits');
    const out = shapeLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SHAPE, x.doc, x.message)).toBe(true);
  });

  it('an out-of-range runTimeoutMs is refused 400 validation_error at create', async () => {
    const out = await refusedLeg(PROFILE, aFixture());
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_REFUSED, x.doc, x.message)).toBe(true);
  });

  it('a run exceeding runTimeoutMs fails run_timeout with cap.breached { kind: run-duration }', async () => {
    const o = await driveBreach(PROFILE);
    if ('kind' in o) return softSkip(o.disposition, o.reason);
    for (const x of judgeBreach(o)) expect(x.ok, req(ID_BREACH, x.doc, x.message)).toBe(true);
  }, 60_000);
});
