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
    if (cap === null) return;
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §kvStorage',
        'capabilities.kvStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('compareAndSwap is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const sub = cap.compareAndSwap;
    if (sub === undefined) return;
    expect(typeof sub, driver.describe('RFC 0015 §A', 'compareAndSwap MUST be boolean when present')).toBe('boolean');
  });
});

describe('kv-cas: behavioral (RFC 0015 §B point 5)', () => {
  it('CAS with matching expect succeeds; stale expect fails with swapped:false', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true || cap.compareAndSwap !== true) return;
    const key = `cas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const setRes = await call('set', { key, value: 'v1' });
    if (setRes.status === 404) return;
    expect(setRes.status).toBe(200);

    // Matching expect → swaps.
    const okRes = await call('cas', { key, expect: 'v1', set: 'v2' });
    expect(okRes.status, 'matching CAS MUST 200').toBe(200);
    const okBody = okRes.json as { swapped?: boolean };
    expect(okBody.swapped, 'matching expect MUST swap').toBe(true);

    // Stale expect → no swap.
    const staleRes = await call('cas', { key, expect: 'v1', set: 'v3' });
    expect(staleRes.status, 'stale CAS MUST 200 (CAS is non-throwing)').toBe(200);
    const staleBody = staleRes.json as { swapped?: boolean; actual?: unknown };
    expect(staleBody.swapped, 'stale expect MUST NOT swap').toBe(false);
    expect(staleBody.actual, 'stale CAS MUST surface current value').toBe('v2');
  });
});
