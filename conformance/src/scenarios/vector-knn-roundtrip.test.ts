/**
 * vector-knn-roundtrip — RFC 0018 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0018 promoted to `Active`
 * 2026-05-17. The matching `capabilities.vectorStore` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: upsert then query returns the same vectors in top-k order.
 *
 * @see RFCS/0018-*.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["vectorStore"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('vector-knn-roundtrip: advertisement shape (RFC 0018)', () => {
  it('capabilities.vectorStore is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §vectorStore',
        'capabilities.vectorStore.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'vector', op, args });
}

describe('vector-knn-roundtrip: behavioral (RFC 0018 §A.vectorStore)', () => {
  it('upsert 10 vectors → query with one of them returns it as the top match', async () => {
    const probe = await call('query', { namespace: '__probe__', vector: [1, 0], topK: 1 });
    if (probe.status === 404) return; // seam not exposed
    const namespace = `knn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `vec-${i}`,
      vector: [Math.cos((i * Math.PI) / 5), Math.sin((i * Math.PI) / 5)],
    }));
    const upsertRes = await call('upsert', { namespace, items });
    expect(upsertRes.status).toBe(200);

    const queryRes = await call('query', { namespace, vector: items[3]!.vector, topK: 1 });
    expect(queryRes.status).toBe(200);
    const body = queryRes.json as { matches?: Array<{ id?: string; score?: number }> };
    expect(Array.isArray(body.matches), 'matches MUST be an array').toBe(true);
    expect(body.matches!.length).toBeGreaterThan(0);
    expect(
      body.matches![0]!.id,
      driver.describe('RFC 0018 §A.vectorStore', 'query with an indexed vector MUST return it as the top match'),
    ).toBe('vec-3');
  });

  it('topK respects the configured limit', async () => {
    const probe = await call('query', { namespace: '__probe__', vector: [1, 0], topK: 1 });
    if (probe.status === 404) return;
    const namespace = `topk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `t-${i}`,
      vector: [i / 10, 1 - i / 10],
    }));
    await call('upsert', { namespace, items });
    const r3 = await call('query', { namespace, vector: [0.5, 0.5], topK: 3 });
    const body = r3.json as { matches?: unknown[] };
    expect(
      Array.isArray(body.matches) && body.matches.length <= 3,
      driver.describe('RFC 0018 §A.vectorStore', 'query MUST return at most topK matches'),
    ).toBe(true);
  });
});
