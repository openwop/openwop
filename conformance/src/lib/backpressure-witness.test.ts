/**
 * The backpressure witness, proven in both directions against the scratch host.
 *
 * No reference host advertises `production.backpressure.inflightCap`, so the
 * v2 port could not be sabotage-proved against a real one. Each case below
 * turns on one defect and shows the witness convicts it; the conforming case
 * shows it does not convict a host that is right.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { judge, saturate, HOLD_FIXTURE, PROBE_FIXTURE, type Finding } from './backpressure-witness.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { majorProfile } from './major-profile.js';
import { ScratchHost, type ScratchRefusal } from './scratch-host.js';

const V2 = majorProfile(2);
const CAP = 2;
const discovery = (bp: Record<string, unknown> | undefined): Record<string, unknown> => ({
  fixtures: [HOLD_FIXTURE, PROBE_FIXTURE],
  ...(bp === undefined ? {} : { production: { backpressure: bp } }),
});
const host = new ScratchHost({ profile: V2, discovery: discovery({ inflightCap: CAP, retryAfterSeconds: 1 }), inflightCap: CAP });

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [HOLD_FIXTURE, PROBE_FIXTURE] });
});
afterAll(async () => { await host.stop(); });

/** `cap: null` is a host that enforces no cap at all, whatever it advertises. */
async function run(bp: Record<string, unknown> | undefined, refusal?: ScratchRefusal, cap: number | null = CAP): Promise<Finding[] | string> {
  const doc = discovery(bp);
  host.reconfigure({ discovery: doc, inflightCap: cap ?? undefined, refusal });
  const s = await saturate(V2, doc);
  return s.kind === 'skip' ? `${s.disposition}: ${s.reason}` : judge(V2, s.refusal);
}
const failed = (r: Finding[] | string): string[] => (typeof r === 'string' ? [r] : r.filter((f) => !f.ok).map((f) => f.rule));

describe('backpressure witness against the scratch host (major 2)', () => {
  it('a conforming host passes every rule', async () => {
    const r = await run({ inflightCap: CAP, retryAfterSeconds: 1 });
    expect(typeof r).not.toBe('string');
    expect(failed(r)).toEqual([]);
    expect((r as Finding[]).map((f) => f.rule)).toContain('retry-timing');
  });

  it('a host that never refuses at cap + 1 fails the refusal rule', async () => {
    expect(failed(await run({ inflightCap: CAP }, undefined, null))).toContain('refusal');
  });

  it('a 503 with no Retry-After fails the refusal rule', async () => {
    expect(failed(await run({ inflightCap: CAP }, { status: 503, body: { error: 'service_unavailable', message: 'x' } }))).toEqual(['refusal']);
  });

  it('a 503 under another code fails the refusal rule', async () => {
    expect(failed(await run({ inflightCap: CAP }, { status: 503, headers: { 'retry-after': '1' }, body: { error: 'rate_limited', message: 'x' } }))).toEqual(['refusal']);
  });

  it('a Retry-After that differs from the advertised retryAfterSeconds fails that rule only', async () => {
    expect(failed(await run({ inflightCap: CAP, retryAfterSeconds: 5 }))).toEqual(['retry-after-advertised']);
  });

  it('details.retryAfter fails the retry-timing rule at major 2 (the v1 shape is the v2 defect)', async () => {
    const v1Shape: ScratchRefusal = { status: 503, headers: { 'retry-after': '1' }, body: { error: 'service_unavailable', message: 'x', details: { retryAfter: 1 } } };
    expect(failed(await run({ inflightCap: CAP }, v1Shape))).toEqual(['retry-timing']);
  });

  it('the same refusal is judged by the major: v1 requires details.retryAfter, v2 forbids it', () => {
    const refusal = { cap: CAP, status: 503, code: 'service_unavailable', retryAfterHeader: '1', details: { retryAfter: 1 }, advertisedRetryAfterSeconds: undefined };
    expect(judge(majorProfile(1), refusal).filter((f) => !f.ok)).toEqual([]);
    expect(judge(V2, refusal).filter((f) => !f.ok).map((f) => f.rule)).toEqual(['retry-timing']);
  });

  it('no production, no backpressure or no inflightCap is inapplicable, never blocked', async () => {
    expect(await run(undefined)).toMatch(/^inapplicable: the host does not advertise production$/);
    expect(await run({ retryAfterSeconds: 5 })).toMatch(/^inapplicable: .*inflightCap/);
  });

  it('a cap above what the suite will hold open is inapplicable', async () => {
    expect(await run({ inflightCap: 65 })).toMatch(/^inapplicable: inflightCap 65 is above the 64 streams/);
  });

  it('an unadvertised hold fixture is inapplicable', async () => {
    setAdvertisedFixtures({ fixtures: [PROBE_FIXTURE] });
    try { expect(await run({ inflightCap: CAP })).toMatch(/^inapplicable: conformance-delay fixture not advertised/); }
    finally { setAdvertisedFixtures({ fixtures: [HOLD_FIXTURE, PROBE_FIXTURE] }); }
  });

  it('a host already at capacity when the suite starts is blocked, not failed', async () => {
    expect(await run({ inflightCap: CAP }, undefined, 0)).toMatch(/^blocked: slot 1 of 2 could not be filled/);
  });
});
