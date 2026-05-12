/**
 * JWT validator for OAuth2 / OIDC bearer tokens on the Postgres host.
 *
 * Implements the verification half of `auth-profiles.md`
 * §`openwop-auth-oauth2-client-credentials` + §`openwop-auth-oidc-user-bearer`.
 * The synthetic issuer that mints test tokens lives at
 * `conformance/src/lib/oidc-issuer.ts`; this module is the host-side
 * counterpart that fetches the issuer's JWKS, verifies signatures,
 * and validates the JWT envelope.
 *
 * **Wire contract** (per `auth-profiles.md`):
 *
 *   1. Token MUST be three dot-separated segments (header.payload.signature).
 *   2. Header `alg` MUST be in the host's `supportedAlgorithms` list
 *      (default: `["RS256", "ES256"]`). Reject `alg: "none"` always.
 *   3. Header `kid` MUST resolve to a key in the issuer's published JWKS.
 *   4. Signature MUST verify against the resolved key.
 *   5. Claim `iss` MUST equal the host's configured issuer URL.
 *   6. Claim `aud` MUST contain the host's configured audience.
 *   7. Claim `exp` MUST be in the future (clock skew: ±60s).
 *   8. Claim `nbf` (if present) MUST be in the past (clock skew: ±60s).
 *   9. Claim `iat` MUST be present.
 *
 * Any failure → `JwtValidationError` with a stable code; the caller
 * maps to a `401 invalid_credential` envelope WITHOUT echoing the
 * rejected token (auth.md §"No credential echo").
 *
 * **JWKS caching.** The validator caches the JWKS for 10 minutes after
 * fetch. On `kid` mismatch (possible key rotation), it fetches fresh
 * once and retries; if still no match, rejects with `unknown_kid`.
 *
 * **Hermeticity.** Uses only `node:crypto` + `fetch` (Node ≥ 20 builtin).
 * No npm dependencies; production deployers can swap in a hardened
 * library (jose, etc.) behind the same interface.
 *
 * @see spec/v1/auth-profiles.md §`openwop-auth-oauth2-client-credentials`
 * @see spec/v1/auth-profiles.md §`openwop-auth-oidc-user-bearer`
 * @see conformance/src/lib/oidc-issuer.ts (test harness)
 * @see SECURITY/threat-model-auth-profiles.md
 */

import { createVerify, createPublicKey, type KeyObject } from 'node:crypto';

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_S = 60;

export type SupportedAlgorithm = 'RS256' | 'ES256';

export interface JwtValidatorConfig {
  /** Expected issuer URL (matches the JWT's `iss` claim). */
  readonly issuer: string;
  /** Expected audience (matches the JWT's `aud` claim). */
  readonly audience: string;
  /** Algorithms the host accepts. Default `["RS256", "ES256"]`. */
  readonly supportedAlgorithms?: ReadonlyArray<SupportedAlgorithm>;
  /** Clock-skew tolerance in seconds. Default 60. */
  readonly clockSkewSeconds?: number;
}

export interface JwtClaims {
  readonly iss: string;
  readonly aud: string | ReadonlyArray<string>;
  readonly exp: number;
  readonly iat: number;
  readonly nbf?: number;
  readonly sub?: string;
  readonly scope?: string;
  readonly [key: string]: unknown;
}

export class JwtValidationError extends Error {
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
      | 'jwks_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'JwtValidationError';
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

/**
 * Convert ES256 IEEE-P1363 raw signature (64 bytes, r||s) to ASN.1 DER
 * (which `crypto.verify(es256, ...)` expects in Node). RS256 signatures
 * pass through unchanged.
 */
function normalizeSignature(alg: SupportedAlgorithm, raw: Buffer): Buffer {
  if (alg !== 'ES256') return raw;
  if (raw.length !== 64) {
    throw new JwtValidationError('invalid_signature', 'ES256 signature must be 64 bytes');
  }
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32, 64);
  return derEncodeEcdsa(r, s);
}

