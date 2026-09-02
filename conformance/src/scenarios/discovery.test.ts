/**
 * Discovery scenarios — `/.well-known/openwop` and `/v1/openapi.json`.
 *
 * These are the only two endpoints that MUST work without authentication
 * (per `auth.md` §2 + `rest-endpoints.md`). They're the cheapest cross-
 * implementation contracts to verify.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { softSkip } from '../lib/soft-skip.js';

describe('discovery: /.well-known/openwop', () => {
  it('returns 200 with required Capabilities fields per capabilities.md §2', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });

    expect(res.status, driver.describe(
      'capabilities.md §2',
      'discovery endpoint MUST be reachable without auth and return 200',
    )).toBe(200);

    const body = res.json as Record<string, unknown> | undefined;
    expect(body, driver.describe('capabilities.md §2', 'response MUST be JSON')).toBeDefined();

    // Per capabilities.md §3 (in-package shape), these 4 fields are REQUIRED.
    for (const required of ['protocolVersion', 'supportedEnvelopes', 'schemaVersions', 'limits']) {
      expect(body?.[required], driver.describe(
        'capabilities.md §3',
        `Capabilities.${required} MUST be present`,
      )).toBeDefined();
    }
  });

  it('serves Cache-Control per capabilities.md §4 (caching guidance)', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    const cacheControl = res.headers.get('cache-control');

    expect(cacheControl, driver.describe(
      'capabilities.md §4',
      'response SHOULD carry a Cache-Control header to allow client caching',
    )).toBeTruthy();
  });

  it('IF a standard ETag is present, a matching If-None-Match yields 304 (RFC 0165 §C.2 — presence-gated)', async () => {
    const first = await driver.get('/.well-known/openwop', { authenticated: false });
    const etag = first.headers.get('etag');
    if (etag === null) {
      return softSkip('inapplicable', 'host does not send a standard ETag on the discovery document (RFC 0165 §C.2 — SHOULD, presence-gated)');
    }
    expect(etag.trim().length, driver.describe('RFC 0165 §C.2', 'ETag, when present, MUST be a non-empty validator')).toBeGreaterThan(0);
    const second = await driver.get('/.well-known/openwop', { authenticated: false, headers: { 'If-None-Match': etag } });
    expect(second.status, driver.describe('capabilities-change-detection.md §"Cache validators"', 'a matching If-None-Match SHOULD yield 304 Not Modified')).toBe(304);
  });

  it('IF Capabilities-Etag is present, it is non-empty and stable within the cache window', async () => {
    const first = await driver.get('/.well-known/openwop', { authenticated: false });
    const firstEtag = first.headers.get('capabilities-etag');

    if (firstEtag === null) {
      expect(firstEtag, driver.describe(
        'capabilities-change-detection.md §Capabilities-Etag',
        'Capabilities-Etag is optional; hosts that omit it remain conformant',
      )).toBeNull();
      return;
    }

    expect(firstEtag.trim().length, driver.describe(
      'capabilities-change-detection.md §Capabilities-Etag',
      'Capabilities-Etag, when present, MUST be a non-empty opaque string',
    )).toBeGreaterThan(0);

    const second = await driver.get('/.well-known/openwop', { authenticated: false });
    const secondEtag = second.headers.get('capabilities-etag');

    expect(secondEtag, driver.describe(
      'capabilities-change-detection.md §Conformance expectations',
      'repeated discovery calls without host changes SHOULD return the same Capabilities-Etag within the cache window',
    )).toBe(firstEtag);
  });

  it('declares non-zero limits per capabilities.md §3 (CapabilityLimiter shape)', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    const limits = (res.json as { limits?: Record<string, number> } | undefined)?.limits;

    expect(limits, driver.describe(
      'capabilities.md §3',
      'Capabilities.limits MUST be present',
    )).toBeDefined();

    for (const k of ['clarificationRounds', 'schemaRounds', 'envelopesPerTurn']) {
      const v = limits?.[k];
      expect(typeof v, driver.describe(
        'capabilities.md §3',
        `limits.${k} MUST be a non-negative integer`,
      )).toBe('number');
      expect(v ?? -1, driver.describe(
        'capabilities.md §3',
        `limits.${k} MUST be >= 0`,
      )).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('discovery: /.well-known/openwop fixtures field shape per RFC 0003', () => {
  it('IF fixtures is present, it MUST be a string[] of unique non-empty entries', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    expect(res.status).toBe(200);

    const body = res.json as { fixtures?: unknown } | undefined;
    const fixtures = body?.fixtures;

    if (fixtures === undefined) {
      // RFC 0003 makes the field OPTIONAL — pre-RFC hosts and hosts
      // that opt out advertise nothing. Assertion passes trivially.
      expect(fixtures).toBeUndefined();
      return;
    }

    expect(Array.isArray(fixtures), driver.describe(
      'capabilities.md §`fixtures` (RFC 0003)',
      'fixtures MUST be an array when present',
    )).toBe(true);

    const arr = fixtures as unknown[];
    for (const entry of arr) {
      expect(typeof entry, driver.describe(
        'capabilities.md §`fixtures` (RFC 0003)',
        'every fixtures entry MUST be a string',
      )).toBe('string');
      expect((entry as string).length, driver.describe(
        'capabilities.md §`fixtures` (RFC 0003)',
        'every fixtures entry MUST be non-empty',
      )).toBeGreaterThan(0);
    }

    const unique = new Set(arr as string[]);
    expect(unique.size, driver.describe(
      'capabilities.md §`fixtures` (RFC 0003)',
      'fixtures entries SHOULD be unique (consumers MUST tolerate duplicates by deduplicating)',
    )).toBe(arr.length);
  });
});

describe('discovery: /v1/openapi.json', () => {
  it('returns 200 with a parseable OpenAPI 3.1 document', async () => {
    const res = await driver.get('/v1/openapi.json', { authenticated: false });

    expect(res.status, driver.describe(
      'rest-endpoints.md',
      'self-describing OpenAPI endpoint MUST return 200',
    )).toBe(200);

    const body = res.json as { openapi?: string } | undefined;
    expect(body?.openapi, driver.describe(
      'rest-endpoints.md',
      'response MUST declare openapi >= 3.1',
    )).toMatch(/^3\.[1-9]/);
  });
});

/**
 * RFC 0011 §B: auth-scoped discovery subtest.
 *
 * Per `capabilities-change-detection.md` §"Scoped capability views":
 * hosts that return a different payload when called authenticated
 * vs. anonymous MUST advertise that surface via
 * `capabilities.discovery.authScoped.supported: true`. The
 * authenticated view MUST still satisfy `capabilities.schema.json`
 * (required fields preserved) and MUST NOT expose capabilities
 * outside the caller's authorization.
 *
 * Capability shape runs unconditionally when the profile is advertised.
 * The authorization-oracle probe (assertion 5 of §B) is gated on
 * `OPENWOP_TEST_UNAUTHORIZED_API_KEY` because it requires an
 * operator-supplied secondary key with strictly-fewer capabilities
 * than the primary.
 *
 * @see RFCS/0011-auth-scoped-discovery.md §B
 * @see spec/v1/capabilities-change-detection.md §"Scoped capability views"
 */

