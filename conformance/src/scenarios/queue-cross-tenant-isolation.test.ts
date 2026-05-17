/**
 * queue-cross-tenant-isolation — RFC 0017 §C + SECURITY/invariants.yaml
 * `queue-cross-tenant-isolation`.
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that messages
 * published under tenant A on topic T MUST NOT be consumed under tenant B
 * on the same topic.
 *
 * @see RFCS/0017-host-queue-bus-capability.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["queueBus"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function call(tenantId: string, op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId, surface: 'queueBus', op, args });
}

describe('queue-cross-tenant-isolation: advertisement shape (RFC 0017)', () => {
  it('capabilities.queueBus is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return;
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §queueBus',
        'capabilities.queueBus.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('queue-cross-tenant-isolation: behavioral (RFC 0017 §C)', () => {
  it('publish under tenant A → consume under tenant B returns not-found', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const topic = `xtenant.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;

    const pubRes = await call('tenant-a', 'publish', { topic, payload: { hello: 'A' } });
    if (pubRes.status === 404) return;
    expect(pubRes.status, 'publish MUST succeed').toBe(200);

    const consRes = await call('tenant-b', 'consume', { topic, timeoutMs: 100 });
    expect(consRes.status).toBe(200);
    const body = consRes.json as { found?: boolean };
    expect(
      body.found,
      driver.describe(
        'SECURITY/invariants.yaml queue-cross-tenant-isolation',
        'tenant B MUST NOT consume tenant A messages on the same topic',
      ),
    ).toBe(false);
  });
});
