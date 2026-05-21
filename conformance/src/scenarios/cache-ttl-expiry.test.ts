/**
 * cache-ttl-expiry — RFC 0019 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0019 promoted to
 * `Active` 2026-05-17. The matching `capabilities.cache` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and exercises the
 * behavioral surface through the `/v1/host/sample/test/surface` seam
 * (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: Cache TTL honored with at most 1-second drift.
 *
 * @see RFCS/0019-*.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["cache"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('cache-ttl-expiry: advertisement shape (RFC 0019)', () => {
  it('capabilities.cache is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §cache',
        'capabilities.cache.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'cache', op, args });
}

describe('cache-ttl-expiry: behavioral (RFC 0019 §B point 2 — 1s TTL drift)', () => {
  it('put with ttlSeconds=2 → hit within window; miss after expiry', async () => {
    const probe = await call('get', { key: '__cache-probe__' });
    if (probe.status === 404) return;
    const key = `c-ttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const putRes = await call('put', { key, value: 'evicts-soon', ttlSeconds: 2 });
    expect(putRes.status).toBe(200);

    const within = await call('get', { key });
    const withinBody = within.json as { value?: unknown; found?: boolean };
    expect(
      withinBody.value,
      driver.describe('RFC 0019 §B point 2', 'cache get within TTL MUST return the stored value'),
    ).toBe('evicts-soon');

    await new Promise((r) => setTimeout(r, 3000));

    const after = await call('get', { key });
    const afterBody = after.json as { value?: unknown; found?: boolean };
    expect(
      afterBody.found,
      driver.describe('RFC 0019 §B point 2', 'cache get after TTL expiry MUST surface as found:false (≤1s drift)'),
    ).toBe(false);
  });
});
