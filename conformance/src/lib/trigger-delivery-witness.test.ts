/**
 * The trigger delivery witness at major 2, proven in both directions against a
 * scratch double. No host serves the v2 trigger surface yet, so each case turns
 * on ONE defect in an otherwise conforming double and checks that only the leg
 * that owns the rule fails.
 *
 * The double is a test double, not a host: it executes nothing, and nothing it
 * does is evidence about any implementation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { OTHER_TENANT_KEY, TriggerDouble, type TriggerDefect } from './trigger-double.js';
import { v2Validator } from './v2.js';
import {
  adverts, causationLeg, cursorLeg, dedupLeg, pagingLeg, refusedLeg, runlessAttemptLeg, runlessStateChangeLeg, tenantLeg,
  type LegOutcome, type TriggerAdverts,
} from './trigger-delivery-witness.js';

const V2 = majorProfile(2);
const OWN_KEY = 'own-key';
const OTHER_KEY = OTHER_TENANT_KEY;

const host = new TriggerDouble();
let a: TriggerAdverts;
const validate = v2Validator('trigger-dead-letter-page');

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', OWN_KEY);
  a = adverts(V2, host.discovery);
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });
beforeEach(() => host.reset('none'));

const failed = (o: LegOutcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);
const legs = {
  dedup: () => dedupLeg(V2, a),
  refused: () => refusedLeg(V2, a),
  causation: () => causationLeg(V2, a, { pollMs: 1, pollTries: 2 }),
  attempt: () => runlessAttemptLeg(V2, a, validate),
  paging: () => pagingLeg(V2, a),
  cursor: () => cursorLeg(V2, a),
  tenant: () => tenantLeg(V2, a, OTHER_KEY, OWN_KEY),
};
type Leg = keyof typeof legs;

/** Which legs fail with `defect` on. */
async function failingLegs(defect: TriggerDefect): Promise<Leg[]> {
  const out: Leg[] = [];
  for (const k of Object.keys(legs) as Leg[]) { host.reset(defect); if (failed(await legs[k]()).length > 0) out.push(k); }
  return out;
}

describe('trigger-delivery-witness at major 2 (RFC 0230 + RFC 0232)', () => {
  it('a conforming double passes every leg', async () => {
    expect(await failingLegs('none')).toEqual([]);
  });

  it.each<[TriggerDefect, Leg[]]>([
    ['dedup-new-run', ['dedup']],
    ['refused-starts-run', ['refused']],
    ['refused-changes-state', ['refused']],
    ['no-causation', ['causation']],
    ['record-leaks-canary', ['attempt']],
    ['refused-not-recorded', ['attempt', 'paging', 'cursor']],
    ['refused-records-state-change', ['attempt']],
    ['wrong-retention', ['attempt']],
    ['limit-ignored', ['paging', 'cursor']],
    ['cursor-not-bound', ['cursor']],
    ['tenant-leak', ['tenant']],
    ['tenant-404', ['tenant']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failingLegs(defect)).toEqual(want);
  });

  it('the state-change leg is inapplicable at major 2, and every leg is inapplicable without the family', async () => {
    expect(runlessStateChangeLeg(a)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    const none = adverts(V2, {});
    for (const out of [await dedupLeg(V2, none), await runlessAttemptLeg(V2, none, validate), await pagingLeg(V2, none), runlessStateChangeLeg(none)]) {
      expect(out).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    }
  });

  it('without inboundSigning the delivery legs are inapplicable; without deadLetter the read legs are', async () => {
    const noSigning = adverts(V2, { triggerBridge: { deadLetter: { retentionDays: 7, maxPageSize: 100 } } });
    expect(await dedupLeg(V2, noSigning)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    const noDl = adverts(V2, { triggerBridge: { ingestion: { inboundSigning: ['standard-webhooks-1'] } } });
    expect(await runlessAttemptLeg(V2, noDl, validate)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await cursorLeg(V2, noDl)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('the tenant leg is blocked without a second credential, never silently passed', async () => {
    expect(await tenantLeg(V2, a, undefined, OWN_KEY)).toMatchObject({ kind: 'skip', disposition: 'blocked' });
    expect(await tenantLeg(V2, a, OWN_KEY, OWN_KEY)).toMatchObject({ kind: 'skip', disposition: 'blocked' });
  });
});
