/**
 * v2 — a run budget is reserved, crossed, exhausted and enforced
 * (`spec/v2/core/runs.md` §`budget` section). The v1 twin is
 * `budget-enforcement`, which drives a host seam; at major 2 the budget rides
 * on `createRun` (`configurable.budget`), so this witness is unaided. The
 * logic is `lib/budget-witness.ts`; what differs between majors is the profile
 * row in `lib/major-profile.ts`.
 *
 * The suite creates a run of `conformance-budget-tool-calls` (three scripted
 * tool calls) with `{ maxToolCalls: 2, thresholdPercent: 50, onExhaustion:
 * "fail" }` and reads its log through the poll.
 *
 *   lifecycle     `budget.reserved`, `budget.threshold-crossed` (numeric
 *                 `percent`) and `budget.exhausted`, in that order. Both
 *                 enforce modes owe these.
 *   enforcement   `enforce: hard`: `cap.breached` with kind
 *                 `budget-tool-calls`, not before `budget.exhausted`, and the
 *                 run fails `budget_exhausted`. `enforce: advisory`: the run is
 *                 not stopped.
 *   content-free  no `budget.*` or `cap.breached` payload carries a rate card,
 *                 a unit price or a credential.
 *
 * Dispositions: no `budget`, `toolCalls` not in `budget.dimensions`, or the
 * fixture unadvertised ⇒ `inapplicable`. The fixture is the opt-in: a host
 * that advertises `budget` and has not seeded it is unwitnessed here, not
 * blocked. A valid budgeted create that is refused ⇒ `executed-fail`.
 *
 * Not ported: v1's model-denied leg (`budget_model_denied`). It needs a
 * fixture that resolves a model, and none does so without a seam.
 *
 * Proven both ways against the scratch host in `lib/budget-witness.test.ts`.
 *
 * @see spec/v2/core/runs.md §`budget` section
 * @see conformance/fixtures.md §conformance-budget-tool-calls
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { drive, judge, type BudgetRun, type Finding } from '../lib/budget-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'spec/v2/core/runs.md §budget section';
const ID_LIFECYCLE = 'openwop.requirement.runs.budget-lifecycle';
const ID_ENFORCEMENT = 'openwop.requirement.runs.budget-enforcement';
const ID_CONTENT_FREE = 'openwop.requirement.runs.budget-content-free';

/** One budgeted run per file: three legs read the same log. */
let once: Promise<BudgetRun> | undefined;
function budgetRun(): Promise<BudgetRun> {
  once ??= (async (): Promise<BudgetRun> => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return { kind: 'skip', disposition: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
    return drive(PROFILE, doc);
  })();
  return once;
}

type Leg = { readonly skip: { readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string } } | { readonly findings: Finding[] };

/** The findings for one leg, or why there are none. A refused create fails the leg here. */
async function leg(id: string, rules: ReadonlyArray<Finding['rule']>): Promise<Leg> {
  const r = await budgetRun();
  if (r.kind === 'skip') return { skip: { disposition: r.disposition, reason: r.reason } };
  if (r.kind === 'refused') {
    expect(r.status, req(id, DOC, `a host that advertises budget and the fixture MUST accept a valid configurable.budget (got ${r.status} ${r.code ?? ''})`.trim())).toBe(201);
    return { findings: [] }; // unreachable: a refusal is never 201
  }
  return { findings: judge(PROFILE, r.observation).filter((f) => rules.includes(f.rule)) };
}

describe('v2 budget enforcement (runs.md §budget section)', () => {
  it('a budgeted run emits budget.reserved, budget.threshold-crossed and budget.exhausted in order', async () => {
    const l = await leg(ID_LIFECYCLE, ['lifecycle']);
    if ('skip' in l) return softSkip(l.skip.disposition, l.skip.reason);
    for (const f of l.findings) expect(f.ok, req(ID_LIFECYCLE, f.doc, f.message)).toBe(true);
  });

  it('a hard host stops the run budget_exhausted after cap.breached, and an advisory host does not stop it', async () => {
    const l = await leg(ID_ENFORCEMENT, ['hard-stop', 'advisory']);
    if ('skip' in l) return softSkip(l.skip.disposition, l.skip.reason);
    if (l.findings.length === 0) return softSkip('inapplicable', 'budget.enforce is not advertised — neither the hard stop nor the advisory rule binds');
    for (const f of l.findings) expect(f.ok, req(ID_ENFORCEMENT, f.doc, f.message)).toBe(true);
  });

  it('no budget.* or cap.breached payload carries pricing or a credential', async () => {
    const l = await leg(ID_CONTENT_FREE, ['content-free']);
    if ('skip' in l) return softSkip(l.skip.disposition, l.skip.reason);
    for (const f of l.findings) expect(f.ok, req(ID_CONTENT_FREE, f.doc, f.message)).toBe(true);
  });
});
