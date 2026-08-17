/**
 * kv-cross-tenant-isolation — RFC 0015 §B + SECURITY/invariants.yaml
 * `kv-cross-tenant-isolation`.
 *
 * Status: ACTIVE (advertisement + behavioral). The behavioral half drives
 * cross-tenant proof through the optional reference-host test seam at
 * `POST /v1/host/sample/test/surface` (env-gated on `OPENWOP_TEST_SEAM_ENABLED=true`).
 * Hosts that don't expose the seam (HTTP 404) soft-skip the behavioral
 * assertions and verify advertisement shape only.
 *
 * Summary: host.kvStorage MUST partition values by tenant. A `set` issued
 * under tenant A MUST NOT be visible to a `get` under tenant B at the
 * same key.
 *
 * @see RFCS/0015-host-kv-storage-capability.md
 * @see SECURITY/invariants.yaml — kv-cross-tenant-isolation
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

async function call(tenantId: string, op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId, surface: 'kv', op, args });
}

describe('kv-cross-tenant-isolation: advertisement shape (RFC 0015)', () => {
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
});

describe('kv-cross-tenant-isolation: behavioral (RFC 0015 §B)', () => {
  it('set under tenant A → get under tenant B with same key returns found:false', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const key = `xtenant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const setRes = await call('tenant-a', 'set', { key, value: 'from-A' });
    if (setRes.status === 404) return; // host doesn't expose test seam
    expect(setRes.status, driver.describe('RFC 0015 §B', 'set MUST succeed')).toBe(200);

    const getRes = await call('tenant-b', 'get', { key });
    expect(getRes.status).toBe(200);
    const body = getRes.json as { value?: unknown; found?: boolean };
    expect(
      body.found,
      driver.describe(
        'SECURITY/invariants.yaml kv-cross-tenant-isolation',
        'tenant B MUST NOT see tenant A value at the same key',
      ),
    ).toBe(false);
  });

  it('same-tenant set→get round-trips the value', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const key = `roundtrip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const setRes = await call('tenant-a', 'set', { key, value: 'rt-A' });
    if (setRes.status === 404) return;
    expect(setRes.status).toBe(200);
    const getRes = await call('tenant-a', 'get', { key });
    const body = getRes.json as { value?: unknown; found?: boolean };
    expect(body.found, 'same-tenant get MUST succeed').toBe(true);
    expect(body.value, 'same-tenant get MUST return the stored value').toBe('rt-A');
  });
});
