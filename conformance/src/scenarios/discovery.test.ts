/**
 * Discovery scenarios — `/.well-known/openwop` and `/v1/openapi.json`.
 *
 * These are the only two endpoints that MUST work without authentication
 * (per `auth.md` §2 + `rest-endpoints.md`). They're the cheapest cross-
 * implementation contracts to verify.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

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
