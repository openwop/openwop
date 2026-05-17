/**
 * OIDC ID-token verification for the workflow-engine reference app.
 *
 * Implements the verification half of `auth-profiles.md`
 * §`openwop-auth-oidc-user-bearer` — accepted as the third auth path
 * in `auth.ts` (alongside Bearer API-key + session-cookie).
 *
 * Ported from examples/hosts/postgres/src/jwt-validator.ts with one
 * tweak: the JWKS URL is configurable instead of being derived from
 * `<issuer>/.well-known/jwks.json`. Firebase Auth publishes its JWKS
 * at a non-standard path
 * (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`),
 * so the workflow-engine app reads `OPENWOP_OIDC_JWKS_URL` from env.
 *
 * **Wire contract** (per `auth-profiles.md §openwop-auth-oidc-user-bearer`):
 *
 *   1. Token MUST be three dot-separated segments (header.payload.signature).
 *   2. Header `alg` MUST be in the host's supportedAlgorithms list
 *      (default: ["RS256"]). Reject `alg: "none"` always.
 *   3. Header `kid` MUST resolve to a key in the issuer's published JWKS.
 *   4. Signature MUST verify against the resolved key.
 *   5. Claim `iss` MUST equal the host's configured issuer URL.
 *   6. Claim `aud` MUST contain the host's configured audience.
 *   7. Claim `exp` MUST be in the future (clock skew: ±60s).
 *   8. Claim `iat` MUST be present and a number.
 *
 * Firebase Auth specifics:
 *   - Issuer:  https://securetoken.google.com/<firebase-project-id>
 *   - Audience: <firebase-project-id>
 *   - JWKS URL: https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 *   - Algorithm: RS256 (Firebase doesn't issue ES256 ID tokens)
 *   - Subject:  Firebase UID; stable per-user, opaque to openwop
 *
 * No npm deps; pure node:crypto + global fetch.
 *
 * @see spec/v1/auth-profiles.md §`openwop-auth-oidc-user-bearer`
 * @see SECURITY/threat-model-auth-profiles.md
 */

import { createVerify, createPublicKey, type KeyObject, type JsonWebKeyInput } from 'node:crypto';

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_S = 60;

export type SupportedAlgorithm = 'RS256' | 'ES256';

export interface OidcVerifierConfig {
  /** Expected `iss` claim (e.g., `https://securetoken.google.com/openwop-dev`). */
  readonly issuer: string;
  /** Expected `aud` claim (Firebase project id for Firebase Auth). */
  readonly audience: string;
  /** Where to fetch the issuer's JWKS. Overrides the
   *  `<issuer>/.well-known/jwks.json` default so Firebase Auth's
   *  non-standard JWKS path works. */
  readonly jwksUrl?: string;
  /** Algorithms the verifier accepts. Default `["RS256"]` — Firebase
   *  only issues RS256 tokens; production deployers using ES256 IdPs
   *  pass `["RS256", "ES256"]`. */
  readonly supportedAlgorithms?: ReadonlyArray<SupportedAlgorithm>;
  /** Clock-skew tolerance in seconds. Default 60. */
  readonly clockSkewSeconds?: number;
}

export interface OidcClaims {
  readonly iss: string;
  readonly aud: string | ReadonlyArray<string>;
  readonly exp: number;
  readonly iat: number;
  readonly sub: string;
  readonly nbf?: number;
  readonly email?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

export class OidcVerificationError extends Error {
  constructor(
    public readonly code:
      | 'malformed_jwt'
      | 'unsupported_algorithm'
      | 'unknown_kid'
      | 'invalid_signature'
      | 'wrong_issuer'
      | 'wrong_audience'
      | 'expired'
      | 'not_yet_valid'
      | 'missing_iat'
      | 'missing_sub'
      | 'jwks_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'OidcVerificationError';
  }
}

interface JwksKey {
  readonly kid: string;
  readonly key: KeyObject;
  readonly alg: SupportedAlgorithm;
}

interface JwksCache {
  readonly keys: ReadonlyArray<JwksKey>;
  readonly fetchedAt: number;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    '=',
  );
  return Buffer.from(padded, 'base64');
}

function isSupportedAlgorithm(x: unknown): x is SupportedAlgorithm {
  return x === 'RS256' || x === 'ES256';
}

