/**
 * The run execution-bounds witness at major 2, proven in both directions
 * against the scratch host. No host is known to advertise the
 * run-duration fixture at major 2 yet, so each case turns on ONE defect.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { ScratchHost, type ScratchRefusal, type ScriptedRun } from './scratch-host.js';
import { driveBreach, judgeBreach, refusedLeg, shapeLeg, TIMEOUT_FIXTURE, type BoundsOutcome } from './run-bounds-witness.js';

const V2 = majorProfile(2);
const limits = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ limits: { status: 'stable', since: '2.0', witness: 'witnessable-gated', clarificationRounds: 3, schemaRounds: 3, envelopesPerTurn: 8, maxRunDurationMs: 60_000, ...extra } });

/** A conforming timeout: the fixture fails run_timeout and emits the breach. */
const timedOut = (o: Partial<{ status: ScriptedRun['status']; code: string; kind: string; observed: number; limit: number; noEvent: boolean }> = {}): ScriptedRun => ({
  status: o.status ?? 'failed',
  error: { code: o.code ?? 'run_timeout', message: 'timed out' },
  events: o.noEvent ? [] : [{ type: 'cap.breached', payload: { kind: o.kind ?? 'run-duration', limit: o.limit ?? 1000, observed: o.observed ?? 1203 } }],
});
const refuseZero = (_w: string, body: Readonly<Record<string, unknown>>): ScratchRefusal | undefined =>
  ((body['configurable'] as { run?: { runTimeoutMs?: number } } | undefined)?.run?.runTimeoutMs === 0 ? { status: 400, body: { error: 'validation_error', message: 'runTimeoutMs below minimum' } } : undefined);

const host = new ScratchHost({ profile: V2, discovery: limits() });

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [TIMEOUT_FIXTURE, 'conformance-noop'] });
});
afterAll(async () => { await host.stop(); });

const failedOf = (o: BoundsOutcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);

async function breach(script: ScriptedRun): Promise<string[]> {
  host.reconfigure({ script: () => script });
  const o = await driveBreach(V2, { timeoutMs: 2000, pollMs: 5 });
  if ('kind' in o) return [`skip:${o.disposition}`];
  return judgeBreach(o).filter((x) => !x.ok).map((x) => x.message);
}

describe('run-bounds witness at major 2 (runs.md §run section)', () => {
  it('shape: well-formed limits pass; a sub-1000 maxRunDurationMs or a zero maxLoopIterations fails; no facet is inapplicable', () => {
    expect(failedOf(shapeLeg(V2, limits()))).toEqual([]);
    expect(failedOf(shapeLeg(V2, limits({ maxRunDurationMs: 500 })))).toHaveLength(1);
    expect(failedOf(shapeLeg(V2, limits({ maxLoopIterations: 0 })))).toHaveLength(1);
    expect(shapeLeg(V2, { limits: { status: 'stable', since: '2.0', witness: 'witnessable-gated', clarificationRounds: 3, schemaRounds: 3, envelopesPerTurn: 8 } })).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(shapeLeg(V2, {})).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('refused: a host that refuses runTimeoutMs 0 passes; one that accepts it, or refuses with another code, fails', async () => {
    host.reconfigure({ createRefusal: refuseZero });
    expect(failedOf(await refusedLeg(V2, 'conformance-noop'))).toEqual([]);
    host.reconfigure({ createRefusal: undefined });
    expect(failedOf(await refusedLeg(V2, 'conformance-noop'))).toHaveLength(2);
    host.reconfigure({ createRefusal: () => ({ status: 400, body: { error: 'bad_request', message: 'x' } }) });
    expect(failedOf(await refusedLeg(V2, 'conformance-noop'))).toHaveLength(1);
    expect(await refusedLeg(V2, undefined)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('breach: a conforming timeout passes, and the request carries the closed v2 configurable shape', async () => {
    let seen: Readonly<Record<string, unknown>> | undefined;
    host.reconfigure({ script: () => timedOut(), createRefusal: (_w, b) => { seen = b; return undefined; } });
    const o = await driveBreach(V2, { timeoutMs: 2000, pollMs: 5 });
    expect('kind' in o).toBe(false);
    if (!('kind' in o)) expect(judgeBreach(o).filter((x) => !x.ok)).toEqual([]);
    expect(seen).toEqual({ workflowId: TIMEOUT_FIXTURE, configurable: { version: 1, run: { runTimeoutMs: 1000 } } });
  });

  it.each<[string, ScriptedRun]>([
    ['the run completes instead of failing', timedOut({ status: 'completed' })],
    ['the wrong error code', timedOut({ code: 'internal_error' })],
    ['no cap.breached event', timedOut({ noEvent: true })],
    ['the wrong breach kind', timedOut({ kind: 'node-executions' })],
    ['observed not above limit', timedOut({ observed: 900, limit: 1000 })],
  ])('breach defect: %s fails', async (_what, script) => {
    host.reconfigure({ createRefusal: undefined });
    expect((await breach(script)).length).toBeGreaterThan(0);
  });

  it('breach: the fixture unadvertised is inapplicable, never a false pass', async () => {
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    expect(await driveBreach(V2)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [TIMEOUT_FIXTURE, 'conformance-noop'] });
  });
});
