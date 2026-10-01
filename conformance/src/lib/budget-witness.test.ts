/**
 * The run-budget witness, proven in both directions against the scratch host.
 *
 * No host enforces a run budget unaided at major 2 today (MyndHyve advertises
 * `budget` and enforces it only behind a v1 seam), so the port could not be
 * sabotage-proved against a real one. Each case turns on one defect.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUDGET_FIXTURE, BUDGET_POLICY, drive, judge, type Finding } from './budget-witness.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { majorProfile } from './major-profile.js';
import { ScratchHost, type ScriptedEvent, type ScriptedRun } from './scratch-host.js';

const V2 = majorProfile(2);
const budget = (enforce: string | undefined, dimensions = ['toolCalls']): Record<string, unknown> => ({ budget: { dimensions, ...(enforce === undefined ? {} : { enforce }) } });

const RESERVED: ScriptedEvent = { type: 'budget.reserved', payload: { effectiveBudget: { maxToolCalls: 2 }, scope: 'run' } };
const CROSSED: ScriptedEvent = { type: 'budget.threshold-crossed', payload: { dimension: 'toolCalls', consumed: 1, limit: 2, percent: 50 } };
const EXHAUSTED: ScriptedEvent = { type: 'budget.exhausted', payload: { dimension: 'toolCalls', consumed: 2, limit: 2 } };
const BREACH: ScriptedEvent = { type: 'cap.breached', payload: { kind: 'budget-tool-calls', limit: 2, observed: 3 } };
const FAILED: ScriptedRun['error'] = { code: 'budget_exhausted', message: 'budget exhausted' };
const hard: ScriptedRun = { status: 'failed', error: FAILED, events: [RESERVED, CROSSED, EXHAUSTED, BREACH] };

const host = new ScratchHost({ profile: V2, discovery: budget('hard') });
let seen: Record<string, unknown> | undefined;

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [BUDGET_FIXTURE] });
});
afterAll(async () => { await host.stop(); });

async function run(doc: Record<string, unknown>, scripted: ScriptedRun): Promise<Finding[] | string> {
  host.reconfigure({ discovery: doc, script: (_w, body) => { seen = { ...body }; return scripted; } });
  const r = await drive(V2, doc, 2_000);
  if (r.kind === 'skip') return `${r.disposition}: ${r.reason}`;
  if (r.kind === 'refused') return `refused: ${r.status}`;
  return judge(V2, r.observation);
}
const failed = (r: Finding[] | string): string[] => (typeof r === 'string' ? [r] : [...new Set(r.filter((f) => !f.ok).map((f) => f.rule))]);

describe('budget witness against the scratch host (major 2)', () => {
  it('a conforming hard host passes every rule, and the create carries the policy on this major\'s surface', async () => {
    const r = await run(budget('hard'), hard);
    expect(failed(r)).toEqual([]);
    expect((r as Finding[]).some((f) => f.rule === 'hard-stop')).toBe(true);
    expect(seen).toEqual({ workflowId: BUDGET_FIXTURE, configurable: { version: 1, budget: { ...BUDGET_POLICY } } });
  });

  it('a host that stores the policy and ignores it fails lifecycle and hard-stop (the run just completes)', async () => {
    expect(failed(await run(budget('hard'), { status: 'completed', events: [{ type: 'run.started' }, { type: 'run.completed' }] }))).toEqual(['lifecycle', 'hard-stop']);
  });

  it('a missing threshold event fails lifecycle only', async () => {
    expect(failed(await run(budget('hard'), { ...hard, events: [RESERVED, EXHAUSTED, BREACH] }))).toEqual(['lifecycle']);
  });

  it('events out of order fail lifecycle', async () => {
    expect(failed(await run(budget('hard'), { ...hard, events: [CROSSED, RESERVED, EXHAUSTED, BREACH] }))).toEqual(['lifecycle']);
  });

  it('the v1 event name is not the v2 event', async () => {
    const v1Named: ScriptedEvent = { type: 'budget.threshold.crossed', payload: CROSSED.payload };
    expect(failed(await run(budget('hard'), { ...hard, events: [RESERVED, v1Named, EXHAUSTED, BREACH] }))).toEqual(['lifecycle']);
  });

  it('exhaustion without cap.breached, under another kind, or with another error code fails hard-stop only', async () => {
    expect(failed(await run(budget('hard'), { ...hard, events: [RESERVED, CROSSED, EXHAUSTED] }))).toEqual(['hard-stop']);
    expect(failed(await run(budget('hard'), { ...hard, events: [RESERVED, CROSSED, EXHAUSTED, { type: 'cap.breached', payload: { kind: 'budget-cost', limit: 2, observed: 3 } }] }))).toEqual(['hard-stop']);
    expect(failed(await run(budget('hard'), { ...hard, error: { code: 'internal_error', message: 'x' } }))).toEqual(['hard-stop']);
  });

  it('cap.breached before budget.exhausted fails hard-stop', async () => {
    expect(failed(await run(budget('hard'), { ...hard, events: [RESERVED, CROSSED, BREACH, EXHAUSTED] }))).toEqual(['hard-stop']);
  });

  it('an advisory host that lets the run finish passes; one that stops it fails the advisory rule', async () => {
    const advisory: ScriptedRun = { status: 'completed', events: [RESERVED, CROSSED, EXHAUSTED] };
    expect(failed(await run(budget('advisory'), advisory))).toEqual([]);
    expect(failed(await run(budget('advisory'), hard))).toEqual(['advisory']);
  });

  it('a pricing key on a budget event fails content-free only', async () => {
    const leaky: ScriptedEvent = { type: 'budget.exhausted', payload: { ...EXHAUSTED.payload, unitPrice: 0.002 } };
    expect(failed(await run(budget('hard'), { ...hard, events: [RESERVED, CROSSED, leaky, BREACH] }))).toEqual(['content-free']);
  });

  it('no enforce mode advertised: neither enforcement rule is judged', async () => {
    const r = await run(budget(undefined), hard);
    expect((r as Finding[]).some((f) => f.rule === 'hard-stop' || f.rule === 'advisory')).toBe(false);
  });

  it('no budget, another dimension, or no fixture is inapplicable, never blocked', async () => {
    expect(await run({}, hard)).toBe('inapplicable: the host does not advertise budget');
    expect(await run(budget('hard', ['tokens']), hard)).toMatch(/^inapplicable: budget.dimensions does not list toolCalls/);
    setAdvertisedFixtures({ fixtures: [] });
    try { expect(await run(budget('hard'), hard)).toMatch(/^inapplicable: conformance-budget-tool-calls fixture not advertised/); }
    finally { setAdvertisedFixtures({ fixtures: [BUDGET_FIXTURE] }); }
  });

  it('a major with no createRun surface for a budget is inapplicable', async () => {
    const r = await drive(majorProfile(1), { budget: { supported: true, dimensions: ['toolCalls'] } });
    expect(r).toEqual({ kind: 'skip', disposition: 'inapplicable', reason: 'major 1 gives a run budget no createRun surface' });
  });

  it('a run that never ends is blocked, not failed', async () => {
    expect(await run(budget('hard'), { status: 'running', events: [] })).toMatch(/^blocked: the budgeted run did not reach a terminal status/);
  });
});
