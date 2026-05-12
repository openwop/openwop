/**
 * Synthetic OIDC issuer for conformance scenarios.
 *
 * Implements the harness specified in RFC 0010 §E. Mints signed JWTs
 * (RS256 or ES256) and exposes the JWKS + OIDC discovery document a
 * trusting host fetches to verify them. Hermetic — uses only node:crypto
 * stdlib; no npm dependencies.
 *
 * Scope: this harness is a wire-shape probe. It is NOT a real OIDC
 * provider — there is no authorization endpoint, no userinfo endpoint,
 * no refresh-token machinery. The conformance suite uses it to mint
 * tokens with controlled claims (valid sub, wrong aud, expired exp,
 * unknown kid, etc.) and assert the host's validation behavior.
 *
 * @see RFCS/0010-auth-profile-conformance.md §E
 * @see spec/v1/auth-profiles.md §`openwop-auth-oidc-user-bearer`
 */

import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

export type JwsAlgorithm = 'RS256' | 'ES256';

export interface SyntheticOIDCIssuerOptions {
  /** Base issuer URL. Caller is responsible for binding an HTTP server
   * at this URL if end-to-end host validation is required. The harness
   * itself does not bind any port. */
  readonly issuer: string;
  /** Default audience used by `mint()` when claims don't supply one. */
  readonly audience: string;
  /** JWS algorithm. Default RS256 (widest interop). Accepts `string` so
   * conformance tests can exercise the runtime rejection path for
   * unsupported algorithms; the constructor validates at runtime. */
  readonly algorithm?: JwsAlgorithm | (string & {});
  /** Initial key id published in JWKS. Default `openwop-conformance-key-1`. */
  readonly keyId?: string;
}

export interface MintOptions {
  /** Override the JWT lifetime. Default 300 seconds. Set < 0 to mint
   * an already-expired token. */
  readonly expiresInSeconds?: number;
  /** Override the `kid` placed in the JWT header. Defaults to the
   * issuer's current `keyId`. Setting to a value not published in the
   * issuer's JWKS produces a token that signature-verifies internally
   * but is rejected by hosts because the kid cannot be resolved. */
  readonly keyId?: string;
  /** Override the JWS algorithm header (`alg`). Defaults to the
   * issuer's algorithm. Setting to a value not in the host's
   * `supportedAlgorithms` produces an algorithm-rejected token. */
  readonly algorithm?: string;
}

export interface MintedToken {
  /** Compact-serialized JWT (`<header>.<payload>.<signature>`). */
  readonly token: string;
  /** The fully-resolved claim set that was signed. */
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface SyntheticOIDCIssuer {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithm: JwsAlgorithm;
  /** Current key id (used by default in `mint()` and published in JWKS). */
  readonly keyId: string;
  /** JWKS document the host fetches at `$issuer/.well-known/jwks.json`. */
  readonly jwksJson: string;
  /** OIDC discovery document the host fetches at
   *  `$issuer/.well-known/openid-configuration`. */
  readonly discoveryJson: string;

  /** Mint a signed JWT with the supplied claims. Claims not supplied
   * are filled with defaults: `iss` (this issuer), `aud` (this
   * audience), `iat` (now), `exp` (now + 300s). Pass `iss`/`aud`/`exp`
   * explicitly to override. */
  mint(claims: Readonly<Record<string, unknown>>, opts?: MintOptions): MintedToken;

  /** Replace the current keypair with a freshly-generated one and
   * advance the `keyId`. Tokens minted before rotation are no longer
   * verifiable against the published JWKS — the underlying key is
   * discarded. Use to model post-rotation revocation in tests. */
  rotateKey(): void;
}

interface KeyMaterial {
  readonly keyId: string;
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
  /** Cached JWK form of the public key (with `kid`/`alg`/`use` mixed in). */
  readonly publicJwk: Record<string, unknown>;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isJwsAlgorithm(x: string): x is JwsAlgorithm {
  return x === 'RS256' || x === 'ES256';
}

function generateKeyMaterial(algorithm: JwsAlgorithm, keyId: string): KeyMaterial {
  const { publicKey, privateKey } =
    algorithm === 'RS256'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'P-256' });

