/**
 * kv-ttl-expiry — RFC 0015 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0015 promoted to
 * `Active` 2026-05-17. The matching `capabilities.kvStorage` block has
 * landed in `schemas/capabilities.schema.json`. This scenario asserts the
 * advertisement shape against any host that boots the conformance suite, and
 * exercises the behavioral surface through the `/v1/host/sample/test/surface`
 * seam (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: TTL honored with at most a 1-second drift on expiry visibility.
 *
 * @see RFCS/0015-*.md
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

describe('kv-ttl-expiry: advertisement shape (RFC 0015)', () => {
  it('capabilities.kvStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §kvStorage',
        'capabilities.kvStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'kv', op, args });
}

describe('kv-ttl-expiry: behavioral (RFC 0015 §B point 3 — 1s TTL drift)', () => {
  it('set with ttlSeconds=2 → get before expiry returns value; get after expiry returns found:false', async () => {
    const probe = await call('get', { key: '__ttl-probe__' });
    if (probe.status === 404) return; // host doesn't expose the seam
    const key = `ttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const setRes = await call('set', { key, value: 'expires-soon', ttlSeconds: 2 });
    expect(setRes.status).toBe(200);

    // Read within the window
    const within = await call('get', { key });
    expect(within.status).toBe(200);
    const withinBody = within.json as { value?: unknown; found?: boolean };
    expect(
      withinBody.value,
      driver.describe('RFC 0015 §B point 3', 'get within TTL window MUST return the stored value'),
    ).toBe('expires-soon');
    expect(withinBody.found).toBe(true);

    // Wait past expiry (2s TTL + 1s drift allowance per RFC 0015 §B point 3)
    await new Promise((r) => setTimeout(r, 3000));

    const after = await call('get', { key });
    expect(after.status).toBe(200);
    const afterBody = after.json as { value?: unknown; found?: boolean };
    expect(
      afterBody.found,
      driver.describe('RFC 0015 §B point 3', 'get after TTL expiry MUST surface as found:false (≤1s drift)'),
    ).toBe(false);
  });
});
