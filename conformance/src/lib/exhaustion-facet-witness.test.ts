/**
 * The budget exhaustion-facet witness (RFC 0231), proven in both directions
 * against the scratch host. No host advertises the list yet, so each case
 * turns on one defect.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUDGET_FIXTURE } from './budget-witness.js';
import { drive, judge, UNSERVED_POLICY, type FacetFinding } from './exhaustion-facet-witness.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { majorProfile } from './major-profile.js';
import { ScratchHost, type ScratchRefusal } from './scratch-host.js';

const V2 = majorProfile(2);
const budget = (onExhaustion: unknown, enforce: string = 'hard'): Record<string, unknown> => ({
  budget: { dimensions: ['toolCalls'], enforce, ...(onExhaustion === undefined ? {} : { onExhaustion }) },
});
const refusal = (status: number, error: string): ScratchRefusal => ({ status, body: { error, message: error } });
const asksForInterrupt = (body: Readonly<Record<string, unknown>>): boolean =>
  ((body['configurable'] as { budget?: { onExhaustion?: unknown } } | undefined)?.budget?.onExhaustion) === 'interrupt';
/** A conforming `["fail"]` host: it refuses `interrupt` and nothing else. */
const conforming = (_w: string, body: Readonly<Record<string, unknown>>): ScratchRefusal | undefined =>
  asksForInterrupt(body) ? refusal(422, 'capability_not_provided') : undefined;

const host = new ScratchHost({ profile: V2, discovery: budget(['fail']) });
let seen: Record<string, unknown> | undefined;
let creates = 0;

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [BUDGET_FIXTURE] });
});
afterAll(async () => { await host.stop(); });

async function run(doc: Record<string, unknown>, createRefusal?: (w: string, b: Readonly<Record<string, unknown>>) => ScratchRefusal | undefined): Promise<FacetFinding[] | string> {
  creates = 0;
  seen = undefined;
  host.reconfigure({ discovery: doc, createRefusal: (w, b) => { creates++; seen = { ...b }; return createRefusal?.(w, b); } });
  const r = await drive(V2, doc);
  if (r.kind === 'skip') return `${r.disposition}: ${r.reason}`;
  return judge(V2, r.observation);
}
const failed = (r: FacetFinding[] | string): string[] => (typeof r === 'string' ? [r] : r.filter((f) => !f.ok).map((f) => f.rule));
const rules = (r: FacetFinding[] | string): string[] => (typeof r === 'string' ? [r] : r.map((f) => f.rule));

describe('exhaustion-facet witness against the scratch host (major 2)', () => {
  it('a conforming ["fail"] host passes both rules, and the create asks for interrupt on this major\'s surface', async () => {
    const r = await run(budget(['fail']), conforming);
    expect(rules(r)).toEqual(['contains-fail', 'refused']);
    expect(failed(r)).toEqual([]);
    expect(seen).toEqual({ workflowId: BUDGET_FIXTURE, configurable: { version: 1, budget: { ...UNSERVED_POLICY } } });
  });

  it('a host that accepts the run fails the refusal rule only', async () => {
    expect(failed(await run(budget(['fail'])))).toEqual(['refused']);
  });

  it('a 400 validation_error is not the refusal the rule asks for', async () => {
    expect(failed(await run(budget(['fail']), () => refusal(400, 'validation_error')))).toEqual(['refused']);
  });

  it('a 422 with another code fails the refusal rule', async () => {
    expect(failed(await run(budget(['fail']), () => refusal(422, 'capability_required')))).toEqual(['refused']);
  });

  it('a list without fail fails contains-fail, and the refusal leg still runs', async () => {
    const r = await run(budget(['retry']), conforming);
    expect(failed(r)).toEqual(['contains-fail']);
    expect(rules(r)).toEqual(['contains-fail', 'refused']);
  });

  it('an empty list and a bare string fail contains-fail', async () => {
    expect(failed(await run(budget([]), conforming))).toEqual(['contains-fail']);
    expect(failed(await run(budget('fail'), conforming))).toEqual(['contains-fail']);
  });

  it('a list that serves interrupt sends no create and has no refusal finding', async () => {
    const r = await run(budget(['fail', 'interrupt']));
    expect(rules(r)).toEqual(['contains-fail']);
    expect(failed(r)).toEqual([]);
    expect(creates).toBe(0);
  });

  it('no budget, no list, and an advisory host are inapplicable and send no create', async () => {
    expect(await run({})).toMatch(/^inapplicable: the host does not advertise budget/);
    expect(await run(budget(undefined))).toMatch(/^inapplicable: budget\.onExhaustion is not advertised/);
    expect(await run(budget(['fail'], 'advisory'))).toMatch(/^inapplicable: budget\.enforce is not hard/);
    expect(creates).toBe(0);
  });

  it('with no advertised fixture the refusal leg is inapplicable: there is no workflow to name', async () => {
    setAdvertisedFixtures({ fixtures: [] });
    try {
      expect(await run(budget(['fail']), conforming)).toMatch(/^inapplicable: no fixture is advertised/);
      expect(creates).toBe(0);
    } finally {
      setAdvertisedFixtures({ fixtures: [BUDGET_FIXTURE] });
    }
  });
});
