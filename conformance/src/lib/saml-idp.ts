/**
 * Synthetic SAML 2.0 IdP for conformance scenarios (RFC 0050).
 *
 * Mints SAML assertions — a valid signed one plus the negative variants
 * the `openwop-auth-saml` profile requires hosts to reject — and exposes
 * the signing certificate a trusting host configures. Hermetic: uses only
 * `node:crypto` stdlib (RSA-SHA256), no npm dependencies, no XML library.
 *
 * Scope: this harness is a wire-shape + validation-logic reference, NOT a
 * full XML-DSig stack. It produces a controlled, fixed-shape assertion
 * template and signs an enveloped digest of it with RSA-SHA256; `verify()`
 * implements exactly the RFC 0050 §A MUST list (signature present + valid,
 * `alg:none` rejected, validity window enforced, signature-wrapping
 * rejected) so the suite can assert each negative variant is detectably
 * malformed. A host's real SAML ACS validates the same assertions over the
 * `auth/saml/validate` test seam; sign/verify here are mutually consistent
 * by construction (the harness owns both the serialization and the digest).
 *
 * @see RFCS/0050-saml-scim-enterprise-identity-profiles.md §A
 * @see spec/v1/auth-profiles.md §`openwop-auth-saml`
 */

import {
  createSign,
  createVerify,
  createHash,
  generateKeyPairSync,
} from 'node:crypto';

/** The assertion variants the conformance suite exercises (1 positive + 6 negatives). */
export type SamlVariant =
  | 'valid'
  | 'alg-none'
  | 'bad-signature'
  | 'unsigned'
  | 'expired'
  | 'not-yet-valid'
  | 'signature-wrapping';

export interface SamlVerifyResult {
  /** True only for a well-formed, signed, in-window, non-wrapped assertion. */
  readonly valid: boolean;
  /** Machine-readable rejection cause; `null` when `valid`. */
  readonly reason:
    | null
    | 'unsigned'
    | 'alg-none'
    | 'bad-signature'
    | 'expired'
    | 'not-yet-valid'
    | 'signature-wrapping'
    | 'malformed';
}

export interface SyntheticSamlIdp {
  /** PEM signing certificate (public key) the host configures to trust this IdP. */
  readonly certificatePem: string;
  /** Mint a SAML assertion of the given variant. */
  mint(variant: SamlVariant, opts?: { subject?: string }): string;
  /** Validate an assertion per the RFC 0050 §A MUST list. */
  verify(assertionXml: string): SamlVerifyResult;
}

const SIG_ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SIG_ALG_NONE = 'http://www.w3.org/2000/09/xmldsig#none';

function digest(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64');
}

/** Deterministic canonical form of the signed element: the harness controls
 * the exact byte string, so sign/verify agree without a full C14N stack. */
function canonicalAssertion(id: string, subject: string, notBefore: string, notOnOrAfter: string): string {
  return (
    `<saml:Assertion ID="${id}" Version="2.0">` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"/>` +
    `<saml:Subject><saml:NameID>${subject}</saml:NameID></saml:Subject>` +
    `</saml:Assertion>`
  );
}

