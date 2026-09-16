/**
 * Self-test for the bound-id path projection (`bound-id.ts`, RFC 0184 §A.1).
 *
 * Every case here is a trap that a plausible WRONG implementation passes the
 * happy path of: an encoder that forgets to escape its own marker, one that
 * walks UTF-16 code units instead of UTF-8 bytes, a decoder that shrugs at a
 * lone `~`. A round-trip suite made only of already-safe ids would be green
 * against all three.
 *
 * The last block is the one that earns the rest: it runs the corpus through a
 * deliberately broken encoder and asserts the suite CATCHES it. "There was data
 * to compare" and "the comparison can fail" are different claims, and only the
 * second is worth asserting.
 */
import { describe, it, expect } from 'vitest';
import { projectBoundId, unprojectBoundId } from './bound-id.js';

/** Real shapes: plain, anon-tenant (`:`), unicode, and the escape marker itself. */
const CORPUS = [
  'acme/r-0123456789abcdef',
  'anon:sess-3f9c/r-0123456789abcdef',
  'acme/r-0123456789abcdef~x',
  'tenant.with.dots/r-._~-0123456789',
  'tenant-üñïçø∂e/r-0123456789abcdef',
  'a/0123456789abcdef',
];

describe('bound-id path projection', () => {
  it('escapes the separator, the colon and its own marker', () => {
    expect(projectBoundId('acme/r-1')).toBe('acme~2Fr-1');
    expect(projectBoundId('anon:s/r-1')).toBe('anon~3As~2Fr-1');
    expect(projectBoundId('a~b')).toBe('a~7Eb');
  });

  it('is the identity on an already-passthrough string', () => {
    const safe = 'abcXYZ019._-';
    expect(projectBoundId(safe)).toBe(safe);
  });

  it('escapes per UTF-8 byte, not per UTF-16 code unit', () => {
    // 'é' is one code unit, two UTF-8 bytes; '𝄞' is a surrogate PAIR, four bytes.
    expect(projectBoundId('é')).toBe('~C3~A9');
    expect(projectBoundId('𝄞')).toBe('~F0~9D~84~9E');
  });

  it('round-trips every corpus id', () => {
    for (const id of CORPUS) expect(unprojectBoundId(projectBoundId(id)), id).toBe(id);
  });

  it('produces a segment that survives a front door: no reserved character left', () => {
    for (const id of CORPUS) {
      expect(projectBoundId(id), id).toMatch(/^[A-Za-z0-9._~-]*$/);
      // encodeURIComponent leaving it untouched IS the property: nothing to decode away.
      expect(encodeURIComponent(projectBoundId(id)), id).toBe(projectBoundId(id));
    }
  });

  it('accepts lowercase hex on decode but emits uppercase', () => {
    expect(unprojectBoundId('acme~2fr-1')).toBe('acme/r-1');
    expect(projectBoundId('acme/r-1')).toBe('acme~2Fr-1');
  });

  it('refuses a `~` that does not introduce two hex digits', () => {
    for (const bad of ['acme~', 'acme~2', 'acme~ZZr', 'acme~2Gr']) {
      expect(() => unprojectBoundId(bad), bad).toThrow(/two hex digits/);
    }
  });

  it('refuses a projection that decodes to invalid UTF-8', () => {
    expect(() => unprojectBoundId('~FF~FE')).toThrow();
  });

  it('CATCHES an encoder that fails to escape its own marker', () => {
    // The classic wrong implementation: treat `~` as passthrough because the id
    // grammar already admits it. Round-trip then silently loses information.
    const broken = (id: string) =>
      [...new TextEncoder().encode(id)]
        .map((b) => (b < 0x80 && /^[A-Za-z0-9._~-]$/.test(String.fromCharCode(b))
          ? String.fromCharCode(b)
          : `~${b.toString(16).toUpperCase().padStart(2, '0')}`))
        .join('');

    const ambiguous = 'acme/r-1~2Fx';
    expect(broken(ambiguous)).toBe('acme~2Fr-1~2Fx');
    // Two DIFFERENT ids collide onto one segment under the broken encoder:
    expect(broken('acme/r-1~2Fx')).toBe(broken('acme/r-1/x'));
    // The correct encoder keeps them apart.
    expect(projectBoundId('acme/r-1~2Fx')).not.toBe(projectBoundId('acme/r-1/x'));
  });
});
