/**
 * The `core.subWorkflow` witness at major 2, proven in both directions against
 * a run-graph double that plays the parent fixtures, the child each one starts,
 * and the child's `getRunAncestry` answer. Each case turns on ONE defect and
 * checks that only the leg owning the rule fails.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { v2RefValidator } from './v2.js';
import { DOUBLE_TENANT, RunGraphDouble, type DoubleRun } from './run-graph-double.js';
import type { Outcome } from './fixture-run-observer.js';
import {
  CHILD_FIXTURE, IM_CHILD_FIXTURE, IM_NO_DEFAULT_FIXTURE, IM_PARENT_FIXTURE, PARENT_FIXTURE, SUBWF_NODE,
  driveInputMapping, driveLinkage, judgeAncestry, judgeOutput, judgeOutputMapping, judgeOverride, judgeSeed, judgeUnset,
} from './subworkflow-witness.js';

const V2 = majorProfile(2);
const ALL = [PARENT_FIXTURE, CHILD_FIXTURE, IM_PARENT_FIXTURE, IM_NO_DEFAULT_FIXTURE, IM_CHILD_FIXTURE];
const validateAncestry = v2RefValidator('run-ancestry-response.schema.json');
const discovery = (ancestry: boolean): Record<string, unknown> => ({
  multiAgent: { status: 'stable', since: '2.0', witness: 'claims-check', executionModel: { version: 3, crossHostCausation: { hostId: 'double', ancestryEndpointSupported: ancestry } } },
});

type Defect =
  | 'none' | 'no-child-run-id' | 'bad-child-status' | 'status-mismatch' | 'no-output-mapping'
  | 'ancestry-wrong-cause' | 'ancestry-wrong-parent' | 'ancestry-null-parent' | 'ancestry-404'
  | 'not-seeded' | 'default-wins' | 'unset-null' | 'unset-placeholder';

function world(defect: Defect): (workflowId: string, spawn: (r: DoubleRun) => string, self: string) => DoubleRun | undefined {
  return (workflowId, spawn, self) => {
    const parentOf = (cause = 'core.subWorkflow') => (id: string) => {
      if (defect === 'ancestry-404') return { status: 404, body: { error: 'not_found', message: 'x' } };
      const parent = defect === 'ancestry-null-parent' ? null : { runId: defect === 'ancestry-wrong-parent' ? `${DOUBLE_TENANT}/run-9999999999999999` : self, hostId: 'double', cause };
      return { status: 200, body: { runId: id, hostId: 'double', parent } };
    };
    const call = (childId: string, childStatus = 'completed') => ({
      type: 'node.completed', nodeId: SUBWF_NODE,
      payload: { nodeId: SUBWF_NODE, outputs: defect === 'no-child-run-id' ? { childStatus } : { childRunId: childId, childStatus: defect === 'bad-child-status' ? 'done' : defect === 'status-mismatch' ? 'failed' : childStatus } },
    });
    if (workflowId === PARENT_FIXTURE) {
      const child = spawn({ workflowId: CHILD_FIXTURE, status: 'completed', variables: { childResult: 'child-completed' }, ancestry: parentOf(defect === 'ancestry-wrong-cause' ? 'core.dispatch' : 'core.subWorkflow') });
      return { status: 'completed', variables: defect === 'no-output-mapping' ? {} : { childOutcome: 'child-completed' }, events: [{ type: 'run.started' }, call(child), { type: 'run.completed' }] };
    }
    if (workflowId === IM_PARENT_FIXTURE) {
      const vars = defect === 'not-seeded' ? {} : { receivedPrdId: defect === 'default-wins' ? 'baked-in' : 'prd-1' };
      return { status: 'completed', variables: { currentPrdId: 'prd-1' }, events: [call(spawn({ workflowId: IM_CHILD_FIXTURE, status: 'completed', variables: vars }))] };
    }
    if (workflowId === IM_NO_DEFAULT_FIXTURE) {
      const vars = defect === 'unset-null' ? { receivedPrdId: null } : defect === 'unset-placeholder' ? { receivedPrdId: '' } : { receivedPrdId: 'baked-in' };
      return { status: 'completed', variables: {}, events: [call(spawn({ workflowId: IM_CHILD_FIXTURE, status: 'completed', variables: vars }))] };
    }
    return undefined;
  };
}

const host = new RunGraphDouble({ discovery: discovery(true) });
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
  output: async () => { const o = await driveLinkage(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeOutput(o); },
  outputMapping: async () => { const o = await driveLinkage(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeOutputMapping(o); },
  ancestry: async () => { const o = await driveLinkage(V2, host.discovery, OPTS); return 'kind' in o ? o : judgeAncestry(o, validateAncestry); },
  seed: async () => { const o = await driveInputMapping(V2, IM_PARENT_FIXTURE, OPTS); return 'kind' in o ? o : judgeSeed(o); },
  override: async () => { const o = await driveInputMapping(V2, IM_PARENT_FIXTURE, OPTS); return 'kind' in o ? o : judgeOverride(o); },
  unset: async () => { const o = await driveInputMapping(V2, IM_NO_DEFAULT_FIXTURE, OPTS); return 'kind' in o ? o : judgeUnset(o); },
};

async function failingLegs(defect: Defect): Promise<string[]> {
  const out: string[] = [];
  for (const [k, run] of Object.entries(legs)) { host.reconfigure({ onCreate: world(defect) }); if (failed(await run())) out.push(k); }
  return out;
}

describe('subWorkflow witness at major 2 (execution.md §subWorkflow)', () => {
  it('a conforming double passes every leg, with every leg observed', async () => {
    expect(await failingLegs('none')).toEqual([]);
    host.reconfigure({ onCreate: world('none') });
    for (const run of Object.values(legs)) expect((await run()).kind).toBe('observed');
  });

  it.each<[Defect, string[]]>([
    ['no-child-run-id', ['output', 'ancestry', 'seed', 'override', 'unset']],
    ['bad-child-status', ['output']],
    ['status-mismatch', ['output']],
    ['no-output-mapping', ['outputMapping']],
    ['ancestry-wrong-cause', ['ancestry']],
    ['ancestry-wrong-parent', ['ancestry']],
    ['ancestry-null-parent', ['ancestry']],
    ['ancestry-404', ['ancestry']],
    ['not-seeded', ['seed', 'override']],
    ['default-wins', ['override']],
    ['unset-null', ['unset']],
    ['unset-placeholder', ['unset']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failingLegs(defect)).toEqual(want);
  });

  it('getRunAncestry not advertised: the ancestry leg is inapplicable, never a false pass', async () => {
    host.reconfigure({ discovery: discovery(false), onCreate: world('ancestry-wrong-cause') });
    expect(await legs['ancestry']!()).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    host.reconfigure({ discovery: discovery(true) });
  });

  it('a fixture not advertised is inapplicable, and no run is created', async () => {
    setAdvertisedFixtures({ fixtures: [PARENT_FIXTURE, IM_PARENT_FIXTURE] });
    expect(await driveLinkage(V2, host.discovery)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await driveInputMapping(V2, IM_PARENT_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: ALL });
  });
});
