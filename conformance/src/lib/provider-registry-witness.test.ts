/**
 * The provider registry witness (RFC 0233), proven in both directions against
 * a scratch double. No host serves the reads yet, so each case turns on ONE
 * defect in an otherwise conforming double and checks that only the leg that
 * owns the rule fails.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v2Validator } from './v2.js';
import { ProviderRegistryDouble, type RegistryDefect } from './provider-registry-double.js';
import { failClosedLeg, providerReadAdvertised, qualifiedLeg, uniqueLeg, type RegistryOutcome } from './provider-registry-witness.js';

const host = new ProviderRegistryDouble();
const validate = v2Validator('connection-provider-registry');

beforeAll(async () => { vi.stubEnv('OPENWOP_BASE_URL', await host.start()); vi.stubEnv('OPENWOP_API_KEY', 'scratch-key'); });
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });

const legs = { unique: () => uniqueLeg(validate), failClosed: failClosedLeg, qualified: qualifiedLeg };
type Leg = keyof typeof legs;
const failedOf = (o: RegistryOutcome): boolean => o.kind === 'observed' && o.findings.some((x) => !x.ok);

async function failing(defect: RegistryDefect): Promise<Leg[]> {
  host.defect = defect;
  const out: Leg[] = [];
  for (const k of Object.keys(legs) as Leg[]) if (failedOf(await legs[k]())) out.push(k);
  return out;
}

describe('provider-registry-witness (RFC 0233)', () => {
  it('a conforming double passes every leg, all observed', async () => {
    host.defect = 'none';
    for (const k of Object.keys(legs) as Leg[]) {
      const o = await legs[k]();
      expect(o.kind, k).toBe('observed');
      expect(failedOf(o), k).toBe(false);
    }
  });

  it.each<[RegistryDefect, Leg[]]>([
    ['duplicate-id', ['unique', 'failClosed', 'qualified']],
    ['no-refusal', ['failClosed']],
    ['wrong-holder', ['failClosed']],
    ['rival-resolves', ['qualified']],
    ['qualified-wrong-pack', ['qualified']],
    ['leaks-endpoint', ['unique']],
    ['not-served', ['unique', 'failClosed', 'qualified']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failing(defect)).toEqual(want);
  });

  it('a registry where the rival holds the id reads as fixture-not-installed (inapplicable), never a false pass', async () => {
    // first-refused: the rival is listed as holder, so the fixture is not "installed" by §D.2's test —
    // the legs record inapplicable rather than convict; uniqueness still runs.
    host.defect = 'first-refused';
    expect(await failClosedLeg()).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(failedOf(await uniqueLeg(validate))).toBe(false);
  });

  it('without the fixture installed, the fixture legs are inapplicable and uniqueness still runs', async () => {
    host.defect = 'not-installed';
    expect(await failClosedLeg()).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await qualifiedLeg()).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await uniqueLeg(validate)).toMatchObject({ kind: 'observed' });
  });

  it('the facet is read as a boolean', () => {
    expect(providerReadAdvertised({ packsSupported: true, providerRead: true })).toBe(true);
    expect(providerReadAdvertised({ packsSupported: true })).toBe(false);
    expect(providerReadAdvertised(null)).toBe(false);
  });
});
