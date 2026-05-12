/**
 * Server-free unit tests for the synthetic OIDC issuer harness.
 *
 * The harness is real cryptographic code (RS256 + ES256 JWS signing,
 * JWKS export, JWT compact serialization). If the signing or encoding
 * is wrong, every scenario that uses the harness silently misreports —
 * the OIDC validation scenarios soft-skip behavior portions when the
 * host doesn't trust the harness, so a malformed token would simply
 * cause the host to reject and the test to "pass" via soft-skip path.
 *
 * These unit tests round-trip every token through `node:crypto.createVerify`
 * to confirm the harness output is parseable by an independent verifier.
 * Run server-free; doesn't depend on OPENWOP_BASE_URL.
 *
 * @see conformance/src/lib/oidc-issuer.ts
 * @see RFCS/0010-auth-profile-conformance.md §E
 */

import { describe, it, expect } from 'vitest';
import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';
import { createSyntheticOIDCIssuer } from './oidc-issuer.js';

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const padded = input + '='.repeat(pad);
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(std, 'base64');
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Buffer;
  signingInput: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`malformed JWT: ${parts.length} segments`);
  const [h, p, s] = parts;
  return {
    header: JSON.parse(base64UrlDecode(h).toString('utf8')) as Record<string, unknown>,
    payload: JSON.parse(base64UrlDecode(p).toString('utf8')) as Record<string, unknown>,
    signature: base64UrlDecode(s),
    signingInput: `${h}.${p}`,
  };
}

function verifyToken(
  token: string,
  jwksJson: string,
  algorithm: 'RS256' | 'ES256',
): boolean {
  const decoded = decodeJwt(token);
  const jwks = JSON.parse(jwksJson) as { keys: JsonWebKey[] };
  const kid = decoded.header.kid;
  const key = jwks.keys.find((k) => k.kid === kid);
  if (!key) throw new Error(`no JWKS key matches kid=${String(kid)}`);

  const publicKey = createPublicKey({ key, format: 'jwk' });
  const digest = algorithm === 'RS256' ? 'RSA-SHA256' : 'SHA256';
  const verifier = createVerify(digest);
  verifier.update(decoded.signingInput);
  verifier.end();
  return verifier.verify(
    algorithm === 'RS256'
      ? publicKey
      : { key: publicKey, dsaEncoding: 'ieee-p1363' },
    decoded.signature,
  );
}

describe('oidc-issuer: harness construction', () => {
  it('requires issuer and audience', () => {
    expect(() =>
      createSyntheticOIDCIssuer({ issuer: '', audience: 'openwop' }),
    ).toThrow(/issuer and audience/);
    expect(() =>
      createSyntheticOIDCIssuer({ issuer: 'https://x', audience: '' }),
    ).toThrow(/issuer and audience/);
  });

  it('defaults to RS256 + canonical keyId', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    expect(issuer.algorithm).toBe('RS256');
    expect(issuer.keyId).toBe('openwop-conformance-key-1');
    expect(issuer.issuer).toBe('https://harness.example');
    expect(issuer.audience).toBe('openwop');
  });

  it('rejects unsupported algorithm at runtime (defensive)', () => {
    expect(() =>
      createSyntheticOIDCIssuer({
        issuer: 'https://x',
        audience: 'y',
        algorithm: 'HS256',
      }),
    ).toThrow(/unsupported algorithm/);
  });
});

describe('oidc-issuer: JWKS + discovery shape', () => {
  it('publishes a well-formed JWKS for RS256', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const jwks = JSON.parse(issuer.jwksJson) as { keys: JsonWebKey[] };
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBe(1);
    const key = jwks.keys[0];
    expect(key.kty).toBe('RSA');
    expect(key.alg).toBe('RS256');
    expect(key.use).toBe('sig');
    expect(key.kid).toBe(issuer.keyId);
    // RSA JWK MUST have n (modulus) and e (exponent).
    expect(typeof key.n).toBe('string');
    expect(typeof key.e).toBe('string');
  });

  it('publishes a well-formed JWKS for ES256', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
      algorithm: 'ES256',
    });
    const jwks = JSON.parse(issuer.jwksJson) as { keys: JsonWebKey[] };
    const key = jwks.keys[0];
    expect(key.kty).toBe('EC');
    expect(key.alg).toBe('ES256');
    expect(key.crv).toBe('P-256');
    expect(typeof key.x).toBe('string');
    expect(typeof key.y).toBe('string');
  });

  it('publishes OIDC discovery doc with correct shape', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example/oauth',
      audience: 'openwop',
    });
    const disco = JSON.parse(issuer.discoveryJson) as {
      issuer: string;
      jwks_uri: string;
      response_types_supported: string[];
      subject_types_supported: string[];
      id_token_signing_alg_values_supported: string[];
    };
    expect(disco.issuer).toBe('https://harness.example/oauth');
    expect(disco.jwks_uri).toBe('https://harness.example/oauth/.well-known/jwks.json');
    expect(disco.id_token_signing_alg_values_supported).toContain('RS256');
  });

  it('discovery doc strips trailing slash before appending jwks path', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example/',
      audience: 'openwop',
    });
    const disco = JSON.parse(issuer.discoveryJson) as { jwks_uri: string };
    expect(disco.jwks_uri).toBe('https://harness.example/.well-known/jwks.json');
  });
});

