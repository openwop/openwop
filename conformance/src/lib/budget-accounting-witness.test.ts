/**
 * The budget accounting judge, proven both ways on scripted logs. Pure: no
 * host, no network. The conforming log is the one the v2 reference host writes
 * for `conformance-budget-tool-calls` under a two-call budget
 * (`examples/hosts/v2-reference/src/budget.ts`); each sabotage turns on one
 * defect and MUST fail exactly the rule it names.
 */

import { describe, expect, it } from 'vitest';
import type { BudgetObservation, RunEvent } from './budget-witness.js';
import { judgeAccounting, type AccountingFinding } from './budget-accounting-witness.js';

const NAMES = { toolCalled: 'agent.tool-called', consumed: 'budget.consumed' } as const;
const POLICY = { maxToolCalls: 2, thresholdPercent: 50 } as const;
const HOME = 'spec/v2/core/runs.md §budget section';

const ev = (sequence: number, type: string, payload: Record<string, unknown> = {}): RunEvent => ({ type, sequence, payload });
const tc = { dimension: 'toolCalls' } as const;

/** The reference host's log: two calls fit, the third does not. */
const conforming: readonly RunEvent[] = [
  ev(0, 'run.started'),
  ev(1, 'budget.reserved', { effectiveBudget: { maxToolCalls: 2, thresholdPercent: 50, onExhaustion: 'fail' }, scope: 'run' }),
  ev(2, 'agent.tool-called'),
  ev(3, 'budget.consumed', { ...tc, consumed: 1, limit: 2, remaining: 1 }),
  ev(4, 'budget.threshold-crossed', { ...tc, consumed: 1, limit: 2, percent: 50 }),
  ev(5, 'agent.tool-called'),
  ev(6, 'budget.consumed', { ...tc, consumed: 2, limit: 2, remaining: 0 }),
  ev(7, 'budget.exhausted', { ...tc, consumed: 2, limit: 2 }),
  ev(8, 'cap.breached', { kind: 'budget-tool-calls', limit: 2, observed: 3 }),
  ev(9, 'run.failed'),
];

const observe = (events: readonly RunEvent[]): BudgetObservation => ({
  enforce: 'hard',
  status: 'failed',
  errorCode: 'budget_exhausted',
  events,
  names: { reserved: 'budget.reserved', threshold: 'budget.threshold-crossed', exhausted: 'budget.exhausted', capBreached: 'cap.breached' },
});
const judge = (events: readonly RunEvent[]): AccountingFinding[] => judgeAccounting(observe(events), NAMES, POLICY, HOME);
const failing = (events: readonly RunEvent[]): string[] => [...new Set(judge(events).filter((f) => !f.ok).map((f) => f.rule))].sort();
const rules = (events: readonly RunEvent[]): string[] => [...new Set(judge(events).map((f) => f.rule))].sort();
const patch = (seq: number, payload: Record<string, unknown>): RunEvent[] => conforming.map((e) => (e.sequence === seq ? { ...e, payload: { ...e.payload, ...payload } } : e));

describe('budget accounting judge', () => {
  it('the reference host log passes every rule, and every rule is judged', () => {
    expect(failing(conforming)).toEqual([]);
    expect(rules(conforming)).toEqual(['derived', 'limit', 'threshold']);
  });

  it('a post-hoc host (exhaustion recorded after the third call) also passes: consumed still counts the calls', () => {
    const posthoc = [...conforming.slice(0, 7), ev(7, 'agent.tool-called'), ev(8, 'budget.exhausted', { ...tc, consumed: 3, limit: 2 }), ev(9, 'cap.breached', { kind: 'budget-tool-calls', limit: 2, observed: 3 })];
    expect(failing(posthoc)).toEqual([]);
  });

  it('SABOTAGE: a host that counts each call twice fails derived only', () => {
    const doubled = conforming.map((e) => (typeof e.payload['consumed'] === 'number' ? { ...e, payload: { ...e.payload, consumed: (e.payload['consumed'] as number) * 2 } } : e));
    expect(failing(doubled)).toEqual(['derived']);
  });

  it('SABOTAGE: a host that also counts agent.tool-returned fails derived', () => {
    expect(failing(patch(6, { consumed: 3 }))).toEqual(['derived']);
  });

  it('SABOTAGE: a host enforcing a limit it did not record fails limit', () => {
    expect(failing(patch(7, { limit: 5 }))).toEqual(['limit']);
  });

  it('SABOTAGE: a reserved budget above the run ceiling fails limit', () => {
    expect(failing(patch(1, { effectiveBudget: { maxToolCalls: 10 } }))).toContain('limit');
  });

  it('SABOTAGE: a reserved budget with no maxToolCalls fails limit', () => {
    expect(failing(patch(1, { effectiveBudget: {} }))).toEqual(['limit']);
  });

  it('SABOTAGE: a threshold emitted on every call fails threshold', () => {
    const twice = [...conforming.slice(0, 7), ev(7, 'budget.threshold-crossed', { ...tc, consumed: 2, limit: 2, percent: 50 }), ...conforming.slice(7).map((e) => ({ ...e, sequence: e.sequence + 1 }))];
    expect(failing(twice)).toEqual(['threshold']);
  });

  it('SABOTAGE: a threshold whose percent is not the policy\'s fails threshold', () => {
    expect(failing(patch(4, { percent: 80 }))).toEqual(['threshold']);
  });

  it('SABOTAGE: a threshold emitted before any spend fails threshold only (its consumed 0 is correctly derived)', () => {
    const early = [conforming[0] as RunEvent, conforming[1] as RunEvent, ev(2, 'budget.threshold-crossed', { ...tc, consumed: 0, limit: 2, percent: 50 }), ...conforming.slice(2).filter((e) => e.type !== 'budget.threshold-crossed').map((e) => ({ ...e, sequence: e.sequence + 1 }))];
    expect(failing(early)).toEqual(['threshold']);
  });

  it('a log with no tool calls and no accounting yields no derived or threshold findings (the scenario records blocked, never a pass)', () => {
    const bare = [ev(0, 'run.started'), ev(1, 'budget.reserved', { effectiveBudget: { maxToolCalls: 2 }, scope: 'run' }), ev(2, 'run.completed')];
    expect(rules(bare)).toEqual(['limit']);
    expect(judge([ev(0, 'run.started')])).toEqual([]);
  });
});
