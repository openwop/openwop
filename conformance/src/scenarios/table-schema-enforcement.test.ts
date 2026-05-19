/**
 * table-schema-enforcement — RFC 0016 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0016 promoted to `Active`
 * 2026-05-17. The matching `capabilities.tableStorage` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: Subsequent rows MUST conform to the schema established on first insert.
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

describe('table-schema-enforcement: advertisement shape (RFC 0016)', () => {
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

describe('table-schema-enforcement: behavioral (RFC 0016 §B point 2)', () => {
  it('first insert declares schema; subsequent insert with wrong column type is rejected', async () => {
    const probe = await call('insert', { table: '__probe__', row: { id: 'probe-0' } });
    if (probe.status === 404) return; // seam not exposed
    const table = `sch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // First insert — declares the schema from this row's columns.
    const first = await call('insert', {
      table,
      row: { id: 'row-1', name: 'alice', count: 42, active: true },
    });
    expect(first.status).toBe(200);

    // Second insert — matching schema; MUST succeed.
    const second = await call('insert', {
      table,
      row: { id: 'row-2', name: 'bob', count: 7, active: false },
    });
    expect(second.status).toBe(200);

    // Third insert — `count` declared as number; sending a string MUST be rejected.
    const bad = await call('insert', {
      table,
      row: { id: 'row-3', name: 'mallory', count: 'oops-a-string', active: true },
    });
    expect(
      bad.status >= 400 && bad.status < 500,
      driver.describe('RFC 0016 §B point 2', 'type-divergent insert MUST be rejected with 4xx'),
    ).toBe(true);
    const body = bad.json as { error?: { code?: string } | string };
    const code = typeof body.error === 'string' ? body.error : body.error?.code;
    expect(
      code,
      driver.describe('RFC 0016 §B point 2', 'rejection MUST carry the table_schema_violation error code'),
    ).toBe('table_schema_violation');
  });
});
