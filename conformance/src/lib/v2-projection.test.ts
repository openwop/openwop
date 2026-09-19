/**
 * The projection helper, against the three instances that motivated it.
 * @see src/lib/v2-projection.ts
 */
import { describe, it, expect } from 'vitest';
import { stripSupported, carriesUnspliceablePayload } from './v2-projection.js';

describe('v2-projection', () => {
  it('strips `supported` at every depth, not only the top level', () => {
    const v1 = {
      supported: true,
      properties: {
        writable: { type: 'object', properties: { supported: { type: 'boolean' }, ttl: { type: 'integer' } } },
      },
      required: ['supported', 'writable'],
    };
    const v2 = stripSupported(v1) as Record<string, any>;
    expect(JSON.stringify(v2)).not.toContain('supported');
    // The nested facet keeps everything that is not the retired flag.
    expect(v2['properties']['writable']['properties']['ttl']).toEqual({ type: 'integer' });
    // A `required` naming a retired field makes the record unsatisfiable.
    expect(v2['required']).toEqual(['writable']);
  });

  it('drops `required` entirely when `supported` was its only member', () => {
    expect(stripSupported({ required: ['supported'], type: 'object' })).toEqual({ type: 'object' });
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
    const out = stripSupported(v1) as Record<string, unknown>;
    // The retired flag is gone; the ARRAY is untouched. Naming its v2 seat is
    // a person's job (RFC 0193), and guessing one is how a claim goes vacuous.
    expect(out).toEqual({ type: 'array', items: { type: 'string' } });
    expect(carriesUnspliceablePayload(out)).toBe(true);
  });
});
