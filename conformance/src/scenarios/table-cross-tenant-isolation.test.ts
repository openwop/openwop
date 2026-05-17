/**
 * table-cross-tenant-isolation — RFC 0016 §B point 1.
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that rows inserted
 * under tenant A MUST NOT appear in queries under tenant B against the
 * same table+filter.
 *
 * @see RFCS/0016-host-table-storage-capability.md
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

async function call(tenantId: string, op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId, surface: 'table', op, args });
}

describe('table-cross-tenant-isolation: advertisement shape (RFC 0016)', () => {
  it('capabilities.tableStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return;
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §tableStorage',
        'capabilities.tableStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('table-cross-tenant-isolation: behavioral (RFC 0016 §B point 1)', () => {
  it('insert under tenant A → query under tenant B returns 0 rows', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const table = `xtenant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const insertRes = await call('tenant-a', 'insert', {
      table,
      row: { id: 'r1', body: 'from-A' },
    });
    if (insertRes.status === 404) return; // seam not exposed
    expect(insertRes.status, 'insert MUST succeed').toBe(200);

    const queryRes = await call('tenant-b', 'query', { table, filter: {} });
    expect(queryRes.status).toBe(200);
    const body = queryRes.json as { rows?: unknown[] };
    expect(
      Array.isArray(body.rows) ? body.rows.length : -1,
      driver.describe('RFC 0016 §B point 1', 'tenant B MUST see 0 rows in tenant A table'),
    ).toBe(0);
  });
});
