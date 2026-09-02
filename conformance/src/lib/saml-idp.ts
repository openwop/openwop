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
 * ## Trust roots (RFC 0163 §B)
 *
 * Each instance carries a distinct `entityID` — the SAML `Issuer` it stamps
 * into (and signs into) every assertion. Two instances with different
 * `entityID`s model two **independent IdP trust roots**: they have distinct
 * signing keys AND distinct issuers, so an assertion minted by IdP-B does not
 * verify against IdP-A's certificate and its `Issuer` does not match IdP-A's
 * entityID. This is the fixture the RFC 0163 §B same-IdP-trust-root behavioral
 * leg needs: two IdPs can mint an assertion for the **same** opaque `subject`
 * (an identifier collision) while remaining cryptographically and by-issuer
 * distinguishable, so a host that joins the SAML and SCIM lanes MUST refuse to
 * link across the two roots. `issuerOf()` exposes the (signed) `Issuer` so a
 * scenario — or a host — can assert same-trust-root correspondence before
 * forming a link.
 *
 * @see RFCS/0050-saml-scim-enterprise-identity-profiles.md §A
 * @see RFCS/0163-subject-linking-hardening.md §B (same-IdP trust root)
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

export interface SyntheticSamlIdpOptions {
  /**
   * This IdP's SAML `entityID`, stamped and signed into every assertion as the
   * `<saml:Issuer>` and exposed as `.entityID`. Two instances with distinct
   * `entityID`s model two independent trust roots (RFC 0163 §B). Defaults to a
   * fixed canonical value so a lone instance behaves exactly as before.
   */
  readonly entityID?: string;
}

/** The default single-IdP entityID (unchanged behaviour for a lone instance). */
export const DEFAULT_SAML_ENTITY_ID = 'urn:openwop:conformance:idp';

export interface SyntheticSamlIdp {
  /** PEM signing certificate (public key) the host configures to trust this IdP. */
  readonly certificatePem: string;
  /**
   * This IdP's SAML `entityID` — the `<saml:Issuer>` it signs into every
   * assertion, and the trust-root identity a host records for the connection.
   * Distinct per instance (RFC 0163 §B).
   */
  readonly entityID: string;
  /** Mint a SAML assertion of the given variant. */
  mint(variant: SamlVariant, opts?: { subject?: string }): string;
  /** Validate an assertion per the RFC 0050 §A MUST list. */
  verify(assertionXml: string): SamlVerifyResult;
  /**
   * The `Issuer` (entityID) carried by the consumed assertion, or `null` if the
   * assertion is malformed. RFC 0163 §B: a host compares this against the SCIM
   * connection's recorded IdP entityID and MUST NOT form a link across two
   * distinct trust roots even when the opaque subject id collides.
   */
  issuerOf(assertionXml: string): string | null;
}

const SIG_ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SIG_ALG_NONE = 'http://www.w3.org/2000/09/xmldsig#none';

function digest(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64');
}

/** Deterministic canonical form of the signed element: the harness controls
 * the exact byte string, so sign/verify agree without a full C14N stack. The
 * `<saml:Issuer>` is inside the signed element (RFC 0163 §B: the trust-root
 * identity is signed, so it cannot be swapped post-signing). */
function canonicalAssertion(id: string, issuer: string, subject: string, notBefore: string, notOnOrAfter: string): string {
  return (
    `<saml:Assertion ID="${id}" Version="2.0">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"/>` +
    `<saml:Subject><saml:NameID>${subject}</saml:NameID></saml:Subject>` +
    `</saml:Assertion>`
  );
}

