/**
 * The `provider.usage` emission witness at major 2, proven in both directions
 * against a run-graph double that plays the live context-budget fixture's log.
 * Each case turns on ONE defect.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { v2RefValidator } from './v2.js';
import { RunGraphDouble, type DoubleEvent, type DoubleRun } from './run-graph-double.js';
import type { Outcome } from './fixture-run-observer.js';
import { LIVE_FIXTURE, driveUsage, judgeUsage } from './provider-usage-witness.js';

const V2 = majorProfile(2);
const validate = v2RefValidator('run-event-payloads.schema.json#/$defs/providerUsage');
const DISCOVERY = { providerUsage: { status: 'stable', since: '2.0', witness: 'witnessable-gated', costEstimates: true } };

type Defect = 'none' | 'unattributed' | 'no-usage' | 'after-completion' | 'credential-leak' | 'missing-tokens' | 'run-failed-silent' | 'run-failed-after-usage';

function world(defect: Defect): (workflowId: string) => DoubleRun | undefined {
  return (workflowId) => {
    if (workflowId !== LIVE_FIXTURE) return undefined;
    const usage = (n: number): DoubleEvent => ({
      type: 'provider.usage', ...(defect === 'unattributed' ? {} : { nodeId: 'supervisor' }),
      payload: {
        provider: 'anthropic', model: 'model-x', outputTokens: 12,
        ...(defect === 'missing-tokens' ? {} : { inputTokens: 100 + n }),
        ...(defect === 'unattributed' ? {} : { nodeId: 'supervisor' }),
        ...(defect === 'credential-leak' ? { credentialRef: 'cred:abc' } : {}),
      },
    });
    const done: DoubleEvent = { type: 'node.completed', nodeId: 'supervisor', payload: { nodeId: 'supervisor' } };
    const turn = (n: number): DoubleEvent[] => (defect === 'no-usage' || defect === 'run-failed-silent' ? [done] : defect === 'after-completion' && n === 2 ? [done, usage(n)] : [usage(n), done]);
    const failed = defect === 'run-failed-silent' || defect === 'run-failed-after-usage';
    return { status: failed ? 'failed' : 'completed', events: [{ type: 'run.started' }, ...turn(1), ...turn(2), { type: failed ? 'run.failed' : 'run.completed' }] };
  };
}

const host = new RunGraphDouble({ discovery: DISCOVERY });
beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [LIVE_FIXTURE] });
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });

async function judged(defect: Defect): Promise<Outcome> {
  host.reconfigure({ onCreate: world(defect) });
  const o = await driveUsage(V2, host.discovery, { timeoutMs: 2000, pollMs: 5 });
  return 'kind' in o ? o : judgeUsage(o, validate);
}
const failures = (o: Outcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);

describe('provider.usage witness at major 2 (events.md §providerUsage)', () => {
  it('a conforming log passes, attributed or not', async () => {
    expect(failures(await judged('none'))).toEqual([]);
    expect(failures(await judged('unattributed'))).toEqual([]);
    expect((await judged('none')).kind).toBe('observed');
    // A run that fails after its provider calls is still judged on them.
    expect(await judged('run-failed-after-usage')).toMatchObject({ kind: 'observed' });
    expect(failures(await judged('run-failed-after-usage'))).toEqual([]);
  });

  it.each<[Defect, RegExp]>([
    ['no-usage', /at least one provider\.usage/],
    ['after-completion', /MUST precede that node's node\.completed/],
    ['credential-leak', /payload MUST validate/],
    ['missing-tokens', /payload MUST validate/],
  ])('defect %s fails its finding only', async (defect, want) => {
    const f = failures(await judged(defect));
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((m) => want.test(m))).toBe(true);
  });

  it('a live run that failed before any provider.usage is blocked, never a pass', async () => {
    expect(await judged('run-failed-silent')).toMatchObject({ kind: 'skip', disposition: 'blocked' });
  });

  it('without the providerUsage record or the fixture, no run is created: inapplicable', async () => {
    expect(await driveUsage(V2, {})).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [] });
    expect(await driveUsage(V2, DISCOVERY)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [LIVE_FIXTURE] });
  });
});