export function createSyntheticSamlIdp(): SyntheticSamlIdp {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certificatePem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

  function sign(canonical: string): string {
    return createSign('RSA-SHA256').update(canonical, 'utf8').sign(privateKey, 'base64');
  }

  function envelope(parts: {
    id: string;
    subject: string;
    notBefore: string;
    notOnOrAfter: string;
    sigAlg: string;
    signatureValue: string | null;
    refId: string; // the ID the <Reference> points at (≠ id ⇒ wrapping)
    extraInjected?: string; // an unsigned injected assertion (wrapping attack)
  }): string {
    const inner = canonicalAssertion(parts.id, parts.subject, parts.notBefore, parts.notOnOrAfter);
    const sig =
      parts.signatureValue === null
        ? ''
        : `<ds:Signature>` +
          `<ds:SignedInfo><ds:SignatureMethod Algorithm="${parts.sigAlg}"/>` +
          `<ds:Reference URI="#${parts.refId}"><ds:DigestValue>${digest(inner)}</ds:DigestValue></ds:Reference>` +
          `</ds:SignedInfo><ds:SignatureValue>${parts.signatureValue}</ds:SignatureValue></ds:Signature>`;
    return `<samlp:Response>${parts.extraInjected ?? ''}${inner.replace('</saml:Assertion>', `${sig}</saml:Assertion>`)}</samlp:Response>`;
  }

  function mint(variant: SamlVariant, opts?: { subject?: string }): string {
    const id = 'a-' + variant;
    const subject = opts?.subject ?? 'user_42@example.com-opaque';
    const now = Date.now();
    const iso = (ms: number): string => new Date(ms).toISOString();
    const past = iso(now - 3_600_000);
    const future = iso(now + 3_600_000);
    const canonical = canonicalAssertion(id, subject, past, future);

    switch (variant) {
      case 'valid':
        return envelope({ id, subject, notBefore: past, notOnOrAfter: future, sigAlg: SIG_ALG_RSA_SHA256, signatureValue: sign(canonical), refId: id });
      case 'unsigned':
        return envelope({ id, subject, notBefore: past, notOnOrAfter: future, sigAlg: SIG_ALG_RSA_SHA256, signatureValue: null, refId: id });
      case 'alg-none':
        return envelope({ id, subject, notBefore: past, notOnOrAfter: future, sigAlg: SIG_ALG_NONE, signatureValue: '', refId: id });
      case 'bad-signature':
        return envelope({ id, subject, notBefore: past, notOnOrAfter: future, sigAlg: SIG_ALG_RSA_SHA256, signatureValue: Buffer.from('forged').toString('base64'), refId: id });
      case 'expired': {
        const c = canonicalAssertion(id, subject, iso(now - 7_200_000), past);
        return envelope({ id, subject, notBefore: iso(now - 7_200_000), notOnOrAfter: past, sigAlg: SIG_ALG_RSA_SHA256, signatureValue: sign(c), refId: id });
      }
      case 'not-yet-valid': {
        const c = canonicalAssertion(id, subject, future, iso(now + 7_200_000));
        return envelope({ id, subject, notBefore: future, notOnOrAfter: iso(now + 7_200_000), sigAlg: SIG_ALG_RSA_SHA256, signatureValue: sign(c), refId: id });
      }
      case 'signature-wrapping': {
        // Signature validly covers a benign assertion (refId = benign), but a
        // second, attacker-injected assertion with a different Subject is what
        // a naive consumer reads. The signed element ≠ the consumed element.
        const benign = 'a-benign';
        const benignCanonical = canonicalAssertion(benign, subject, past, future);
        const injected = canonicalAssertion(id, 'attacker@evil.example-opaque', past, future);
        const sig =
          `<ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${SIG_ALG_RSA_SHA256}"/>` +
          `<ds:Reference URI="#${benign}"><ds:DigestValue>${digest(benignCanonical)}</ds:DigestValue></ds:Reference>` +
          `</ds:SignedInfo><ds:SignatureValue>${sign(benignCanonical)}</ds:SignatureValue></ds:Signature>`;
        // Consumed (first) assertion carries the signature but is the INJECTED one.
        return `<samlp:Response>${injected.replace('</saml:Assertion>', `${sig}</saml:Assertion>`)}${benignCanonical}</samlp:Response>`;
      }
    }
  }

  function verify(assertionXml: string): SamlVerifyResult {
    const sigAlg = /<ds:SignatureMethod Algorithm="([^"]+)"/.exec(assertionXml)?.[1];
    const sigValue = /<ds:SignatureValue>([^<]*)<\/ds:SignatureValue>/.exec(assertionXml)?.[1];
    const refId = /<ds:Reference URI="#([^"]+)"/.exec(assertionXml)?.[1];
    // The consumed assertion is the FIRST <saml:Assertion> in the response.
    const consumed = /<saml:Assertion ID="([^"]+)"[^>]*>[\s\S]*?<saml:Conditions NotBefore="([^"]+)" NotOnOrAfter="([^"]+)"\/>[\s\S]*?<saml:NameID>([^<]*)<\/saml:NameID>/.exec(assertionXml);
    if (consumed === null) return { valid: false, reason: 'malformed' };
    const [, consumedId, notBefore, notOnOrAfter, subject] = consumed;

    if (sigValue === undefined || sigAlg === undefined) return { valid: false, reason: 'unsigned' };
    if (sigAlg === SIG_ALG_NONE) return { valid: false, reason: 'alg-none' };
    // Anti-wrapping: the signature MUST reference the consumed assertion.
    if (refId !== consumedId) return { valid: false, reason: 'signature-wrapping' };

    const canonical = canonicalAssertion(consumedId, subject, notBefore, notOnOrAfter);
    const ok = createVerify('RSA-SHA256').update(canonical, 'utf8').verify(publicKey, sigValue, 'base64');
    if (!ok) return { valid: false, reason: 'bad-signature' };

    const now = Date.now();
    if (now < Date.parse(notBefore)) return { valid: false, reason: 'not-yet-valid' };
    if (now >= Date.parse(notOnOrAfter)) return { valid: false, reason: 'expired' };
    return { valid: true, reason: null };
  }

  return { certificatePem, mint, verify };
}
