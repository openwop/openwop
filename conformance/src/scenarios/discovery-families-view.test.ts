/**
 * RFC 0073 — root is the normative layout; the top-level `capabilities`
 * wrapper is a v1.x-tolerated mirror. This pins `discoveryFamilies`, the view
 * every reader that was written against the wrapper now goes through (S26,
 * suite 1.135.0): root families win, a wrapper-only family is still visible,
 * and a root-only host loses nothing.
 *
 * Why it exists: forty-four readers consulted the wrapper ONLY, so a host that
 * did what RFC 0073 asks — root families, no wrapper — silently lost their
 * legs, and the second sibling host had to keep its wrapper as a mirror
 * because of it. Server-free, always-on.
 */

import { describe, it, expect } from 'vitest';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';

describe('RFC 0073 — discoveryFamilies is root-first with the deprecated wrapper as fallback', () => {
  it('a root-only document is read as-is (the RFC 0073 shape)', () => {
    expect(discoveryFamilies({ protocolVersion: '1.0', kvStorage: { supported: true } })).toEqual({ protocolVersion: '1.0', kvStorage: { supported: true } });
  });

  it('a wrapper-only family is still visible, and the wrapper key itself is not a family', () => {
    const v = discoveryFamilies({ protocolVersion: '1.0', capabilities: { heartbeat: { supported: true } } });
    expect(v['heartbeat']).toEqual({ supported: true });
    expect('capabilities' in v).toBe(false);
  });

  it('when both carry a family, the root wins', () => {
    const v = discoveryFamilies({ feedback: { supported: true, root: true }, capabilities: { feedback: { supported: false, root: false } } });
    expect(v['feedback']).toEqual({ supported: true, root: true });
  });

  it('a non-object document reads as empty', () => {
    expect(discoveryFamilies(null)).toEqual({});
    expect(discoveryFamilies('nope')).toEqual({});
    expect(discoveryFamilies({ capabilities: ['not', 'an', 'object'] })).toEqual({});
  });
});