interface AuthScopedCaps {
  supported?: boolean;
  mode?: string;
  endpointPath?: string;
}

interface DiscoveryCaps {
  authScoped?: AuthScopedCaps;
}

const AUTH_SCOPED_PROFILE = 'openwop-discovery-auth-scoped';

async function readDiscoveryCaps(): Promise<DiscoveryCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop', { authenticated: false });
  return (discoveryFamilies(disco.json) as { discovery?: DiscoveryCaps }).discovery;
}

function isAuthScopedAdvertised(disc: DiscoveryCaps | undefined): boolean {
  return disc?.authScoped?.supported === true;
}

describe('discovery: auth-scoped capability shape', () => {
  it('host claiming auth-scoped discovery advertises required fields', async () => {
    const disc = await readDiscoveryCaps();

    if (!behaviorGate(AUTH_SCOPED_PROFILE, isAuthScopedAdvertised(disc))) {
      return;
    }

    expect(disc?.authScoped?.supported, driver.describe(
      'capabilities-change-detection.md §"Scoped capability views"',
      'capabilities.discovery.authScoped.supported MUST be true when the profile is claimed',
    )).toBe(true);

    if (disc?.authScoped?.mode !== undefined) {
      expect(
        ['same-endpoint', 'extension-endpoint'].includes(disc.authScoped.mode),
        driver.describe(
          'capabilities.schema.json discovery.authScoped.mode',
          'mode MUST be one of same-endpoint / extension-endpoint when advertised',
        ),
      ).toBe(true);
    }

    if (disc?.authScoped?.mode === 'extension-endpoint') {
      expect(
        typeof disc.authScoped.endpointPath === 'string' &&
          disc.authScoped.endpointPath.startsWith('/'),
        driver.describe(
          'RFCS/0011-auth-scoped-discovery.md §A',
          'extension-endpoint mode MUST advertise endpointPath as a leading-slash relative path',
        ),
      ).toBe(true);
    }
  });
});

