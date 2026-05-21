/**
 * table-cursor-pagination — RFC 0016 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0016 promoted to
 * `Active` 2026-05-17. The matching `capabilities.tableStorage` block has
 * landed in `schemas/capabilities.schema.json`. This scenario asserts the
 * advertisement shape against any host that boots the conformance suite, and
 * exercises the behavioral surface through the `/v1/host/sample/test/surface`
 * seam (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: query MUST support filter + cursor pagination.
 *
 * @see RFCS/0016-*.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["tableStorage"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('table-cursor-pagination: advertisement shape (RFC 0016)', () => {
  it('capabilities.tableStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §tableStorage',
        'capabilities.tableStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'table', op, args });
}

describe('table-cursor-pagination: behavioral (RFC 0016 §B point 3)', () => {
  it('first page returns N rows + nextCursor; second page resumes; final page returns nextCursor:null', async () => {
    const probe = await call('query', { table: '__probe__', limit: 1 });
    if (probe.status === 404) return; // seam not exposed
    const table = `pag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Seed 5 rows with deterministic ids so cursor ordering is testable.
    for (let i = 1; i <= 5; i++) {
      await call('insert', { table, row: { id: `row-${i.toString().padStart(2, '0')}`, n: i } });
    }
    // Page 1: limit=2
    const p1 = await call('query', { table, limit: 2 });
    const b1 = p1.json as { rows?: Array<{ id: string }>; nextCursor?: string | null };
    expect(Array.isArray(b1.rows) && b1.rows.length === 2).toBe(true);
    expect(
      typeof b1.nextCursor === 'string' && b1.nextCursor.length > 0,
      driver.describe('RFC 0016 §B point 3', 'first page MUST surface nextCursor when more results remain'),
    ).toBe(true);

    // Page 2: cursor from page 1, limit=2
    const p2 = await call('query', { table, limit: 2, cursor: b1.nextCursor });
    const b2 = p2.json as { rows?: Array<{ id: string }>; nextCursor?: string | null };
    expect(b2.rows?.length).toBe(2);
    expect(
      b2.rows![0]!.id > b1.rows![1]!.id,
      driver.describe('RFC 0016 §B point 3', 'second page MUST resume AFTER the last id of the previous page'),
    ).toBe(true);

    // Page 3: final page — only 1 row left, nextCursor MUST be null
    const p3 = await call('query', { table, limit: 2, cursor: b2.nextCursor });
    const b3 = p3.json as { rows?: Array<{ id: string }>; nextCursor?: string | null };
    expect(b3.rows?.length).toBe(1);
    expect(
      b3.nextCursor,
      driver.describe('RFC 0016 §B point 3', 'final page (no more results) MUST surface nextCursor: null'),
    ).toBe(null);
  });
});
