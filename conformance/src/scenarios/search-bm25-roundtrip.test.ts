/**
 * search-bm25-roundtrip — RFC 0018 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0018 promoted to
 * `Active` 2026-05-17. The matching `capabilities.searchIndex` block has
 * landed in `schemas/capabilities.schema.json`. This scenario asserts the
 * advertisement shape against any host that boots the conformance suite, and
 * exercises the behavioral surface through the `/v1/host/sample/test/surface`
 * seam (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: index then query returns relevant documents.
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["searchIndex"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('search-bm25-roundtrip: advertisement shape (RFC 0018)', () => {
  it('capabilities.searchIndex is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §searchIndex',
        'capabilities.searchIndex.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'search', op, args });
}

describe('search-bm25-roundtrip: behavioral (RFC 0018 §A.searchIndex)', () => {
  it('index 3 docs → query for a distinguishing keyword returns the matching doc as top hit', async () => {
    const probe = await call('query', { index: '__probe__', q: 'hello' });
    if (probe.status === 404) return; // seam not exposed
    const index = `idx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const idx = await call('index', {
      index,
      docs: [
        { id: 'doc-1', fields: { title: 'Database engines for vector search', body: 'Pinecone Qdrant Weaviate Milvus pgvector' } },
        { id: 'doc-2', fields: { title: 'Workflow orchestration patterns', body: 'durable runs interrupts replay event log' } },
        { id: 'doc-3', fields: { title: 'Distributed systems primer', body: 'consensus Paxos Raft leader election' } },
      ],
    });
    expect(idx.status).toBe(200);

    // Query for a distinguishing keyword → doc-2 MUST be top-ranked.
    const q = await call('query', { index, q: 'durable workflow runs', k: 3 });
    expect(q.status).toBe(200);
    const body = q.json as { hits?: Array<{ id: string; score: number }> };
    expect(Array.isArray(body.hits) && body.hits.length > 0).toBe(true);
    expect(
      body.hits![0]!.id,
      driver.describe('RFC 0018 §A.searchIndex', 'query for the doc\'s distinguishing tokens MUST return that doc as top-1'),
    ).toBe('doc-2');
    // Top hit's score MUST be strictly greater than any tied below-rank.
    if (body.hits!.length > 1) {
      expect(body.hits![0]!.score >= body.hits![1]!.score).toBe(true);
    }
  });

  it('k limit caps the result set', async () => {
    const probe = await call('query', { index: '__probe__', q: 'hello' });
    if (probe.status === 404) return;
    const index = `idx-k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const docs = Array.from({ length: 5 }, (_, i) => ({ id: `d-${i}`, fields: { body: 'apple orange banana' } }));
    await call('index', { index, docs });
    const q = await call('query', { index, q: 'apple', k: 2 });
    const body = q.json as { hits?: unknown[] };
    expect(
      Array.isArray(body.hits) && body.hits.length <= 2,
      driver.describe('RFC 0018 §A.searchIndex', 'query MUST return at most k hits'),
    ).toBe(true);
  });
});
