/**
 * The static envelope-schema walkers, proven in both directions: a conforming
 * schema yields nothing, and each defect yields the violation it names. Then a
 * smoke pass over the real `schemas/v2/envelopes/` tree, so a walker that
 * silently reads nothing is caught.
 */

import { describe, expect, it } from 'vitest';
import { anyOfDiscriminatorViolations, branchDiscriminated, listV2EnvelopeKinds, loadV2EnvelopeSchema, oneOfViolations, tierOneViolations, UNIVERSAL_KINDS } from './envelope-schema-static.js';

const strictClean = {
  type: 'object', additionalProperties: false, required: ['kind', 'title'],
  properties: { kind: { type: 'string', enum: ['note'] }, title: { type: 'string' } },
};
const rules = (v: ReadonlyArray<{ rule: string; detail?: string }>): string[] => v.map((x) => `${x.rule}${x.detail ? `:${x.detail}` : ''}`);

describe('tier-one walker (RFC 0030 §B)', () => {
  it('a strict-clean schema has no violation in either mode', () => {
    expect(tierOneViolations(strictClean, 'strict')).toEqual([]);
    expect(tierOneViolations(strictClean, 'load-bearing')).toEqual([]);
  });

  it.each(['oneOf', 'allOf', 'not', 'if', 'dependencies', 'prefixItems', 'propertyNames'])('load-bearing: %s anywhere is flagged', (kw) => {
    const s = { ...strictClean, properties: { ...strictClean.properties, nested: { type: 'object', [kw]: [] } } };
    expect(rules(tierOneViolations(s, 'load-bearing'))).toContain(`forbidden-keyword:${kw}`);
  });

  it('load-bearing: nesting past depth 5 and more than 100 properties are flagged', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 7; i++) deep = { type: 'object', properties: { x: deep } };
    expect(rules(tierOneViolations(deep, 'load-bearing')).some((r) => r.startsWith('max-nesting-depth-5'))).toBe(true);
    const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`p${i}`, { type: 'string' }])) };
    expect(rules(tierOneViolations(wide, 'load-bearing')).some((r) => r.startsWith('max-property-count-100-exceeded'))).toBe(true);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['an open object', { ...strictClean, additionalProperties: true }, 'additionalProperties-must-be-false-on-object-strict-only'],
    ['an optional property', { ...strictClean, required: ['kind'] }, 'property-not-in-required-strict-mode-only'],
    ['a string bound', { ...strictClean, properties: { ...strictClean.properties, title: { type: 'string', maxLength: 9 } } }, 'forbidden-string-constraint-strict-only:maxLength'],
    ['a number bound', { ...strictClean, required: ['kind', 'title', 'n'], properties: { ...strictClean.properties, n: { type: 'integer', minimum: 0 } } }, 'forbidden-number-constraint-strict-only:minimum'],
    ['an array bound', { ...strictClean, required: ['kind', 'title', 'a'], properties: { ...strictClean.properties, a: { type: 'array', minItems: 1, items: { type: 'string' } } } }, 'forbidden-array-constraint-strict-only:minItems'],
  ])('strict only: %s is flagged in strict mode and tolerated as load-bearing', (_what, s, rule) => {
    expect(rules(tierOneViolations(s, 'strict'))).toContain(rule);
    expect(tierOneViolations(s, 'load-bearing')).toEqual([]);
  });
});

describe('variant discriminator walker (RFC 0031 §A)', () => {
  it('oneOf at any depth is flagged; none is clean', () => {
    expect(oneOfViolations(strictClean)).toEqual([]);
    expect(oneOfViolations({ properties: { a: { items: { oneOf: [{}, {}] } } } })).toHaveLength(1);
  });

  it('a single-string-enum discriminator in required passes; a missing, optional, multi-value or non-string one fails', () => {
    const branch = (p: Record<string, unknown>, req: string[] = ['kind']): Record<string, unknown> => ({ type: 'object', required: req, properties: { kind: p } });
    expect(branchDiscriminated(branch({ type: 'string', enum: ['a'] }))).toBe(true);
    expect(branchDiscriminated({ $ref: '#/$defs/x' })).toBe(true);
    expect(branchDiscriminated(branch({ type: 'string', enum: ['a'] }, []))).toBe(false);
    expect(branchDiscriminated(branch({ type: 'string', enum: ['a', 'b'] }))).toBe(false);
    expect(branchDiscriminated(branch({ type: 'string' }))).toBe(false);
    expect(branchDiscriminated(branch({ type: 'integer', enum: [1] }))).toBe(false);
  });

  it('an undiscriminated anyOf branch is flagged, including one nested inside another branch', () => {
    const good = { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['a'] } } };
    expect(anyOfDiscriminatorViolations({ anyOf: [good, good] })).toEqual([]);
    expect(anyOfDiscriminatorViolations({ anyOf: [good, { type: 'object' }] })).toHaveLength(1);
    const nestedVariant = { anyOf: [{ type: 'object', properties: { a: { type: 'string' } } }, good] };
    expect(anyOfDiscriminatorViolations({ anyOf: [{ ...good, properties: { ...good.properties, v: nestedVariant } }, good] })).toHaveLength(1);
  });

  it('a type union with at most one object branch is not a variant union and is not judged; two undiscriminated object branches are', () => {
    expect(anyOfDiscriminatorViolations({ anyOf: [{ type: 'string' }, { $ref: '#/$defs/binding' }] })).toEqual([]);
    expect(anyOfDiscriminatorViolations({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array' }] })).toEqual([]);
    expect(anyOfDiscriminatorViolations({ anyOf: [{ type: 'string' }, { type: 'object' }, { properties: { x: {} } }] })).toHaveLength(2);
  });
});

describe('the v2 envelope tree is read', () => {
  it('lists every universal kind and loads each', () => {
    const kinds = listV2EnvelopeKinds();
    for (const k of UNIVERSAL_KINDS) {
      expect(kinds).toContain(k);
      expect(loadV2EnvelopeSchema(k)).not.toBeNull();
    }
    expect(loadV2EnvelopeSchema('no.such-kind')).toBeNull();
  });
});
