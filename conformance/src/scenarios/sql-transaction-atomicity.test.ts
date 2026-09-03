/**
 * sql-transaction-atomicity — RFC 0018 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0018 promoted to
 * `Active` 2026-05-17. The matching `capabilities.sql` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and exercises the
 * behavioral surface through the `/v1/host/sample/test/surface` seam
 * (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: transactions MUST be atomic; partial failure rolls back.
 *
 * @see RFCS/0018-*.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["sql"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('sql-transaction-atomicity: advertisement shape (RFC 0018)', () => {
  it('capabilities.sql is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early (host doesn\'t advertise — skip)'); // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      req('openwop.it.sql-transaction-atomicity.capabilities-sql-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §sql',
        'capabilities.sql.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('transactions is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    const subParts = ["transactions"];
    let sub: unknown = cap;
    for (const p of subParts) {
      if (sub && typeof sub === 'object') sub = (sub as Record<string, unknown>)[p];
      else { sub = undefined; break; }
    }
    if (sub === undefined) return softSkip('blocked', 'precondition not met — `sub === undefined` returned early (optional sub-field) (seam, prior step, or fixture unavailable)'); // optional sub-field
    expect(
      typeof sub,
      req('openwop.it.sql-transaction-atomicity.transactions-is-a-boolean-when-set', 
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
    if (probe.status === 404) return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
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
      req('openwop.it.sql-transaction-atomicity.transaction-with-n-statements-where-n-th-fails-earlier-writes-must-roll-back', 'RFC 0018 §B.sql', 'transaction with failing statement MUST surface as 4xx'),
    ).toBe(true);

    const queryRes = await call('query', { sql: `SELECT id, val FROM ${table}`, params: [] });
    expect(queryRes.status).toBe(200);
    const body = queryRes.json as { rows?: unknown[] };
    expect(
      Array.isArray(body.rows) && body.rows.length === 0,
      req('openwop.it.sql-transaction-atomicity.transaction-with-n-statements-where-n-th-fails-earlier-writes-must-roll-back', 'RFC 0018 §B.sql', 'rows from earlier statements in a failed transaction MUST NOT be visible'),
    ).toBe(true);
  });
});
