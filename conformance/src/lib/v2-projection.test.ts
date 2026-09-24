/**
 * The projection helper, against the three instances that motivated it.
 * @see src/lib/v2-projection.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSupportedFlag, carriesUnspliceablePayload } from './v2-projection.js';
import { carriesUnspliceablePayload as generatorPredicate } from '../../../scripts/v2-unspliceable.mjs';

const V1_CAPABILITIES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas', 'capabilities.schema.json');

/** Every schema object reachable from `node`, so parity is checked at every depth, not just root keys. */
function everySchemaNode(node: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) { for (const n of node) everySchemaNode(n, out); return out; }
  if (node === null || typeof node !== 'object') return out;
  out.push(node);
  for (const v of Object.values(node)) everySchemaNode(v, out);
  return out;
}

describe('v2-projection', () => {
  it('strips `supported` at every depth, not only the top level', () => {
    const v1 = {
      supported: true,
      properties: {
        writable: { type: 'object', properties: { supported: { type: 'boolean' }, ttl: { type: 'integer' } } },
      },
      required: ['supported', 'writable'],
    };
    const v2 = stripSupportedFlag(v1) as Record<string, any>;
    expect(JSON.stringify(v2)).not.toContain('supported');
    // The nested facet keeps everything that is not the retired flag.
    expect(v2['properties']['writable']['properties']['ttl']).toEqual({ type: 'integer' });
    // A `required` naming a retired field makes the record unsatisfiable.
    expect(v2['required']).toEqual(['writable']);
  });

  it('drops `required` entirely when `supported` was its only member', () => {
    expect(stripSupportedFlag({ required: ['supported'], type: 'object' })).toEqual({ type: 'object' });
  });

  it('flags the shapes RFC 0193 found the generator dropping in silence', () => {
    expect(carriesUnspliceablePayload({ type: 'array', items: { type: 'string' } })).toBe(true);   // supportedEnvelopes
    expect(carriesUnspliceablePayload({ type: 'object', additionalProperties: { type: 'integer' } })).toBe(true); // schemaVersions
    expect(carriesUnspliceablePayload({ type: 'string', enum: ['warn', 'strict'] })).toBe(true);   // envelopeStrictness
  });

  it('does not flag a presence flag or an object that splices cleanly', () => {
    expect(carriesUnspliceablePayload({ type: 'boolean' })).toBe(false);                            // presence IS the claim
    expect(carriesUnspliceablePayload({ type: 'object', properties: { a: { type: 'integer' } } })).toBe(false); // limits
  });

  it('never invents shape — an unspliceable value is reported, not converted', () => {
    const v1 = { type: 'array', items: { type: 'string' }, supported: true };
    const out = stripSupportedFlag(v1) as Record<string, unknown>;
    // The retired flag is gone; the ARRAY is untouched. Naming its v2 seat is
    // a person's job (RFC 0193), and guessing one is how a claim goes vacuous.
    expect(out).toEqual({ type: 'array', items: { type: 'string' } });
    expect(carriesUnspliceablePayload(out)).toBe(true);
  });

  // The host-facing copy of the RFC 0193 predicate must not drift from the one the
  // generator refuses on. Two copies exist only because this lib ships in the npm
  // package and scripts/ does not.
  it('carriesUnspliceablePayload agrees with the generator on every v1 capability schema node', () => {
    const edges: unknown[] = [null, undefined, true, 0, 'x', [], [{ type: 'array' }], {}, { properties: {} }];
    const nodes = [...edges, ...everySchemaNode(JSON.parse(readFileSync(V1_CAPABILITIES, 'utf8')))];
    expect(nodes.length).toBeGreaterThan(100);
    const disagree = nodes.filter((n) => carriesUnspliceablePayload(n) !== generatorPredicate(n));
    expect(disagree).toEqual([]);
  });

  // Pins the DOCUMENTED difference from the generator's projectV1FacetSchema, so a
  // change to either contract has to be made on purpose. multiAgent is the corpus
  // instance: its executionModel facet carries tier and experimentalUntil, which only
  // the generator drops.
  it('removes the `supported` flag only — tier and experimentalUntil survive (the generator drops them)', () => {
    type Node = { properties?: Record<string, Node>; required?: string[] };
    const v1 = JSON.parse(readFileSync(V1_CAPABILITIES, 'utf8')) as Node;
    const out = stripSupportedFlag(v1.properties?.['multiAgent']);
    const facet = out?.properties?.['executionModel'];
    expect(Object.keys(facet?.properties ?? {})).not.toContain('supported');
    expect(facet?.required ?? []).not.toContain('supported');
    expect(Object.keys(facet?.properties ?? {})).toEqual(expect.arrayContaining(['tier', 'experimentalUntil']));
  });
});
