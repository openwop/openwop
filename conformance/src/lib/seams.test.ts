import { describe, it, expect } from 'vitest';
import { seamPath, isSeamPath, seamsProfileAdvertised, SEAMS_PROFILE_ID } from './seams.js';

describe('seams profile (RFC 0168 §C)', () => {
  it('rewrites the three v1 seam prefixes to /conformance/seams and leaves canonical paths alone', () => {
    expect(seamPath('/v1/host/sample/http/safe-fetch')).toBe('/conformance/seams/sample/http/safe-fetch');
    expect(seamPath('/v1/host/workspace/files/a.txt')).toBe('/conformance/seams/workspace/files/a.txt');
    expect(seamPath('/v1/packs-test/x/-/1.0.0.tgz')).toBe('/conformance/seams/packs-test/x/-/1.0.0.tgz');
    expect(seamPath('/v1/runs')).toBe('/v1/runs');
    expect(seamPath('/host/effect-seams')).toBe('/host/effect-seams'); // a normative RFC 0173 surface, not a seam
    expect(isSeamPath('/v1/host/sample/x')).toBe(true); expect(isSeamPath('/runs')).toBe(false);
  });
  it('reads the seams profile from the conformance METADATA key, never a capability flag', () => {
    expect(seamsProfileAdvertised({ conformance: { seamsProfile: SEAMS_PROFILE_ID } })).toBe(true);
    expect(seamsProfileAdvertised({ observability: { testSeams: { otelScrape: true } } })).toBe(false);
    expect(seamsProfileAdvertised(null)).toBe(false);
  });
});
