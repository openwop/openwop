/**
 * v2 — a run budget's numbers are derived, recorded and crossed once
 * (`spec/v2/core/runs.md` §`budget` section;
 * `schemas/v2/budget-policy.schema.json` `thresholdPercent`). Gated on
 * `budget`. Unaided.
 *
 * `v2-budget-enforcement` witnesses that the budget events exist, in order,
 * and that a hard budget stops the run. This file reads the same kind of run
 * for what those events SAY — the accounting a replay depends on:
 *
 *   derived     every `toolCalls` `budget.consumed`, `budget.threshold-crossed`
 *               and `budget.exhausted` reports `consumed` equal to the
 *               `agent.tool-called` events before it ("derived from …
 *               `agent.toolCalled` …, never measured twice").
 *   limit       `budget.reserved` records the effective budget, at most the
 *               run's own ceiling, and every accounting event names that limit.
 *   threshold   `budget.threshold-crossed` is emitted once for the dimension, at
 *               the policy's `thresholdPercent`, and not before spend reached it.
 *
 * The run is `conformance-budget-tool-calls` (three scripted tool calls, no
 * model) under `{ maxToolCalls: 2, thresholdPercent: 50, onExhaustion: "fail" }`
 * on `configurable.budget`, driven by `lib/budget-witness.ts` `drive`. The
 * judge is `lib/budget-accounting-witness.ts`, proven both ways in its
 * self-test.
 *
 * Dispositions: no `budget` ⇒ `inapplicable` (gate `openwop.family.budget`);
 * `toolCalls` not in `budget.dimensions`, or the fixture unadvertised ⇒
 * `inapplicable` (the fixture is the opt-in, as in `v2-budget-enforcement`); a
 * log with nothing to judge for a rule ⇒ `blocked`. A valid budgeted create
 * that is refused fails here, as it does there.
 *
 * @see spec/v2/core/runs.md §budget section
 * @see schemas/v2/budget-policy.schema.json
 * @see conformance/fixtures.md §conformance-budget-tool-calls
 */

import { describe, it, expect } from 'vitest';
import { gateFamily, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { BUDGET_POLICY, drive, type BudgetRun } from '../lib/budget-witness.js';
import { judgeAccounting, type AccountingFinding } from '../lib/budget-accounting-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'spec/v2/core/runs.md §budget section';
const ID_DERIVED = 'openwop.requirement.0084.consumption-derived';
const ID_LIMIT = 'openwop.requirement.0084.reserved-limit-enforced';
const ID_THRESHOLD = 'openwop.requirement.0084.threshold-once';

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

type Leg = { readonly skip: readonly ['inapplicable' | 'blocked', string] } | { readonly findings: AccountingFinding[] };

/** The findings for one rule, or why there are none. A refused create fails the leg here. */
async function leg(id: string, rule: AccountingFinding['rule']): Promise<Leg> {
  if ((await gateFamily('budget')) === null) return { skip: ['inapplicable', 'the host does not advertise budget (gate recorded under openwop.family.budget)'] };
  const r = await budgetRun();
  if (r.kind === 'skip') return { skip: [r.disposition, r.reason] };
  if (r.kind === 'refused') {
    expect(r.status, req(id, DOC, `a host that advertises budget and the fixture MUST accept a valid configurable.budget (got ${r.status} ${r.code ?? ''})`.trim())).toBe(201);
    return { findings: [] };
  }
  const toolCalled = PROFILE.eventType('agent.toolCalled');
  const consumed = PROFILE.eventType('budget.consumed');
  if (toolCalled === undefined || consumed === undefined) return { skip: ['blocked', 'the v2 event names for agent.toolCalled / budget.consumed are not in the codemap on disk — the witness will not guess them'] };
  const findings = judgeAccounting(r.observation, { toolCalled, consumed }, BUDGET_POLICY, DOC).filter((f) => f.rule === rule);
  if (findings.length === 0) {
    const what: Record<AccountingFinding['rule'], string> = {
      derived: `the log carries no ${toolCalled} event or no toolCalls accounting event — there is no consumed figure to compare with the calls made`,
      limit: 'the log carries no budget.reserved — there is no recorded effective budget to compare with',
      threshold: 'the log carries no toolCalls budget.threshold-crossed — there is no crossing to judge (v2-budget-enforcement fails its absence)',
    };
    return { skip: ['blocked', what[rule]] };
  }
  return { findings };
}

describe('v2 budget accounting (runs.md §budget section)', () => {
  it('every toolCalls accounting event reports consumed equal to the agent.tool-called events before it', async () => {
    const l = await leg(ID_DERIVED, 'derived');
    if ('skip' in l) return softSkip(...l.skip);
    for (const f of l.findings) expect(f.ok, req(ID_DERIVED, f.doc, f.message)).toBe(true);
  });

  it('budget.reserved records an effective budget within the run ceiling, and every accounting event names that limit', async () => {
    const l = await leg(ID_LIMIT, 'limit');
    if ('skip' in l) return softSkip(...l.skip);
    for (const f of l.findings) expect(f.ok, req(ID_LIMIT, f.doc, f.message)).toBe(true);
  });

  it('budget.threshold-crossed is emitted once, at the policy percent, and not before spend reached it', async () => {
    const l = await leg(ID_THRESHOLD, 'threshold');
    if ('skip' in l) return softSkip(...l.skip);
    for (const f of l.findings) expect(f.ok, req(ID_THRESHOLD, f.doc, f.message)).toBe(true);
  });
});