function normalizeSignature(alg: SupportedAlgorithm, raw: Buffer): Buffer {
  if (alg !== 'ES256') return raw;
  if (raw.length !== 64) {
    throw new OidcVerificationError('invalid_signature', 'ES256 signature must be 64 bytes');
  }
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32, 64);
  return derEncodeEcdsa(r, s);
}

function derEncodeEcdsa(r: Buffer, s: Buffer): Buffer {
  const trim = (b: Buffer): Buffer => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let out = b.subarray(i);
    if ((out[0]! & 0x80) !== 0) out = Buffer.concat([Buffer.from([0]), out]);
    return out;
  };
  const rb = trim(r);
  const sb = trim(s);
  const rEnc = Buffer.concat([Buffer.from([0x02, rb.length]), rb]);
  const sEnc = Buffer.concat([Buffer.from([0x02, sb.length]), sb]);
  const seqBody = Buffer.concat([rEnc, sEnc]);
  return Buffer.concat([Buffer.from([0x30, seqBody.length]), seqBody]);
}

export class OidcVerifier {
  private cache: JwksCache | null = null;

  constructor(private readonly config: OidcVerifierConfig) {
    if (!config.issuer) throw new Error('OidcVerifier: config.issuer is required');
    if (!config.audience) throw new Error('OidcVerifier: config.audience is required');
  }

  get issuer(): string { return this.config.issuer; }
  get audience(): string { return this.config.audience; }
  get jwksUrl(): string {
    return this.config.jwksUrl ?? `${this.config.issuer.replace(/\/+$/, '')}/.well-known/jwks.json`;
  }
  get supportedAlgorithms(): ReadonlyArray<SupportedAlgorithm> {
    return this.config.supportedAlgorithms ?? ['RS256'];
  }
  get clockSkewSeconds(): number {
    return this.config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_S;
  }

  /** Force a fresh JWKS fetch on the next validate(). */
  invalidateJwksCache(): void { this.cache = null; }

