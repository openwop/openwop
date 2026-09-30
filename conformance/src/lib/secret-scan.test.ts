/**
 * Self-test of the secret scanner behind `v2-secret-canary-absent`: every
 * encoding it claims to see is seen, the digest detector finds a preimage it
 * was never told, and a surface carrying only the digest (which the byok
 * fixture's contract emits) is clean.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { digestDetector, findSecretDigest, leaks, valueDetector } from './secret-scan.js';

const CANARY = 'ow-canary-3f9a1c7e5b2d4086-secret';
const SHA = createHash('sha256').update(CANARY, 'utf8').digest('hex');
const LEN = Buffer.byteLength(CANARY, 'utf8');
const bytes = Buffer.from(CANARY, 'utf8');

const encodings: Record<string, string> = {
  raw: CANARY,
  base64: bytes.toString('base64'),
  base64url: bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  hex: bytes.toString('hex'),
  HEX: bytes.toString('hex').toUpperCase(),
  percent: encodeURIComponent(`k=${CANARY}&x=1`),
};

describe('secret-scan', () => {
  for (const [name, form] of Object.entries(encodings)) {
    it(`both detectors find the canary as ${name} inside an event payload`, () => {
      const text = JSON.stringify({ events: [{ type: 'node.completed', payload: { outputs: { note: `prefix ${form} suffix` } } }] });
      expect(valueDetector(CANARY).find(text)).not.toBeNull();
      expect(digestDetector(SHA, LEN).find(text)).not.toBeNull();
    });
  }

  it('a surface carrying only {secretSha256, secretLength} is clean', () => {
    const text = JSON.stringify({ outputs: { 'resolve-secret': { secretSha256: SHA, secretLength: LEN } } });
    expect(leaks([{ name: 'snapshot', text }], [valueDetector(CANARY), digestDetector(SHA, LEN)])).toEqual([]);
    expect(findSecretDigest([JSON.parse(text)])).toEqual({ sha256: SHA, length: LEN });
  });

  it('a JSON-escaped canary with a quote is found through parsing', () => {
    const tricky = 'ab"cd\\ef-0123456789';
    const text = JSON.stringify({ error: { message: `auth failed with ${tricky}` } });
    const sha = createHash('sha256').update(tricky, 'utf8').digest('hex');
    expect(digestDetector(sha, Buffer.byteLength(tricky)).find(text)).toBe('raw');
    expect(valueDetector(tricky).find(text)).toBe('JSON-string-escaped');
  });

  it('non-JSON text (an SSE body) is scanned as one string', () => {
    expect(digestDetector(SHA, LEN).find(`event: run.failed\ndata: {"message":"${CANARY}"`)).toBe('raw');
  });

  it('names the leaking surface', () => {
    const out = leaks([{ name: 'a', text: '{}' }, { name: 'b', text: JSON.stringify([CANARY]) }], [digestDetector(SHA, LEN)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^b \(raw,/);
  });
});
