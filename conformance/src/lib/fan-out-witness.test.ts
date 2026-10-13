/**
 * The RFC 0243 G2 witnesses — waves under `maxFanOut`, per-item input, the
 * length mismatch — proven in both directions against a run-graph double.
 * Each case turns on ONE defect and checks that only the leg owning the rule
 * fails.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { RunGraphDouble, type DoubleEvent, type DoubleRun } from './run-graph-double.js';
import type { Outcome } from './fixture-run-observer.js';
import {
  DISPATCH_NODE, PER_ITEM_CHILD, PER_ITEM_FIXTURE, PER_ITEM_MISMATCH_FIXTURE, WAVES_CHILD, WAVES_FIXTURE,
  drivePerItem, driveWaves, judgeLengthMismatch, judgePerItem, judgeWaves, maxInFlight,
} from './fan-out-witness.js';

const V2 = majorProfile(2);
const ALL = [WAVES_FIXTURE, WAVES_CHILD, PER_ITEM_FIXTURE, PER_ITEM_MISMATCH_FIXTURE, PER_ITEM_CHILD];
const discovery = (o: { fanOut?: Record<string, unknown> | null; dispatch?: boolean } = {}): Record<string, unknown> => ({
  agents: {
    status: 'stable', since: '2.0', witness: 'claims-check', dispatch: o.dispatch ?? true,
    ...(o.fanOut === null ? {} : { fanOut: o.fanOut ?? { joinModes: ['wait-all'], onChildFailureModes: ['collect', 'absorb'], maxFanOut: 16, perItemInput: true } }),
  },
});

type Defect =
  | 'none' | 'three-at-once' | 'dropped' | 'mc-over' | 'no-join' | 'untimed' | 'touching'
  | 'same-items' | 'no-items' | 'silent-drop' | 'refuse-at-create' | 'wrong-code';

const T0 = Date.parse('2026-10-13T00:00:00.000Z');
const at = (ms: number): string => new Date(T0 + ms).toISOString();
const failedNode = (code: string): DoubleEvent => ({ type: 'node.failed', nodeId: DISPATCH_NODE, payload: { nodeId: DISPATCH_NODE, error: { code, message: 'nextWorkerInputs refused' } } });

function world(defect: Defect, perItemInput: boolean): (workflowId: string, spawn: (r: DoubleRun) => string) => DoubleRun | undefined {
  return (workflowId, spawn) => {
    if (workflowId === WAVES_FIXTURE) {
      const n = defect === 'dropped' ? 2 : 3;
      const windows: Array<[number, number]> = defect === 'three-at-once' ? [[0, 1000], [0, 1000], [0, 1000]]
        : defect === 'touching' ? [[0, 1000], [0, 1000], [950, 1950]]
          : [[0, 1000], [0, 1000], [1000, 2000]];
      const ids = windows.slice(0, n).map(([s, e]) => spawn({
        workflowId: WAVES_CHILD, status: 'completed',
        snapshot: defect === 'untimed' ? {} : { startedAt: at(s), completedAt: at(e) },
      }));
      const events: DoubleEvent[] = [
        { type: 'dispatch.fanned-out', nodeId: DISPATCH_NODE, payload: { fanOutPolicy: 'parallel', childCount: n, maxConcurrency: defect === 'mc-over' ? 16 : 2, joinMode: 'wait-all' } },
        ...ids.map((id): DoubleEvent => ({ type: 'node.dispatched', nodeId: DISPATCH_NODE, payload: { childRunId: id, childWorkflowId: WAVES_CHILD, childStatus: 'completed' } })),
        ...(defect === 'no-join' ? [] : [{ type: 'dispatch.joined', nodeId: DISPATCH_NODE, payload: { joinOutcome: 'satisfied', completedCount: n, failedCount: 0, cancelledCount: 0, mergeOrder: ids } }]),
      ];
      return { status: 'completed', events };
    }
    if (workflowId === PER_ITEM_FIXTURE || workflowId === PER_ITEM_MISMATCH_FIXTURE) {
      const refuse = workflowId === PER_ITEM_MISMATCH_FIXTURE || !perItemInput;
      if (refuse && defect === 'refuse-at-create') return { status: 'failed', refuse: { status: 400, body: { error: 'validation_error', message: 'nextWorkerInputs refused' } } };
      if (refuse && defect !== 'silent-drop') return { status: 'failed', events: [failedNode(defect === 'wrong-code' ? 'internal_error' : 'validation_error')] };
      const items = defect === 'same-items' ? ['item-a', 'item-a'] : ['item-a', 'item-b'];
      const ids = items.map((v) => spawn({ workflowId: PER_ITEM_CHILD, status: 'completed', inputs: defect === 'no-items' || defect === 'silent-drop' ? {} : { childGreeting: v } }));
      return { status: 'completed', events: ids.map((id): DoubleEvent => ({ type: 'node.dispatched', nodeId: DISPATCH_NODE, payload: { childRunId: id, childWorkflowId: PER_ITEM_CHILD, childStatus: 'completed' } })) };
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
  waves: async () => { const o = await driveWaves(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeWaves(o); },
  perItem: async () => { const o = await drivePerItem(V2, host.discovery, PER_ITEM_FIXTURE, OPTS); return 'kind' in o ? o : judgePerItem(o); },
  mismatch: async () => { const o = await drivePerItem(V2, host.discovery, PER_ITEM_MISMATCH_FIXTURE, OPTS); return 'kind' in o ? o : judgeLengthMismatch(o); },
};

async function failingLegs(defect: Defect, perItemInput = true): Promise<string[]> {
  const out: string[] = [];
  const fanOut = { joinModes: ['wait-all'], onChildFailureModes: ['collect'], maxFanOut: 16, perItemInput };
  for (const [k, run] of Object.entries(legs)) {
    host.reconfigure({ discovery: discovery({ fanOut }), onCreate: world(defect, perItemInput) });
    if (failed(await run())) out.push(k);
  }
  return out;
}

describe('maxInFlight', () => {
  it('counts overlap, and touching or short windows do not overlap', () => {
    expect(maxInFlight([])).toBe(0);
    expect(maxInFlight([[0, 1000], [0, 1000], [1000, 2000]])).toBe(2);
    expect(maxInFlight([[0, 1000], [0, 1000], [0, 1000]])).toBe(3);
    expect(maxInFlight([[0, 1000], [950, 2000]])).toBe(1);
    expect(maxInFlight([[0, 1000], [800, 2000]])).toBe(2);
    expect(maxInFlight([[0, 50], [0, 50]])).toBe(1);
  });
});

describe('agents.fanOut witnesses (RFC 0243 §A.3, §A.4)', () => {
  it('a conforming double passes every leg, with every leg observed', async () => {
    expect(await failingLegs('none')).toEqual([]);
    expect(await failingLegs('none', false)).toEqual([]);
    for (const run of Object.values(legs)) expect((await run()).kind).toBe('observed');
  });

  it.each<[Defect, boolean, string[]]>([
    ['three-at-once', true, ['waves']],
    ['dropped', true, ['waves']],
    ['mc-over', true, ['waves']],
    ['no-join', true, ['waves']],
    ['untimed', true, []],
    ['touching', true, []],
    ['same-items', true, ['perItem']],
    ['no-items', true, ['perItem']],
    ['silent-drop', false, ['perItem', 'mismatch']],
    ['silent-drop', true, ['perItem', 'mismatch']],
    ['refuse-at-create', false, []],
    ['refuse-at-create', true, []],
    ['wrong-code', false, ['perItem', 'mismatch']],
    ['wrong-code', true, ['mismatch']],
  ])('defect %s (perItemInput %s) fails exactly %j', async (defect, perItemInput, want) => {
    expect(await failingLegs(defect, perItemInput)).toEqual(want);
  });

  it('without dispatch, a fanOut admitting wait-all/collect, or the fixtures, no run is created: inapplicable', async () => {
    expect(await driveWaves(V2, discovery({ fanOut: null }))).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await driveWaves(V2, discovery({ fanOut: { joinModes: ['race'], onChildFailureModes: ['collect'] } }))).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await drivePerItem(V2, discovery({ dispatch: false }), PER_ITEM_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [WAVES_FIXTURE, PER_ITEM_FIXTURE] });
    expect(await driveWaves(V2, discovery())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await drivePerItem(V2, discovery(), PER_ITEM_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: ALL });
  });

  it('a host without fanOut is still bound by the per-item gate: it must fail closed', async () => {
    host.reconfigure({ discovery: discovery({ fanOut: null }), onCreate: world('silent-drop', false) });
    expect(failed(await legs['perItem']!())).toBe(true);
  });
});