  private async fetchJwks(): Promise<ReadonlyArray<JwksKey>> {
    let response: Response;
    try {
      response = await fetch(this.jwksUrl);
    } catch (err: unknown) {
      throw new OidcVerificationError(
        'jwks_unavailable',
        `JWKS fetch from "${this.jwksUrl}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new OidcVerificationError(
        'jwks_unavailable',
        `JWKS fetch from "${this.jwksUrl}" returned HTTP ${response.status}`,
      );
    }
    const raw = await response.json() as Record<string, unknown>;
    const keys: JwksKey[] = [];

    // Firebase publishes a plain object `{"<kid>": "<PEM>", ...}` at
    // its JWKS URL — NOT the standard `{ keys: [{ kid, kty, ... }] }`
    // shape. Detect both formats so this verifier works against
    // Firebase AND any standards-compliant OIDC provider.
    if (Array.isArray(raw.keys)) {
      for (const k of raw.keys as Array<Record<string, unknown>>) {
        if (typeof k.kid !== 'string') continue;
        const alg = typeof k.alg === 'string' && isSupportedAlgorithm(k.alg) ? k.alg : 'RS256';
        try {
          const jwk: JsonWebKeyInput['key'] = {
            kty: typeof k.kty === 'string' ? k.kty : 'RSA',
            ...(typeof k.n === 'string' ? { n: k.n } : {}),
            ...(typeof k.e === 'string' ? { e: k.e } : {}),
            ...(typeof k.crv === 'string' ? { crv: k.crv } : {}),
            ...(typeof k.x === 'string' ? { x: k.x } : {}),
            ...(typeof k.y === 'string' ? { y: k.y } : {}),
          };
          const key = createPublicKey({ key: jwk, format: 'jwk' });
          keys.push({ kid: k.kid, key, alg });
        } catch {
          /* skip malformed entries */
        }
      }
    } else {
      // Firebase shape: { "<kid>": "<x509-pem>" }
      for (const [kid, pem] of Object.entries(raw)) {
        if (typeof pem !== 'string') continue;
        try {
          const key = createPublicKey(pem);
          keys.push({ kid, key, alg: 'RS256' });
        } catch {
          /* skip */
        }
      }
    }
    return keys;
  }

  private async resolveKey(kid: string): Promise<JwksKey> {
    const now = Date.now();
    if (this.cache !== null && now - this.cache.fetchedAt < JWKS_CACHE_TTL_MS) {
      const hit = this.cache.keys.find((k) => k.kid === kid);
      if (hit) return hit;
    }
    const fresh = await this.fetchJwks();
    this.cache = { keys: fresh, fetchedAt: now };
    const hit = fresh.find((k) => k.kid === kid);
    if (!hit) {
      throw new OidcVerificationError(
        'unknown_kid',
        `JWT header references kid="${kid}" but no matching key in issuer JWKS`,
      );
    }
    return hit;
  }

  /** Verify a JWT bearer token. Throws OidcVerificationError on any
   *  failure; returns the parsed claims on success. */
  async verify(token: string): Promise<OidcClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new OidcVerificationError(
        'malformed_jwt',
        'JWT bearer MUST be three dot-separated segments',
      );
    }
    const [headerSeg, payloadSeg, signatureSeg] = parts as [string, string, string];

    let header: Record<string, unknown>;
    try {
      header = JSON.parse(base64UrlDecode(headerSeg).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new OidcVerificationError('malformed_jwt', 'JWT header is not valid base64url JSON');
    }
    const alg = header.alg;
    if (alg === 'none' || typeof alg !== 'string' || !isSupportedAlgorithm(alg)) {
      throw new OidcVerificationError(
        'unsupported_algorithm',
        `JWT alg="${String(alg)}" not supported`,
      );
    }
    if (!this.supportedAlgorithms.includes(alg)) {
      throw new OidcVerificationError(
        'unsupported_algorithm',
        `JWT alg="${alg}" not advertised by this host`,
      );
    }
    if (typeof header.kid !== 'string' || !header.kid) {
      throw new OidcVerificationError('malformed_jwt', 'JWT header MUST include a non-empty kid');
    }
    const key = await this.resolveKey(header.kid);
    if (key.alg !== alg) {
      throw new OidcVerificationError(
        'unsupported_algorithm',
        `JWT alg="${alg}" does not match key alg="${key.alg}"`,
      );
    }

    const signingInput = `${headerSeg}.${payloadSeg}`;
    const signatureRaw = base64UrlDecode(signatureSeg);
    const signatureForVerify = normalizeSignature(alg, signatureRaw);
    const verifier = createVerify('sha256');
    verifier.update(signingInput, 'utf8');
    if (!verifier.verify(key.key, signatureForVerify)) {
      throw new OidcVerificationError('invalid_signature', 'JWT signature does not verify');
    }

    let claims: OidcClaims;
    try {
      claims = JSON.parse(base64UrlDecode(payloadSeg).toString('utf8')) as OidcClaims;
    } catch {
      throw new OidcVerificationError('malformed_jwt', 'JWT payload is not valid base64url JSON');
    }

    if (claims.iss !== this.config.issuer) {
      throw new OidcVerificationError(
        'wrong_issuer',
        `JWT iss="${String(claims.iss)}" does not match host issuer`,
      );
    }
    const audMatches = Array.isArray(claims.aud)
      ? claims.aud.includes(this.config.audience)
      : claims.aud === this.config.audience;
    if (!audMatches) {
      throw new OidcVerificationError(
        'wrong_audience',
        `JWT aud does not include host audience`,
      );
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof claims.iat !== 'number') {
      throw new OidcVerificationError('missing_iat', 'JWT MUST include numeric iat');
    }
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds - this.clockSkewSeconds) {
      throw new OidcVerificationError('expired', 'JWT is expired');
    }
    if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + this.clockSkewSeconds) {
      throw new OidcVerificationError('not_yet_valid', 'JWT nbf is in the future');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new OidcVerificationError('missing_sub', 'JWT MUST include non-empty sub');
    }
    return claims;
  }
}

/**
 * Read verifier config from env. Returns `null` if not configured
 * (caller falls back to the API-key allow-list path).
 *
 *   OPENWOP_OIDC_ISSUER    — required; Firebase: https://securetoken.google.com/<project-id>
 *   OPENWOP_OIDC_AUDIENCE  — required; Firebase: the project id itself
 *   OPENWOP_OIDC_JWKS_URL  — optional; Firebase:
 *     https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 */
export function readOidcConfigFromEnv(): OidcVerifierConfig | null {
  const issuer = process.env.OPENWOP_OIDC_ISSUER;
  const audience = process.env.OPENWOP_OIDC_AUDIENCE;
  if (!issuer || !audience) return null;
  const cfg: OidcVerifierConfig = { issuer, audience };
  const jwksUrl = process.env.OPENWOP_OIDC_JWKS_URL;
  return jwksUrl ? { ...cfg, jwksUrl } : cfg;
}
