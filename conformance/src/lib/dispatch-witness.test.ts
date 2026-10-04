/**
 * The `core.dispatch` witnesses at major 2 — input mapping and the supervisor
 * loop — proven in both directions against a run-graph double. Each case turns
 * on ONE defect and checks that only the leg owning the rule fails.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { v2RefValidator } from './v2.js';
import { RunGraphDouble, type DoubleEvent, type DoubleRun } from './run-graph-double.js';
import type { Outcome } from './fixture-run-observer.js';
import {
  DISPATCH_CHILD_FIXTURE, DISPATCH_NO_DEFAULT_FIXTURE, DISPATCH_NODE, DISPATCH_PARENT_FIXTURE, LOOP_FIXTURE,
  decisionBranchValidator, driveDispatchMapping, driveLoop, judgeDecisions, judgeIteration, judgeLoopTerminates, judgeProjection, judgeUnsetProjection,
} from './dispatch-witness.js';

const V2 = majorProfile(2);
const ALL = [DISPATCH_PARENT_FIXTURE, DISPATCH_NO_DEFAULT_FIXTURE, DISPATCH_CHILD_FIXTURE, LOOP_FIXTURE];
const validateDecided = decisionBranchValidator((i) => v2RefValidator(`orchestrator-decision.schema.json#/oneOf/${i}`));
const discovery = (o: { dispatchMapping?: boolean; version?: number } = {}): Record<string, unknown> => ({
  agents: { status: 'stable', since: '2.0', witness: 'claims-check', dispatch: true, dispatchMapping: o.dispatchMapping ?? true },
  multiAgent: { status: 'stable', since: '2.0', witness: 'claims-check', executionModel: { version: o.version ?? 6 } },
});

type Defect =
  | 'none' | 'locate-by-outputs' | 'unlocatable' | 'no-projection' | 'unset-null' | 'unset-placeholder'
  | 'no-terminate' | 'decision-after-terminate' | 'v1-event-name' | 'bad-decision' | 'agent-changes' | 'iteration-skips' | 'no-iteration';

function world(defect: Defect): (workflowId: string, spawn: (r: DoubleRun) => string) => DoubleRun | undefined {
  return (workflowId, spawn) => {
    if (workflowId === DISPATCH_PARENT_FIXTURE || workflowId === DISPATCH_NO_DEFAULT_FIXTURE) {
      const unset = workflowId === DISPATCH_NO_DEFAULT_FIXTURE;
      const inputs = unset
        ? (defect === 'unset-null' ? { childGreeting: null } : defect === 'unset-placeholder' ? { childGreeting: '' } : {})
        : (defect === 'no-projection' ? {} : { childGreeting: 'Alice' });
      const child = spawn({ workflowId: DISPATCH_CHILD_FIXTURE, status: 'completed', inputs });
      const events: DoubleEvent[] = defect === 'unlocatable'
        ? [{ type: 'node.completed', nodeId: DISPATCH_NODE, payload: { nodeId: DISPATCH_NODE } }]
        : defect === 'locate-by-outputs'
          ? [{ type: 'node.completed', nodeId: DISPATCH_NODE, payload: { nodeId: DISPATCH_NODE, outputs: { childRunId: child, childStatus: 'completed' } } }]
          : [{ type: 'node.dispatched', nodeId: DISPATCH_NODE, payload: { childRunId: child, childWorkflowId: DISPATCH_CHILD_FIXTURE, childStatus: 'completed' } }];
      return { status: 'completed', variables: unset ? {} : { parentName: 'Alice' }, events };
    }
    if (workflowId === LOOP_FIXTURE) {
      const type = defect === 'v1-event-name' ? 'runOrchestrator.decided' : 'orchestrator.decided';
      const decided = (i: number, decision: Record<string, unknown>): DoubleEvent => ({
        type, nodeId: 'orchestrator',
        payload: {
          agentId: defect === 'agent-changes' && i === 2 ? 'supervisor-b' : 'supervisor',
          decision: defect === 'bad-decision' && i === 1 ? { kind: 'next-worker' } : decision,
          ...(defect === 'no-iteration' ? {} : { iteration: defect === 'iteration-skips' && i === 2 ? 3 : i }),
        },
      });
      const turns = [decided(1, { kind: 'next-worker', nextWorkerIds: ['conformance-noop'] })];
      if (defect !== 'no-terminate') turns.push(decided(2, { kind: 'terminate', reason: 'goal-reached' }));
      if (defect === 'decision-after-terminate') turns.push(decided(3, { kind: 'next-worker', nextWorkerIds: ['conformance-noop'] }));
      return { status: 'completed', events: [{ type: 'run.started' }, ...turns, { type: 'run.completed' }] };
    }
    return undefined;
  };
}

const host = new RunGraphDouble({ discovery: discovery() });
beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: ALL });
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });

const OPTS = { timeoutMs: 2000, pollMs: 5 };
const failed = (o: Outcome): boolean => (o.kind === 'observed' ? o.findings.some((x) => !x.ok) : o.disposition === 'blocked');

const legs: Record<string, () => Promise<Outcome>> = {
  projection: async () => { const o = await driveDispatchMapping(V2, host.discovery, DISPATCH_PARENT_FIXTURE, OPTS); return 'kind' in o ? o : judgeProjection(o); },
  unset: async () => { const o = await driveDispatchMapping(V2, host.discovery, DISPATCH_NO_DEFAULT_FIXTURE, OPTS); return 'kind' in o ? o : judgeUnsetProjection(o); },
  terminates: async () => { const o = await driveLoop(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeLoopTerminates(o); },
  decisions: async () => { const o = await driveLoop(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeDecisions(o, validateDecided); },
  iteration: async () => { const o = await driveLoop(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeIteration(o); },
};

async function failingLegs(defect: Defect): Promise<string[]> {
  const out: string[] = [];
  for (const [k, run] of Object.entries(legs)) { host.reconfigure({ onCreate: world(defect) }); if (failed(await run())) out.push(k); }
  return out;
}

describe('dispatch witnesses at major 2 (dispatchMapping; execution.md §multiAgent)', () => {
  it('a conforming double passes every leg, with every leg observed', async () => {
    expect(await failingLegs('none')).toEqual([]);
    expect(await failingLegs('locate-by-outputs')).toEqual([]);
    host.reconfigure({ onCreate: world('none') });
    for (const run of Object.values(legs)) expect((await run()).kind).toBe('observed');
  });

  it.each<[Defect, string[]]>([
    ['unlocatable', []],
    ['no-projection', ['projection']],
    ['unset-null', ['unset']],
    ['unset-placeholder', ['unset']],
    ['no-terminate', ['terminates']],
    ['decision-after-terminate', ['terminates']],
    ['bad-decision', ['decisions']],
    ['agent-changes', ['decisions']],
    ['iteration-skips', ['iteration']],
    ['no-iteration', ['iteration']],
    ['v1-event-name', ['terminates']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failingLegs(defect)).toEqual(want);
  });

  it('an unlocatable child is inapplicable: no v2 rule requires a host to expose it', async () => {
    host.reconfigure({ onCreate: world('unlocatable') });
    expect(await legs['projection']!()).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('below level 5 the iteration leg is inapplicable', async () => {
    host.reconfigure({ discovery: discovery({ version: 4 }), onCreate: world('no-iteration') });
    expect(await legs['iteration']!()).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    host.reconfigure({ discovery: discovery() });
  });

  it('without agents.dispatchMapping, multiAgent.executionModel or the fixture, no run is created: inapplicable', async () => {
    expect(await driveDispatchMapping(V2, discovery({ dispatchMapping: false }), DISPATCH_PARENT_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await driveDispatchMapping(V2, {}, DISPATCH_PARENT_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await driveLoop(V2, { agents: discovery()['agents'] })).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [DISPATCH_PARENT_FIXTURE] });
    expect(await driveDispatchMapping(V2, discovery(), DISPATCH_PARENT_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await driveLoop(V2, discovery())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: ALL });
  });
});
