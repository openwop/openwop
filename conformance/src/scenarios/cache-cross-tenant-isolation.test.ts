/**
 * cache-cross-tenant-isolation — RFC 0019 §B point 2.
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that cache entries
 * put under tenant A MUST NOT hit on get under tenant B at the same key.
 *
 * @see RFCS/0019-host-blob-cache-capability.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["cache"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function call(tenantId: string, op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId, surface: 'cache', op, args });
}

describe('cache-cross-tenant-isolation: advertisement shape (RFC 0019)', () => {
  it('capabilities.cache is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(
      typeof cap.supported,
      req('openwop.it.cache-cross-tenant-isolation.capabilities-cache-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §cache',
        'capabilities.cache.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('cache-cross-tenant-isolation: behavioral (RFC 0019 §B point 2)', () => {
  it('put under tenant A → get under tenant B returns miss', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    const key = `xtenant-cache-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const putRes = await call('tenant-a', 'put', { key, value: 'from-A', ttlSeconds: 60 });
    if (putRes.status === 404) return softSkip('blocked', 'precondition not met — `putRes.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(putRes.status, req('openwop.it.cache-cross-tenant-isolation.put-under-tenant-a-get-under-tenant-b-returns-miss', 'RFC 0019 §B point 2', 'put MUST succeed')).toBe(200);

    const getRes = await call('tenant-b', 'get', { key });
    expect(getRes.status).toBe(200);
    const body = getRes.json as { hit?: boolean };
    expect(
      body.hit,
      req('openwop.it.cache-cross-tenant-isolation.put-under-tenant-a-get-under-tenant-b-returns-miss', 'RFC 0019 §B point 2', 'tenant B MUST NOT hit tenant A cache entry at same key'),
    ).toBe(false);
  });
});