function derEncodeEcdsa(r: Buffer, s: Buffer): Buffer {
  // Strip leading zero bytes (positive integers); add one back if the
  // top bit is set so DER reads the value as positive.
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

export class JwtValidator {
  private _cache: JwksCache | null = null;

  constructor(private readonly config: JwtValidatorConfig) {
    if (!config.issuer) throw new Error('JwtValidator: config.issuer is required');
    if (!config.audience) throw new Error('JwtValidator: config.audience is required');
  }

  /** Expected issuer URL (matches the JWT's `iss` claim). */
  get issuer(): string { return this.config.issuer; }
  /** Expected audience (matches the JWT's `aud` claim). */
  get audience(): string { return this.config.audience; }

  get supportedAlgorithms(): ReadonlyArray<SupportedAlgorithm> {
    return this.config.supportedAlgorithms ?? ['RS256', 'ES256'];
  }

  get clockSkewSeconds(): number {
    return this.config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_S;
  }

  /** Force a fresh JWKS fetch on next validation. Use after key-rotation events. */
  invalidateJwksCache(): void {
    this._cache = null;
  }

  private async fetchJwks(): Promise<ReadonlyArray<JwksKey>> {
    const jwksUrl = `${this.config.issuer.replace(/\/+$/, '')}/.well-known/jwks.json`;
    let response: Response;
    try {
      response = await fetch(jwksUrl);
    } catch (err: unknown) {
      throw new JwtValidationError(
        'jwks_unavailable',
        `JWKS fetch from "${jwksUrl}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new JwtValidationError(
        'jwks_unavailable',
        `JWKS fetch from "${jwksUrl}" returned HTTP ${response.status}`,
      );
    }
    const body = (await response.json()) as { keys?: Array<Record<string, unknown>> };
    const rawKeys = Array.isArray(body.keys) ? body.keys : [];
    const keys: JwksKey[] = [];
    for (const k of rawKeys) {
      if (typeof k.kid !== 'string' || typeof k.alg !== 'string') continue;
      if (!isSupportedAlgorithm(k.alg)) continue;
      try {
        // createPublicKey({format: 'jwk'}) accepts a JsonWebKey shape;
        // narrow `k` to the structural JWK by extracting only the
        // fields RS256/ES256 actually need (no banned-pattern double
        // cast required — JsonWebKey is structurally compatible with
        // an indexable object of strings).
        const jwk: import('node:crypto').JsonWebKeyInput['key'] = {
          kty: typeof k.kty === 'string' ? k.kty : '',
          ...(typeof k.n === 'string' ? { n: k.n } : {}),
          ...(typeof k.e === 'string' ? { e: k.e } : {}),
          ...(typeof k.crv === 'string' ? { crv: k.crv } : {}),
          ...(typeof k.x === 'string' ? { x: k.x } : {}),
          ...(typeof k.y === 'string' ? { y: k.y } : {}),
        };
        const key = createPublicKey({ key: jwk, format: 'jwk' });
        keys.push({ kid: k.kid, key, alg: k.alg });
      } catch {
        // Skip unparseable JWK entries; production deployers should
        // log this through their observability pipeline.
      }
    }
    return keys;
  }

  private async resolveKey(kid: string): Promise<JwksKey> {
    const now = Date.now();
    if (this._cache !== null && now - this._cache.fetchedAt < JWKS_CACHE_TTL_MS) {
      const hit = this._cache.keys.find((k) => k.kid === kid);
      if (hit) return hit;
    }
    // Cache miss OR stale; fetch fresh.
    const fresh = await this.fetchJwks();
    this._cache = { keys: fresh, fetchedAt: now };
    const hit = fresh.find((k) => k.kid === kid);
    if (!hit) {
      throw new JwtValidationError(
        'unknown_kid',
        `JWT header references kid="${kid}" but no matching key in issuer JWKS`,
      );
    }
    return hit;
  }

  /**
   * Validate a JWT bearer token. Throws `JwtValidationError` on any
   * failure; returns the parsed claims on success.
   */
  async validate(token: string): Promise<JwtClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new JwtValidationError(
        'malformed_jwt',
        'JWT bearer MUST be three dot-separated segments (header.payload.signature)',
      );
    }
    const [headerSeg, payloadSeg, signatureSeg] = parts as [string, string, string];

    let header: Record<string, unknown>;
    try {
      header = JSON.parse(base64UrlDecode(headerSeg).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new JwtValidationError('malformed_jwt', 'JWT header is not valid base64url JSON');
    }
    const alg = header.alg;
    if (alg === 'none' || typeof alg !== 'string' || !isSupportedAlgorithm(alg)) {
      throw new JwtValidationError(
        'unsupported_algorithm',
        `JWT header alg="${String(alg)}" is not in the host's supportedAlgorithms`,
      );
    }
    if (!this.supportedAlgorithms.includes(alg)) {
      throw new JwtValidationError(
        'unsupported_algorithm',
        `JWT header alg="${alg}" is not advertised by this host`,
      );
    }
    if (typeof header.kid !== 'string' || !header.kid) {
      throw new JwtValidationError('malformed_jwt', 'JWT header MUST include a non-empty `kid`');
    }
    const key = await this.resolveKey(header.kid);
    if (key.alg !== alg) {
      throw new JwtValidationError(
        'unsupported_algorithm',
        `JWT header alg="${alg}" does not match key alg="${key.alg}"`,
      );
    }

    const signingInput = `${headerSeg}.${payloadSeg}`;
    const signatureRaw = base64UrlDecode(signatureSeg);
    const signatureForVerify = normalizeSignature(alg, signatureRaw);
    const verifier = createVerify('sha256');
    verifier.update(signingInput, 'utf8');
    if (!verifier.verify(key.key, signatureForVerify)) {
      throw new JwtValidationError('invalid_signature', 'JWT signature does not verify');
    }

    let claims: JwtClaims;
    try {
      claims = JSON.parse(base64UrlDecode(payloadSeg).toString('utf8')) as JwtClaims;
    } catch {
      throw new JwtValidationError('malformed_jwt', 'JWT payload is not valid base64url JSON');
    }

    if (claims.iss !== this.config.issuer) {
      throw new JwtValidationError(
        'wrong_issuer',
        `JWT iss="${String(claims.iss)}" does not match host issuer "${this.config.issuer}"`,
      );
    }
    const audMatches = Array.isArray(claims.aud)
      ? claims.aud.includes(this.config.audience)
      : claims.aud === this.config.audience;
    if (!audMatches) {
      throw new JwtValidationError(
        'wrong_audience',
        `JWT aud does not include host audience "${this.config.audience}"`,
      );
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof claims.iat !== 'number') {
      throw new JwtValidationError('missing_iat', 'JWT MUST include numeric iat claim');
    }
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds - this.clockSkewSeconds) {
      throw new JwtValidationError('expired', 'JWT exp claim is in the past (or missing)');
    }
    if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + this.clockSkewSeconds) {
      throw new JwtValidationError('not_yet_valid', 'JWT nbf claim is in the future');
    }
    return claims;
  }
}

/**
 * Read JWT validator config from env. Returns `null` when the
 * required env vars are not present (caller falls back to legacy
 * bearer-equality check). Per `auth-profiles.md`, hosts MUST NOT
 * silently mock JWT validation — either the validator is fully
 * configured or it's off.
 *
 *   OPENWOP_OAUTH2_ISSUER_URL  — issuer base URL (matches `iss`)
 *   OPENWOP_OAUTH2_AUDIENCE    — expected `aud`
 */
export function readOAuth2ConfigFromEnv(): JwtValidatorConfig | null {
  const issuer = process.env.OPENWOP_OAUTH2_ISSUER_URL;
  const audience = process.env.OPENWOP_OAUTH2_AUDIENCE;
  if (!issuer || !audience) return null;
  return { issuer, audience };
}

/** Same shape as OAuth2 but separate env vars so a host MAY trust both. */
export function readOIDCConfigFromEnv(): JwtValidatorConfig | null {
  const issuer = process.env.OPENWOP_OIDC_ISSUER_URL;
  const audience = process.env.OPENWOP_OIDC_AUDIENCE;
  if (!issuer || !audience) return null;
  return { issuer, audience };
}