describe('oidc-issuer: mint defaults', () => {
  it('fills iss / aud / iat / exp when not supplied', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const before = Math.floor(Date.now() / 1000);
    const { claims } = issuer.mint({ sub: 'test-sub' });
    const after = Math.floor(Date.now() / 1000);

    expect(claims.iss).toBe('https://harness.example');
    expect(claims.aud).toBe('openwop');
    expect(claims.sub).toBe('test-sub');
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(after);
    // Default lifetime is 300s.
    expect((claims.exp as number) - (claims.iat as number)).toBe(300);
  });

  it('caller claims override defaults', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const { claims } = issuer.mint({
      iss: 'override-issuer',
      aud: 'override-audience',
      sub: 'test-sub',
    });
    expect(claims.iss).toBe('override-issuer');
    expect(claims.aud).toBe('override-audience');
  });

  it('negative expiresInSeconds mints already-expired token', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const now = Math.floor(Date.now() / 1000);
    const { claims } = issuer.mint(
      { sub: 'test-sub' },
      { expiresInSeconds: -3600 },
    );
    expect((claims.exp as number) < now).toBe(true);
  });
});

describe('oidc-issuer: signature round-trip', () => {
  it('RS256 token verifies against published JWKS', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
      algorithm: 'RS256',
    });
    const { token } = issuer.mint({ sub: 'test-sub' });
    const verified = verifyToken(token, issuer.jwksJson, 'RS256');
    expect(verified).toBe(true);
  });

  it('ES256 token verifies against published JWKS', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
      algorithm: 'ES256',
    });
    const { token } = issuer.mint({ sub: 'test-sub' });
    const verified = verifyToken(token, issuer.jwksJson, 'ES256');
    expect(verified).toBe(true);
  });

  it('header alg matches issuer algorithm by default', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
      algorithm: 'ES256',
    });
    const { token } = issuer.mint({ sub: 'test-sub' });
    const decoded = decodeJwt(token);
    expect(decoded.header.alg).toBe('ES256');
  });

  it('mint opts.algorithm override appears in header (alg-spoof scenario)', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
      algorithm: 'RS256',
    });
    const { token } = issuer.mint(
      { sub: 'test-sub' },
      { algorithm: 'HS256' },
    );
    const decoded = decodeJwt(token);
    expect(decoded.header.alg).toBe('HS256');
    // The signature is still RS256-bytes (the harness doesn't actually
    // honor the alg override for the signature itself — that's the spoof:
    // the header lies, the bytes don't match). Verification with RS256
    // succeeds, which is the test scenario's correct behavior: it lets
    // the OAuth2-CC negative-case scenario assert the host rejects
    // because the header claims HS256 outside supportedAlgorithms.
    const verified = verifyToken(
      // Pull alg from header for verification — but the verify path
      // is RS256 because that's the actual key. Re-decode and verify
      // by extracting the alg-from-issuer rather than alg-from-header.
      token,
      issuer.jwksJson,
      'RS256',
    );
    expect(verified).toBe(true);
  });

  it('keyId override sets header.kid without changing signing key (unknown-kid scenario)', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const { token } = issuer.mint(
      { sub: 'test-sub' },
      { keyId: 'never-published-kid' },
    );
    const decoded = decodeJwt(token);
    expect(decoded.header.kid).toBe('never-published-kid');
    // The JWKS doesn't publish this kid; verifyToken throws.
    expect(() => verifyToken(token, issuer.jwksJson, 'RS256')).toThrow(/no JWKS key/);
  });
});

describe('oidc-issuer: key rotation', () => {
  it('rotateKey() changes the published keyId', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const firstKid = issuer.keyId;
    issuer.rotateKey();
    expect(issuer.keyId).not.toBe(firstKid);
    expect(issuer.keyId).toBe('openwop-conformance-key-2');
  });

  it('tokens minted before rotation no longer verify against new JWKS', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    const beforeRotation = issuer.mint({ sub: 'test-sub' });
    issuer.rotateKey();
    // The JWKS now publishes a different key. The old token's header
    // kid still references the pre-rotation kid, which isn't published.
    expect(() =>
      verifyToken(beforeRotation.token, issuer.jwksJson, 'RS256'),
    ).toThrow(/no JWKS key/);
  });

  it('tokens minted after rotation verify against new JWKS', () => {
    const issuer = createSyntheticOIDCIssuer({
      issuer: 'https://harness.example',
      audience: 'openwop',
    });
    issuer.rotateKey();
    const afterRotation = issuer.mint({ sub: 'test-sub' });
    const verified = verifyToken(afterRotation.token, issuer.jwksJson, 'RS256');
    expect(verified).toBe(true);
  });
});
