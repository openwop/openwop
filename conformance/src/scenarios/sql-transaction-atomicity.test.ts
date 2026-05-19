/**
 * sql-transaction-atomicity — RFC 0018 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0018 promoted to `Active`
 * 2026-05-17. The matching `capabilities.sql` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: transactions MUST be atomic; partial failure rolls back.
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["sql"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('sql-transaction-atomicity: advertisement shape (RFC 0018)', () => {
  it('capabilities.sql is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §sql',
        'capabilities.sql.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('transactions is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const subParts = ["transactions"];
    let sub: unknown = cap;
    for (const p of subParts) {
      if (sub && typeof sub === 'object') sub = (sub as Record<string, unknown>)[p];
      else { sub = undefined; break; }
    }
    if (sub === undefined) return; // optional sub-field
    expect(
      typeof sub,
      driver.describe(
        'RFC 0018 §A',
        'sql.transactions MUST be boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'sql', op, args });
}

describe('sql-transaction-atomicity: behavioral (RFC 0018 §B.sql — transaction atomicity)', () => {
  it('transaction with N statements where N-th fails → earlier writes MUST roll back', async () => {
    const probe = await call('execute', { sql: 'CREATE TABLE IF NOT EXISTS atomicity_probe (id TEXT PRIMARY KEY)', params: [] });
    if (probe.status === 404) return;
    const table = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await call('execute', { sql: `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, val TEXT)`, params: [] });

    const txnRes = await call('transaction', {
      statements: [
        { sql: `INSERT INTO ${table}(id, val) VALUES (?, ?)`, params: [1, 'one'] },
        { sql: `INSERT INTO ${table}(id, val) VALUES (?, ?)`, params: [2, 'two'] },
        { sql: `INSERT INTO ${table}(id, val) VALUES (?, ?)`, params: [1, 'duplicate'] }, // PK violation
      ],
    });
    expect(
      txnRes.status >= 400 && txnRes.status < 500,
      driver.describe('RFC 0018 §B.sql', 'transaction with failing statement MUST surface as 4xx'),
    ).toBe(true);

    const queryRes = await call('query', { sql: `SELECT id, val FROM ${table}`, params: [] });
    expect(queryRes.status).toBe(200);
    const body = queryRes.json as { rows?: unknown[] };
    expect(
      Array.isArray(body.rows) && body.rows.length === 0,
      driver.describe('RFC 0018 §B.sql', 'rows from earlier statements in a failed transaction MUST NOT be visible'),
    ).toBe(true);
  });
});
