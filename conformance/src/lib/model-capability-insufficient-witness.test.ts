/**
 * The model-capability refusal witness at major 2, proven in both directions
 * against the scratch host. Each case scripts the fixture run with ONE defect
 * and shows the leg that owns it convicts it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { ScratchHost, type ScriptedEvent, type ScriptedRun } from './scratch-host.js';
import { drive, INSUFFICIENT_FIXTURE, judgeNoDispatch, judgeRefusal, type InsufficientObservation } from './model-capability-insufficient-witness.js';

const V2 = majorProfile(2);
const DISCOVERY = { modelCapabilities: { status: 'experimental', since: '2.0', until: '2.1', witness: 'witnessable-gated', advertised: ['structured-output'] } };
const INSUFFICIENT = { type: 'model.capability-insufficient', payload: { nodeId: 'gated', provider: 'mock', model: 'mock-1', missingCapabilities: ['nonexistent-capability-9b3f'], fallbackAttempted: false } } as const;
const NODE_FAILED = { type: 'node.failed', payload: { nodeId: 'gated' } } as const;

/** A conforming refusal; each override introduces one defect. */
const refused = (o: Partial<{ status: ScriptedRun['status']; code: string; events: ScriptedEvent[] }> = {}): ScriptedRun => ({
  status: o.status ?? 'failed',
  error: { code: o.code ?? 'capability_not_provided', message: 'no model offers nonexistent-capability-9b3f' },
  events: o.events ?? [{ type: 'run.started' }, { type: 'node.started', payload: { nodeId: 'gated' } }, INSUFFICIENT, NODE_FAILED, { type: 'run.failed' }],
});

const host = new ScratchHost({ profile: V2, discovery: DISCOVERY });

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [INSUFFICIENT_FIXTURE] });
});
afterAll(async () => { await host.stop(); });

async function observe(script: ScriptedRun): Promise<InsufficientObservation> {
  host.reconfigure({ script: () => script, createRefusal: undefined });
  const o = await drive(V2, DISCOVERY, { timeoutMs: 2000, pollMs: 5 });
  if ('kind' in o) throw new Error(`unexpected skip: ${o.reason}`);
  return o;
}
const refusalFailures = async (s: ScriptedRun): Promise<string[]> => judgeRefusal(V2, await observe(s)).filter((x) => !x.ok).map((x) => x.message);
const dispatchFailures = async (s: ScriptedRun): Promise<string[]> => judgeNoDispatch(V2, await observe(s)).filter((x) => !x.ok).map((x) => x.message);

describe('model-capability-insufficient witness at major 2 (host-services.md §modelCapabilities)', () => {
  it('a conforming refusal passes both legs, and the create names the fixture on the v2 run path', async () => {
    let seen: Readonly<Record<string, unknown>> | undefined;
    host.reconfigure({ script: () => refused(), createRefusal: (_w, b) => { seen = b; return undefined; } });
    const o = await drive(V2, DISCOVERY, { timeoutMs: 2000, pollMs: 5 });
    expect('kind' in o).toBe(false);
    if ('kind' in o) return;
    expect(judgeRefusal(V2, o).filter((x) => !x.ok)).toEqual([]);
    expect(judgeNoDispatch(V2, o).filter((x) => !x.ok)).toEqual([]);
    expect(seen).toEqual({ workflowId: INSUFFICIENT_FIXTURE });
  });

  it.each<[string, ScriptedRun]>([
    ['the run completes', refused({ status: 'completed' })],
    ['the wrong error code', refused({ code: 'node_failed' })],
    ['no insufficient event', refused({ events: [NODE_FAILED] })],
    ['the event under its v1 name only', refused({ events: [{ ...INSUFFICIENT, type: 'model.capability.insufficient' }, NODE_FAILED] })],
    ['the event after node.failed', refused({ events: [NODE_FAILED, INSUFFICIENT] })],
    ['a payload missing missingCapabilities', refused({ events: [{ type: INSUFFICIENT.type, payload: { nodeId: 'gated', provider: 'mock', model: 'mock-1' } }, NODE_FAILED] })],
    ['fallbackAttempted true with no fallback declared', refused({ events: [{ type: INSUFFICIENT.type, payload: { ...INSUFFICIENT.payload, fallbackAttempted: true } }, NODE_FAILED] })],
  ])('refusal defect: %s fails', async (_what, script) => {
    expect((await refusalFailures(script)).length).toBeGreaterThan(0);
  });

  it.each<[string, string]>([
    ['node.completed', 'node.completed'],
    ['provider.usage', 'provider.usage'],
    ['envelope.refusal', 'envelope.refusal'],
    ['envelope.retry-exhausted (v2 name)', 'envelope.retry-exhausted'],
    ['envelope.retry.exhausted (v1 name)', 'envelope.retry.exhausted'],
  ])('no-dispatch defect: a %s after the refusal fails', async (_what, type) => {
    expect(await dispatchFailures(refused({ events: [INSUFFICIENT, { type }, NODE_FAILED] }))).toHaveLength(1);
  });

  it('a create refused at create fails both legs (the refusal is at dispatch)', async () => {
    host.reconfigure({ script: undefined, createRefusal: () => ({ status: 422, body: { error: 'capability_not_provided', message: 'x' } }) });
    const o = await drive(V2, DISCOVERY, { timeoutMs: 2000, pollMs: 5 });
    if ('kind' in o) throw new Error('unexpected skip');
    expect(judgeRefusal(V2, o).filter((x) => !x.ok)).toHaveLength(1);
    expect(judgeNoDispatch(V2, o).filter((x) => !x.ok)).toHaveLength(1);
  });

  it('the fixture unadvertised, or modelCapabilities unadvertised, is inapplicable — never a false pass', async () => {
    expect(await drive(V2, {})).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    expect(await drive(V2, DISCOVERY)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [INSUFFICIENT_FIXTURE] });
  });
});
