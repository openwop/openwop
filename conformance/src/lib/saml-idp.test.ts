/**
 * Server-free unit tests for the synthetic SAML IdP harness — specifically its
 * TWO-TRUST-ROOT behaviour (RFC 0163 §B, gap G-fixture, #1163).
 *
 * These assertions prove the FIXTURE, not any host: two instances with distinct
 * `entityID`s and signing keys can mint an assertion for the SAME opaque
 * subject id (an identifier collision) while remaining cryptographically and
 * by-issuer distinguishable. That is what makes the §B same-IdP MUST
 * witnessable — a host comparing the SAML Issuer to the SCIM connection's IdP
 * entityID has a well-defined, causable negative.
 *
 * They live here rather than in `scenarios/auth-subject-link-key-class.test.ts`
 * on purpose: a scenario file that passes fixture self-tests and soft-skips its
 * host legs resolves to `executed-pass` in every host's certification bundle
 * (conformance-certification.md gap G8), which would credit a host that never
 * advertised subject linking with a witness about a fixture. `src/lib/` tests
 * run in the published suite but produce no scenario ledger row, exactly like
 * `oidc-issuer.test.ts`.
 *
 * @see conformance/src/lib/saml-idp.ts
 * @see RFCS/0163-subject-linking-hardening.md §B
 *
 * The RFC 0050 §A reference suite (1 positive + 6 negative variants against the
 * same fixture) moved here from `scenarios/auth-saml-profile.test.ts` on
 * 2026-09-02 (RFC 0163 gap G5) for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { createSyntheticSamlIdp, DEFAULT_SAML_ENTITY_ID, type SamlVariant } from './saml-idp.js';

const COLLIDING_SUBJECT = 'idp-op-8f3a';

describe('saml-idp: two-trust-root fixture (RFC 0163 §B)', () => {
  const idpA = createSyntheticSamlIdp({ entityID: 'urn:openwop:conformance:idp-A' });
  const idpB = createSyntheticSamlIdp({ entityID: 'urn:openwop:conformance:idp-B' });

  it('a lone instance keeps the canonical default entityID (RFC 0050 behaviour unchanged)', () => {
    const lone = createSyntheticSamlIdp();
    expect(lone.entityID).toBe(DEFAULT_SAML_ENTITY_ID);
    expect(lone.verify(lone.mint('valid')).valid).toBe(true);
  });

  it('the two IdPs have distinct entityIDs and distinct signing keys (distinct trust roots)', () => {
    expect(idpA.entityID).not.toBe(idpB.entityID);
    expect(idpA.certificatePem).not.toBe(idpB.certificatePem);
  });

  it('both IdPs can mint a valid assertion for the SAME colliding subject id', () => {
    const a = idpA.verify(idpA.mint('valid', { subject: COLLIDING_SUBJECT }));
    const b = idpB.verify(idpB.mint('valid', { subject: COLLIDING_SUBJECT }));
    expect(a.valid, `IdP-A must accept its own assertion; got ${a.reason}`).toBe(true);
    expect(b.valid, `IdP-B must accept its own assertion; got ${b.reason}`).toBe(true);
  });

  it('the colliding assertions carry DIFFERENT signed Issuers (the trust-root discriminator)', () => {
    const assertionA = idpA.mint('valid', { subject: COLLIDING_SUBJECT });
    const assertionB = idpB.mint('valid', { subject: COLLIDING_SUBJECT });
    expect(idpA.issuerOf(assertionA)).toBe('urn:openwop:conformance:idp-A');
    expect(idpB.issuerOf(assertionB)).toBe('urn:openwop:conformance:idp-B');
    expect(idpA.issuerOf(assertionA)).not.toBe(idpB.issuerOf(assertionB));
  });

  it('IdP-A REJECTS an assertion minted by IdP-B for the same subject (cross-root does not verify)', () => {
    // The crux of RFC 0163 §B: an identifier collision across two trust roots
    // is NOT a link. IdP-B signs with a different key AND stamps a different
    // Issuer, so IdP-A's validator refuses it — a match on the opaque subject
    // string alone can never authorize across the roots.
    const crossRoot = idpB.mint('valid', { subject: COLLIDING_SUBJECT });
    const r = idpA.verify(crossRoot);
    expect(r.valid, 'an assertion from a DIFFERENT trust root MUST NOT verify against this IdP').toBe(false);
    expect(r.reason).toBe('bad-signature');
    expect(idpA.issuerOf(crossRoot)).not.toBe(idpA.entityID);
  });

  it('the Issuer is inside the signed element: swapping it post-signing breaks verification', () => {
    // RFC 0163 §B.1 requires the trust-root identity to be signed so it cannot
    // be rewritten to impersonate another root. Rewrite IdP-B's Issuer to
    // IdP-A's entityID on an otherwise valid IdP-B assertion: the issuer now
    // READS as A, but the signature was computed over B's canonical form.
    const forged = idpB
      .mint('valid', { subject: COLLIDING_SUBJECT })
      .replace('<saml:Issuer>urn:openwop:conformance:idp-B</saml:Issuer>', '<saml:Issuer>urn:openwop:conformance:idp-A</saml:Issuer>');
    expect(idpA.issuerOf(forged)).toBe(idpA.entityID);
    expect(idpA.verify(forged).valid, 'a re-stamped Issuer MUST NOT verify').toBe(false);
    expect(idpB.verify(forged).valid, 'the original root MUST NOT verify it either').toBe(false);
  });
});

describe('saml-idp: synthetic-IdP reference suite (RFC 0050 §A)', () => {
  // Server-free: the bundled synthetic IdP (conformance/src/lib/saml-idp.ts)
  // mints a valid assertion + the 6 negative variants, and its verify()
  // implements the RFC 0050 §A MUST list. This proves each negative is
  // detectably malformed and gives the suite a reference SAML validator.
  // A host's real ACS validates the SAME assertions over the
  // `auth/saml/validate` seam (scenarios/auth-saml-profile.test.ts, gated on
  // OPENWOP_TEST_SAML_IDP_URL).
  const idp = createSyntheticSamlIdp();

  it('publishes a PEM signing certificate', () => {
    expect(idp.certificatePem).toContain('BEGIN PUBLIC KEY');
  });

  it('accepts a valid signed, in-window, non-wrapped assertion', () => {
    const r = idp.verify(idp.mint('valid'));
    expect(r.valid, `expected valid; got reason=${r.reason}`).toBe(true);
  });

  const negatives: ReadonlyArray<[Exclude<SamlVariant, 'valid'>, string]> = [
    ['alg-none', 'alg-none'],
    ['unsigned', 'unsigned'],
    ['bad-signature', 'bad-signature'],
    ['expired', 'expired'],
    ['not-yet-valid', 'not-yet-valid'],
    ['signature-wrapping', 'signature-wrapping'],
  ];

  for (const [variant, expectedReason] of negatives) {
    it(`rejects the ${variant} assertion (RFC 0050 §A MUST)`, () => {
      const r = idp.verify(idp.mint(variant));
      expect(r.valid, `${variant} MUST be rejected`).toBe(false);
      expect(
        r.reason,
        `${variant} MUST be rejected for the ${expectedReason} reason`,
      ).toBe(expectedReason);
    });
  }
});
