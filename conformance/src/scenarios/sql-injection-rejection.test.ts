/**
 * sql-injection-rejection — RFC 0018 §C + SECURITY/invariants.yaml
 * `sql-parametric-only`.
 *
 * Status: ACTIVE (advertisement + behavioral). The host's SQL surface
 * MUST treat parameter values as literal data, not SQL fragments. We
 * verify by binding an injection-shape string as a parameter and
 * confirming it returns no rows (parametric binding turns it into a
 * literal value comparison rather than an OR-true).
 *
 * @see RFCS/0018-host-sql-vector-search-capability.md
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

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'sql', op, args });
}

describe('sql-injection-rejection: advertisement shape (RFC 0018)', () => {
  it('capabilities.sql is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(
      typeof cap.supported,
      req('openwop.it.sql-injection-rejection.capabilities-sql-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §sql',
        'capabilities.sql.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('sql-injection-rejection: behavioral (RFC 0018 §C)', () => {
  it('parametric SELECT with bound user input rejects injection-shape strings as data', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');

    const create = await call('execute', {
      sql: `CREATE TABLE IF NOT EXISTS sql_inj_t (id TEXT PRIMARY KEY, body TEXT)`,
      params: [],
    });
    if (create.status === 404) return softSkip('blocked', 'precondition not met — `create.status === 404` returned early (seam, prior step, or fixture unavailable)');
    await call('execute', { sql: `INSERT OR REPLACE INTO sql_inj_t VALUES (?, ?)`, params: ['k1', 'ok'] });

    // Parametric round-trip MUST succeed.
    const okRes = await call('query', {
      sql: `SELECT body FROM sql_inj_t WHERE id = ?`,
      params: ['k1'],
    });
    expect(okRes.status).toBe(200);
    const okBody = okRes.json as { rows?: Array<Record<string, unknown>> };
    expect(okBody.rows?.[0]?.body, req('openwop.it.sql-injection-rejection.parametric-select-with-bound-user-input-rejects-injection-shape-strings-as-data', 'SECURITY/invariants.yaml sql-parametric-only', 'parametric round-trip MUST return stored value')).toBe('ok');

    // Injection-shape input MUST be bound as a literal value, not SQL.
    const attack = `' OR '1'='1`;
    const attackRes = await call('query', {
      sql: `SELECT body FROM sql_inj_t WHERE id = ?`,
      params: [attack],
    });
    expect(attackRes.status).toBe(200);
    const attackBody = attackRes.json as { rows?: Array<Record<string, unknown>> };
    expect(
      Array.isArray(attackBody.rows) ? attackBody.rows.length : -1,
      req('openwop.it.sql-injection-rejection.parametric-select-with-bound-user-input-rejects-injection-shape-strings-as-data', 
        'SECURITY/invariants.yaml sql-parametric-only',
        'parametric binding MUST treat injection-shape input as a literal value, not SQL',
      ),
    ).toBe(0);
  });
});
