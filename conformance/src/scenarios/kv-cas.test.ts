/**
 * kv-cas — RFC 0015 §B point 5 (compare-and-swap atomicity).
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that a matching
 * `expect` swaps and a stale `expect` rejects with `swapped:false` and
 * returns the current actual value.
 *
 * @see RFCS/0015-host-kv-storage-capability.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["kvStorage"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'kv', op, args });
}

describe('kv-cas: advertisement shape (RFC 0015)', () => {
  it('capabilities.kvStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(
      typeof cap.supported,
      req('openwop.it.kv-cas.capabilities-kvstorage-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §kvStorage',
        'capabilities.kvStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('compareAndSwap is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    const sub = cap.compareAndSwap;
    if (sub === undefined) return softSkip('blocked', 'precondition not met — `sub === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(typeof sub, req('openwop.it.kv-cas.compareandswap-is-a-boolean-when-set', 'RFC 0015 §A', 'compareAndSwap MUST be boolean when present')).toBe('boolean');
  });
});

describe('kv-cas: behavioral (RFC 0015 §B point 5)', () => {
  it('CAS with matching expect succeeds; stale expect fails with swapped:false', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true || cap.compareAndSwap !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true || cap.compareAndSwap !== true` returned early');
    const key = `cas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const setRes = await call('set', { key, value: 'v1' });
    if (setRes.status === 404) return softSkip('blocked', 'precondition not met — `setRes.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(setRes.status).toBe(200);

    // Matching expect → swaps.
    const okRes = await call('cas', { key, expect: 'v1', set: 'v2' });
    expect(okRes.status, req('openwop.it.kv-cas.cas-with-matching-expect-succeeds-stale-expect-fails-with-swapped-false', 'RFC 0015 §B', 'matching CAS MUST 200')).toBe(200);
    const okBody = okRes.json as { swapped?: boolean };
    expect(okBody.swapped, req('openwop.it.kv-cas.cas-with-matching-expect-succeeds-stale-expect-fails-with-swapped-false', 'RFC 0015 §B', 'matching expect MUST swap')).toBe(true);

    // Stale expect → no swap.
    const staleRes = await call('cas', { key, expect: 'v1', set: 'v3' });
    expect(staleRes.status, req('openwop.it.kv-cas.cas-with-matching-expect-succeeds-stale-expect-fails-with-swapped-false', 'RFC 0015 §B', 'stale CAS MUST 200 (CAS is non-throwing)')).toBe(200);
    const staleBody = staleRes.json as { swapped?: boolean; actual?: unknown };
    expect(staleBody.swapped, req('openwop.it.kv-cas.cas-with-matching-expect-succeeds-stale-expect-fails-with-swapped-false', 'RFC 0015 §B', 'stale expect MUST NOT swap')).toBe(false);
    expect(staleBody.actual, req('openwop.it.kv-cas.cas-with-matching-expect-succeeds-stale-expect-fails-with-swapped-false', 'RFC 0015 §B', 'stale CAS MUST surface current value')).toBe('v2');
  });
});
