/**
 * The locale-negotiation witness at major 2, proven in both directions against
 * a scratch double. Each case turns on ONE defect in an otherwise conforming
 * double and checks that only the leg owning the rule fails.
 *
 * The double is a test double, not a host: nothing it does is evidence about
 * any implementation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { I18nDouble, type I18nDefect } from './i18n-double.js';
import { errorCodeLeg, i18nAdverts, malformedLeg, shapeLeg, unsupportedLeg, type I18nAdverts, type I18nOutcome } from './i18n-negotiation-witness.js';

const V2 = majorProfile(2);
const host = new I18nDouble();
let a: I18nAdverts;

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  a = i18nAdverts(V2, host.discovery);
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });
beforeEach(() => host.reset('none'));

const failed = (o: I18nOutcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);
const legs = {
  unsupported: () => unsupportedLeg(V2, a),
  malformed: () => malformedLeg(V2, a),
  errorCode: () => errorCodeLeg(V2, a),
};
type Leg = keyof typeof legs;

async function failingLegs(defect: I18nDefect): Promise<Leg[]> {
  const out: Leg[] = [];
  for (const k of Object.keys(legs) as Leg[]) { host.reset(defect); if (failed(await legs[k]()).length > 0) out.push(k); }
  return out;
}

describe('i18n-negotiation witness at major 2 (i18n.md)', () => {
  it('a conforming double passes every live leg, and the probe is a projected bound id', async () => {
    expect(await failingLegs('none')).toEqual([]);
    const o = await unsupportedLeg(V2, a);
    expect(o.kind).toBe('observed');
  });

  it.each<[I18nDefect, Leg[]]>([
    ['malformed-400', ['malformed']],
    ['unsupported-406', ['unsupported']],
    ['content-language-lies', ['unsupported']],
    ['content-language-garbage', ['unsupported']],
    ['code-localized', ['errorCode']],
    ['details-keys-localized', ['errorCode']],
    ['details-locale-garbage', ['errorCode']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failingLegs(defect)).toEqual(want);
  });

  it('shape: a well-formed record passes; a malformed tag or a default outside supportedLocales fails; no record is inapplicable', () => {
    const rec = (r: Record<string, unknown>): I18nAdverts => i18nAdverts(V2, { i18n: { status: 'stable', since: '2.0', witness: 'witnessable-gated', ...r } });
    expect(failed(shapeLeg(rec({ defaultLocale: 'en', supportedLocales: ['EN', 'es'] })))).toEqual([]);
    expect(failed(shapeLeg(rec({ defaultLocale: 'en_US', supportedLocales: ['en_US'] })))).toHaveLength(2);
    expect(failed(shapeLeg(rec({ defaultLocale: 'fr', supportedLocales: ['en', 'es'] })))).toHaveLength(1);
    expect(shapeLeg(rec({}))).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(shapeLeg(i18nAdverts(V2, {}))).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('every live leg is inapplicable without the i18n record, never a false pass', async () => {
    const none = i18nAdverts(V2, {});
    for (const o of [await unsupportedLeg(V2, none), await malformedLeg(V2, none), await errorCodeLeg(V2, none)]) {
      expect(o).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    }
  });
});
