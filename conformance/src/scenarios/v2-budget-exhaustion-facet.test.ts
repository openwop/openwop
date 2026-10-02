/**
 * v2 — a host that lists `budget.onExhaustion` serves exactly those values
 * (RFC 0231; `spec/v2/core/runs.md` §Refusals). The logic is
 * `lib/exhaustion-facet-witness.ts`.
 *
 *   contains-fail   the advertised list is a non-empty list of `fail` and
 *                   `interrupt`, and contains `fail`.
 *   refused         where the list leaves out `interrupt`, a create with
 *                   `budget.onExhaustion: "interrupt"` answers
 *                   `422 capability_not_provided`. Unaided: one create, and a
 *                   conforming host starts no run.
 *
 * Dispositions: no `budget`, no `onExhaustion` list, or `enforce` not `hard`
 * ⇒ `inapplicable`. A list that includes `interrupt` ⇒ the refusal leg is
 * `inapplicable`; the served path is not witnessed (RFC 0231 gap G2). No
 * advertised fixture ⇒ the refusal leg is `inapplicable`, since the suite has
 * no workflow to name.
 *
 * No major-1 twin: `lib/major-profile.ts` gives a major-1 run budget no
 * `createRun` surface the suite drives.
 *
 * Proven both ways against the scratch host in
 * `lib/exhaustion-facet-witness.test.ts`.
 *
 * @see spec/v2/core/runs.md §Refusals
 * @see RFCS/0231-budget-exhaustion-facet.md
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { drive, judge, type FacetFinding, type FacetRun } from '../lib/exhaustion-facet-witness.js';

const PROFILE = majorProfile(2);
const ID_CONTAINS_FAIL = 'openwop.requirement.runs.budget-exhaustion-facet-contains-fail';
const ID_REFUSED = 'openwop.requirement.runs.budget-unserved-exhaustion-refused';

/** One observation per file: both legs read it. */
let once: Promise<FacetRun> | undefined;
function facetRun(): Promise<FacetRun> {
  once ??= (async (): Promise<FacetRun> => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return { kind: 'skip', disposition: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
    return drive(PROFILE, doc);
  })();
  return once;
}

type Leg = { readonly skip: readonly ['inapplicable' | 'blocked', string] } | { readonly findings: FacetFinding[] };
async function leg(rule: FacetFinding['rule'], absent: string): Promise<Leg> {
  const r = await facetRun();
  if (r.kind === 'skip') return { skip: [r.disposition, r.reason] };
  const findings = judge(PROFILE, r.observation).filter((f) => f.rule === rule);
  return findings.length === 0 ? { skip: ['inapplicable', absent] } : { findings };
}

describe('v2 budget exhaustion facet (RFC 0231; runs.md §Refusals)', () => {
  it('an advertised budget.onExhaustion contains fail', async () => {
    const l = await leg('contains-fail', 'budget.onExhaustion is not advertised');
    if ('skip' in l) return softSkip(...l.skip);
    for (const f of l.findings) expect(f.ok, req(ID_CONTAINS_FAIL, f.doc, f.message)).toBe(true);
  });

  it('an onExhaustion value the host does not list is refused 422 capability_not_provided', async () => {
    const l = await leg('refused', 'budget.onExhaustion lists interrupt — the host serves it, and the served path has no witness (RFC 0231 gap G2)');
    if ('skip' in l) return softSkip(...l.skip);
    for (const f of l.findings) expect(f.ok, req(ID_REFUSED, f.doc, f.message)).toBe(true);
  });
});