describe('discovery: auth-scoped view satisfies base schema', () => {
  it('authenticated discovery preserves required Capabilities fields', async () => {
    const disc = await readDiscoveryCaps();

    if (!behaviorGate(AUTH_SCOPED_PROFILE, isAuthScopedAdvertised(disc))) {
      return;
    }

    const mode = disc?.authScoped?.mode ?? 'same-endpoint';
    const path =
      mode === 'extension-endpoint'
        ? disc?.authScoped?.endpointPath ?? '/v1/capabilities'
        : '/.well-known/openwop';

    const res = await driver.get(path);

    expect(res.status, driver.describe(
      'capabilities-change-detection.md §"Scoped capability views"',
      'authenticated discovery MUST return 200',
    )).toBe(200);

    const body = res.json as Record<string, unknown> | undefined;
    expect(body, 'authenticated discovery body MUST be JSON').toBeDefined();

    // Required fields per capabilities.md §3 preserved in the
    // authenticated view (per spec annex: "MUST still satisfy the
    // base capabilities.schema.json shape").
    for (const required of [
      'protocolVersion',
      'supportedEnvelopes',
      'schemaVersions',
      'limits',
    ]) {
      expect(body?.[required], driver.describe(
        'capabilities-change-detection.md §"Scoped capability views"',
        `auth-scoped view MUST preserve required field "${required}" from capabilities.md §3`,
      )).toBeDefined();
    }
  });
});

describe('discovery: auth-scoped is not an authorization oracle', () => {
  it('unauthorized key MUST NOT reveal capabilities outside its authorization', async () => {
    const disc = await readDiscoveryCaps();

    if (!behaviorGate(AUTH_SCOPED_PROFILE, isAuthScopedAdvertised(disc))) {
      return;
    }

    const unauthorizedKey = process.env.OPENWOP_TEST_UNAUTHORIZED_API_KEY;
    if (!unauthorizedKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[discovery: auth-scoped] OPENWOP_TEST_UNAUTHORIZED_API_KEY not supplied; skipping authorization-oracle probe',
      );
      return;
    }

    const mode = disc?.authScoped?.mode ?? 'same-endpoint';
    const path =
      mode === 'extension-endpoint'
        ? disc?.authScoped?.endpointPath ?? '/v1/capabilities'
        : '/.well-known/openwop';

    // Primary key (env-default Authorization).
    const primary = await driver.get(path);

    // Unauthorized / lower-privilege key.
    const unauthorized = await driver.get(path, {
      authenticated: false,
      headers: { Authorization: `Bearer ${unauthorizedKey}` },
    });

    if (unauthorized.status === 401 || unauthorized.status === 403) {
      // Host rejected the unauthorized key outright — that's fine.
      // The oracle probe is moot when the host refuses the bearer.
      return;
    }
    expect(unauthorized.status).toBe(200);

    // Root-first (RFC 0073); the deprecated `capabilities` wrapper is folded in
    // so a root-only host and a wrapper-only host are compared the same way (S26).
    const primaryCaps = Object.keys(discoveryFamilies(primary.json));
    const unauthorizedCaps = Object.keys(discoveryFamilies(unauthorized.json));

    // Spec annex line 69: "Hosts MUST NOT let scoped discovery become
    // an authorization oracle. A caller should learn only about
    // capabilities it is allowed to use." Operationalized as: the
    // unauthorized view's capability keys MUST be a subset of the
    // primary view's keys (no capabilities the unauthorized caller
    // can use that the primary cannot).
    const extras = unauthorizedCaps.filter((c) => !primaryCaps.includes(c));
    expect(extras.length, driver.describe(
      'capabilities-change-detection.md §"Scoped capability views"',
      'unauthorized view MUST NOT expose capability keys absent from the primary (authorized) view',
    )).toBe(0);
  });
});