  // node:crypto exports public keys directly to JWK form (Node ≥ 16).
  // The return type is `JsonWebKey` from the global DOM lib; we widen
  // to a structural record so we can spread + mix in OIDC-flavored
  // fields (`kid`, `alg`, `use`) without further assertions.
  const baseJwk: Record<string, unknown> = publicKey.export({ format: 'jwk' });
  const publicJwk: Record<string, unknown> = {
    ...baseJwk,
    alg: algorithm,
    use: 'sig',
    kid: keyId,
  };

  return { keyId, publicKey, privateKey, publicJwk };
}

function signCompact(
  algorithm: JwsAlgorithm,
  privateKey: KeyObject,
  signingInput: string,
): string {
  // Node's createSign uses the algorithm name to pick the digest:
  //   RSA-SHA256 → RSASSA-PKCS1-v1_5 with SHA-256 (RS256)
  //   SHA256     → ECDSA with SHA-256 (ES256)
  // For ES256, JWS REQUIRES the IEEE P1363 (R||S) signature format,
  // not the default DER. Node ≥ 17 supports `dsaEncoding: 'ieee-p1363'`
  // on createSign to produce P1363 directly.
  const digest = algorithm === 'RS256' ? 'RSA-SHA256' : 'SHA256';
  const signer = createSign(digest);
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(
    algorithm === 'RS256'
      ? privateKey
      : { key: privateKey, dsaEncoding: 'ieee-p1363' },
  );
  return base64UrlEncode(signature);
}

export function createSyntheticOIDCIssuer(
  opts: SyntheticOIDCIssuerOptions,
): SyntheticOIDCIssuer {
  const requested = opts.algorithm ?? 'RS256';
  if (!isJwsAlgorithm(requested)) {
    throw new Error(
      `[oidc-issuer] unsupported algorithm: ${String(requested)} (only RS256 and ES256 are supported)`,
    );
  }
  const algorithm: JwsAlgorithm = requested;

  if (!opts.issuer || !opts.audience) {
    throw new Error('[oidc-issuer] issuer and audience are required');
  }

  let rotationCounter = 1;
  let material = generateKeyMaterial(
    algorithm,
    opts.keyId ?? `openwop-conformance-key-${rotationCounter}`,
  );

  return {
    get issuer() {
      return opts.issuer;
    },
    get audience() {
      return opts.audience;
    },
    get algorithm() {
      return algorithm;
    },
    get keyId() {
      return material.keyId;
    },
    get jwksJson() {
      return JSON.stringify({ keys: [material.publicJwk] });
    },
    get discoveryJson() {
      return JSON.stringify({
        issuer: opts.issuer,
        jwks_uri: `${opts.issuer.replace(/\/$/, '')}/.well-known/jwks.json`,
        response_types_supported: ['id_token'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: [algorithm],
      });
    },

    mint(
      claims: Readonly<Record<string, unknown>>,
      mintOpts: MintOptions = {},
    ): MintedToken {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiresInSeconds = mintOpts.expiresInSeconds ?? 300;

      const resolvedClaims: Record<string, unknown> = {
        iss: opts.issuer,
        aud: opts.audience,
        iat: nowSeconds,
        exp: nowSeconds + expiresInSeconds,
        ...claims, // caller's claims win on collision (sub, aud override, etc.)
      };

      const header = {
        alg: mintOpts.algorithm ?? algorithm,
        typ: 'JWT',
        kid: mintOpts.keyId ?? material.keyId,
      };

      const headerB64 = base64UrlEncode(JSON.stringify(header));
      const payloadB64 = base64UrlEncode(JSON.stringify(resolvedClaims));
      const signingInput = `${headerB64}.${payloadB64}`;
      const signatureB64 = signCompact(algorithm, material.privateKey, signingInput);

      return {
        token: `${signingInput}.${signatureB64}`,
        claims: resolvedClaims,
      };
    },

    rotateKey(): void {
      rotationCounter += 1;
      material = generateKeyMaterial(
        algorithm,
        `openwop-conformance-key-${rotationCounter}`,
      );
    },
  };
}
