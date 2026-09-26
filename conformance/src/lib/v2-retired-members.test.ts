/**
 * Self-test for v2-retired-members.ts (RFC 0197 §A.3). The register carries no
 * persisted-class `v2-minor` row today, so the host leg in
 * `v2-capability-maturity-bounded` records `inapplicable`; these fixtures drive
 * the branches it will take once one lands — a due row located and a retired
 * emission caught, a not-due row ignored, an unannotated row unlocatable.
 */
import { describe, it, expect } from 'vitest';
import { persistedRetirements, retiredMembers, findRetiredEmissions } from './v2-retired-members.js';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'openwop.deprecation.fixture-member',
  removeIn: '2.41',
  removalTrigger: ['v2-minor'],
  retirement: { class: 'enum-member', family: 'fixture', deprecatedInMinor: '2.39', persistence: 'persisted' },
  sources: [{ file: 'schemas/v2/fixture.schema.json', token: 'legacy' }],
  ...over,
});
const SCHEMA = {
  type: 'object',
  properties: {
    mode: { anyOf: [{ const: 'current' }, { const: 'legacy', 'x-openwop-retired-in': '2.41' }] },
    oldField: { type: 'string', 'x-openwop-retired-in': '2.41' },
    keep: { type: 'string' },
  },
};
const load = (): unknown => SCHEMA;

describe('v2-retired-members (RFC 0197 §A.3)', () => {
  it('the empty register yields no row — the host leg records inapplicable', () => {
    expect(persistedRetirements({ entries: [] }, '2.40.1')).toEqual([]);
  });

  it('an advertised-class row and a non-v2-minor row are not persisted retirements', () => {
    const advertised = row({ retirement: { class: 'facet', family: 'fixture', deprecatedInMinor: '2.39' } });
    const v1Only = row({ removalTrigger: ['v1-end-of-support'] });
    expect(persistedRetirements({ entries: [advertised, v1Only] }, '2.41.0')).toEqual([]);
  });

  it('a persisted row is due only once the release reaches removeIn', () => {
    expect(persistedRetirements({ entries: [row()] }, '2.40.1')[0]?.due).toBe(false);
    expect(persistedRetirements({ entries: [row()] }, '2.41.0')[0]?.due).toBe(true);
    expect(persistedRetirements({ entries: [row()] }, '2.42.3')[0]?.due).toBe(true);
  });

  it('locates a const member and a property member by their x-openwop-retired-in annotation', () => {
    const [r] = persistedRetirements({ entries: [row()] }, '2.41.0');
    const members = retiredMembers(r!, load);
    expect(members.map((m) => `${m.kind}:${m.name}`).sort()).toEqual(['property:oldField', 'value:legacy']);
  });

  it('an unannotated schema yields no member — the host leg records blocked, never a pass', () => {
    const [r] = persistedRetirements({ entries: [row()] }, '2.41.0');
    expect(retiredMembers(r!, () => ({ properties: { mode: { enum: ['current', 'legacy'] } } }))).toEqual([]);
  });

  it('catches a retired value and a retired key in an emitted event; a clean event passes', () => {
    const [r] = persistedRetirements({ entries: [row()] }, '2.41.0');
    const members = retiredMembers(r!, load);
    const bad = [{ type: 'node.completed', payload: { mode: 'legacy', nested: [{ oldField: 'x' }] } }];
    const hits = findRetiredEmissions(bad, members);
    expect(hits.map((h) => `${h.member}@${h.path}`).sort()).toEqual(['legacy@$.payload.mode', 'oldField@$.payload.nested[0].oldField']);
    expect(findRetiredEmissions([{ type: 'node.completed', payload: { mode: 'current', keep: 'legacy-ish' } }], members)).toEqual([]);
  });
});
