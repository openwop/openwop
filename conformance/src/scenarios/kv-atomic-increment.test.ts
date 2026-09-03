/**
 * kv-atomic-increment — RFC 0015 §B point 4 (atomic increment).
 *
 * Status: ACTIVE (advertisement + behavioral). Behavioral half drives N
 * concurrent +1 increments through the reference-host test seam and asserts
 * the final value equals N. Hosts that don't expose the seam soft-skip.
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

describe('kv-atomic-increment: advertisement shape (RFC 0015)', () => {
  it('capabilities.kvStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(
      typeof cap.supported,
      req('openwop.it.kv-atomic-increment.capabilities-kvstorage-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §kvStorage',
        'capabilities.kvStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('atomicIncrement is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    const sub = cap.atomicIncrement;
    if (sub === undefined) return softSkip('blocked', 'precondition not met — `sub === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(typeof sub, req('openwop.it.kv-atomic-increment.atomicincrement-is-a-boolean-when-set', 'RFC 0015 §A', 'atomicIncrement MUST be boolean when present')).toBe('boolean');
  });
});

describe('kv-atomic-increment: behavioral (RFC 0015 §B point 4)', () => {
  it('N concurrent +1 increments converge to exactly N', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true || cap.atomicIncrement !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true || cap.atomicIncrement !== true` returned early');
    const key = `atomic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const probe = await call('atomicIncrement', { key, delta: 0 });
    if (probe.status === 404) return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam not exposed) (seam, prior step, or fixture unavailable)'); // seam not exposed

    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, () => call('atomicIncrement', { key, delta: 1 })),
    );
    for (const r of results) {
      expect(r.status, req('openwop.it.kv-atomic-increment.n-concurrent-1-increments-converge-to-exactly-n', 'RFC 0015 §B point 4', 'each increment MUST succeed')).toBe(200);
    }
    const finalRes = await call('get', { key });
    const finalBody = finalRes.json as { value?: unknown };
    expect(
      finalBody.value,
      req('openwop.it.kv-atomic-increment.n-concurrent-1-increments-converge-to-exactly-n', 'RFC 0015 §B point 4', `${N} concurrent increments MUST converge to exactly ${N}`),
    ).toBe(N);
  });
});
