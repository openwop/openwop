/**
 * `scrubEvidence` never corrupts a digest the bundle carries.
 *
 * Suite 2.40.3 stopped the environment sweep from collecting short and
 * bare-integer values, after openwop-app's
 * `OPENWOP_WEBHOOK_SECRET_ROTATION_OVERLAP_S=60` rewrote the "60" inside
 * `discovery.sha256` (about one bundle in five fails `^[0-9a-f]{64}$` that way).
 * An explicitly handed credential is still scrubbed whatever its shape, so the
 * scrub itself must not substring-rewrite a digest. These legs hand it
 * secrets that ARE substrings of the digests and assert the digests survive,
 * while a real leak next to them is still redacted.
 */

import { describe, expect, it } from 'vitest';
import { evidenceSecretsFromEnv, scrubEvidence } from './certification-bundle-verify.js';

const DIGEST = '4b8d99c002a061a0255e8224ee683160007febadd251b2d171b47c0849695315';

describe('scrubEvidence and digests', () => {
  it('a secret found INSIDE a hex digest leaves the digest intact (bare and sha256:-prefixed)', () => {
    const bundle = { discovery: { sha256: DIGEST }, suite: { stampSha256: `sha256:${DIGEST}` }, detail: 'leaked 60 and ee683160 here' };
    // "60" is the openwop-app value; "ee683160" is 8 hex chars, credential-shaped, and inside DIGEST.
    const { value, redactedAt } = scrubEvidence(bundle, ['60', 'ee683160']);
    expect(value.discovery.sha256).toBe(DIGEST);
    expect(value.suite.stampSha256).toBe(`sha256:${DIGEST}`);
    expect(value.detail).not.toContain('ee683160');
    expect(value.detail).not.toContain(' 60 ');
    expect(redactedAt).toEqual(['$.detail']);
  });

  it('a digest that IS a secret is still scrubbed', () => {
    const { value } = scrubEvidence({ token: DIGEST }, [DIGEST]);
    expect(value.token).not.toBe(DIGEST);
  });

  it('the openwop-app case end to end: a secret-named numeric setting never reaches the digest', () => {
    const secrets = evidenceSecretsFromEnv({ OPENWOP_WEBHOOK_SECRET_ROTATION_OVERLAP_S: '60' } as NodeJS.ProcessEnv, ['60']);
    const { value } = scrubEvidence({ discovery: { sha256: DIGEST } }, secrets);
    expect(value.discovery.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(value.discovery.sha256).toBe(DIGEST);
  });
});