export function createSyntheticSamlIdp(opts?: SyntheticSamlIdpOptions): SyntheticSamlIdp {
  const entityID = opts?.entityID ?? DEFAULT_SAML_ENTITY_ID;
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
    const inner = canonicalAssertion(parts.id, entityID, parts.subject, parts.notBefore, parts.notOnOrAfter);
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
    const canonical = canonicalAssertion(id, entityID, subject, past, future);

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
        const c = canonicalAssertion(id, entityID, subject, iso(now - 7_200_000), past);
        return envelope({ id, subject, notBefore: iso(now - 7_200_000), notOnOrAfter: past, sigAlg: SIG_ALG_RSA_SHA256, signatureValue: sign(c), refId: id });
      }
      case 'not-yet-valid': {
        const c = canonicalAssertion(id, entityID, subject, future, iso(now + 7_200_000));
        return envelope({ id, subject, notBefore: future, notOnOrAfter: iso(now + 7_200_000), sigAlg: SIG_ALG_RSA_SHA256, signatureValue: sign(c), refId: id });
      }
      case 'signature-wrapping': {
        // Signature validly covers a benign assertion (refId = benign), but a
        // second, attacker-injected assertion with a different Subject is what
        // a naive consumer reads. The signed element ≠ the consumed element.
        const benign = 'a-benign';
        const benignCanonical = canonicalAssertion(benign, entityID, subject, past, future);
        const injected = canonicalAssertion(id, entityID, 'attacker@evil.example-opaque', past, future);
        const sig =
          `<ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${SIG_ALG_RSA_SHA256}"/>` +
          `<ds:Reference URI="#${benign}"><ds:DigestValue>${digest(benignCanonical)}</ds:DigestValue></ds:Reference>` +
          `</ds:SignedInfo><ds:SignatureValue>${sign(benignCanonical)}</ds:SignatureValue></ds:Signature>`;
        // Consumed (first) assertion carries the signature but is the INJECTED one.
        return `<samlp:Response>${injected.replace('</saml:Assertion>', `${sig}</saml:Assertion>`)}${benignCanonical}</samlp:Response>`;
      }
    }
  }

  /** Parse the consumed (first) assertion; `null` if it is malformed. */
  function parseConsumed(assertionXml: string): { id: string; issuer: string; notBefore: string; notOnOrAfter: string; subject: string } | null {
    // The consumed assertion is the FIRST <saml:Assertion> in the response.
    const m = /<saml:Assertion ID="([^"]+)"[^>]*>[\s\S]*?<saml:Issuer>([^<]*)<\/saml:Issuer>[\s\S]*?<saml:Conditions NotBefore="([^"]+)" NotOnOrAfter="([^"]+)"\/>[\s\S]*?<saml:NameID>([^<]*)<\/saml:NameID>/.exec(assertionXml);
    if (m === null) return null;
    const [, id, issuer, notBefore, notOnOrAfter, subject] = m;
    return { id, issuer, notBefore, notOnOrAfter, subject };
  }

  function issuerOf(assertionXml: string): string | null {
    return parseConsumed(assertionXml)?.issuer ?? null;
  }

  function verify(assertionXml: string): SamlVerifyResult {
    const sigAlg = /<ds:SignatureMethod Algorithm="([^"]+)"/.exec(assertionXml)?.[1];
    const sigValue = /<ds:SignatureValue>([^<]*)<\/ds:SignatureValue>/.exec(assertionXml)?.[1];
    const refId = /<ds:Reference URI="#([^"]+)"/.exec(assertionXml)?.[1];
    const consumed = parseConsumed(assertionXml);
    if (consumed === null) return { valid: false, reason: 'malformed' };
    const { id: consumedId, issuer, notBefore, notOnOrAfter, subject } = consumed;

    if (sigValue === undefined || sigAlg === undefined) return { valid: false, reason: 'unsigned' };
    if (sigAlg === SIG_ALG_NONE) return { valid: false, reason: 'alg-none' };
    // Anti-wrapping: the signature MUST reference the consumed assertion.
    if (refId !== consumedId) return { valid: false, reason: 'signature-wrapping' };

    // The signed canonical includes the Issuer (RFC 0163 §B): an assertion from
    // a DIFFERENT trust root carries a different Issuer AND is signed by a
    // different key, so verification against THIS IdP's public key fails
    // (`bad-signature`). The crypto separation IS the trust-root separation.
    const canonical = canonicalAssertion(consumedId, issuer, subject, notBefore, notOnOrAfter);
    const ok = createVerify('RSA-SHA256').update(canonical, 'utf8').verify(publicKey, sigValue, 'base64');
    if (!ok) return { valid: false, reason: 'bad-signature' };

    const now = Date.now();
    if (now < Date.parse(notBefore)) return { valid: false, reason: 'not-yet-valid' };
    if (now >= Date.parse(notOnOrAfter)) return { valid: false, reason: 'expired' };
    return { valid: true, reason: null };
  }

  return { certificatePem, entityID, mint, verify, issuerOf };
}
