/**
 * Host-extension durability (RFC 0086/0087/0083 sample stores).
 *
 * Verifies the generic `Storage.kvGet/kvSet` primitive + the
 * hostExtPersistence write-back/hydrate layer: a roster entry + an org-chart
 * created against one storage handle survive into a fresh handle on the same
 * sqlite FILE (the in-memory map is cleared between, proving hydration reads
 * from disk, not the process). `:memory:` is intentionally NOT used here — it
 * does not persist across connections (expected).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import {
  __resetHostExtPersistence,
  flushHostExtPersistence,
  initHostExtPersistence,
} from '../src/host/hostExtPersistence.js';
import { __resetRosterStore, createRosterEntry, hydrateRoster, listRoster } from '../src/host/rosterService.js';
import { __resetOrgChartStore, getChart, hydrateOrgCharts, putChart } from '../src/host/orgChartService.js';

const dir = mkdtempSync(join(tmpdir(), 'owop-dur-'));
const dbPath = join(dir, 'dur.db');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('host-ext durability: kv primitive round-trip (sqlite file)', () => {
  it('kvSet then kvGet on a fresh handle returns the value', async () => {
    const a = openSqliteStorage(dbPath);
    await a.kvSet('probe', JSON.stringify({ hello: 'world' }));
    await a.close();
    const b = openSqliteStorage(dbPath);
    expect(JSON.parse((await b.kvGet('probe'))!)).toEqual({ hello: 'world' });
    expect(await b.kvGet('missing')).toBeNull();
    await b.close();
  });
});

describe('host-ext durability: roster + org-chart survive a restart', () => {
  beforeEach(() => {
    __resetRosterStore();
    __resetOrgChartStore();
    __resetHostExtPersistence();
  });

  it('persists a roster entry + org-chart, then hydrates them into a fresh store', async () => {
    const path = join(dir, 'roundtrip.db');
    // Session 1: create, then flush the write-back.
    const s1 = openSqliteStorage(path);
    initHostExtPersistence(s1);
    const sally = createRosterEntry({ tenantId: 'acme', persona: 'Sally', agentRef: { agentId: 'a.b.c.d' }, workflows: ['wf-1'] });
    putChart({
      tenantId: 'acme',
      departments: [{ departmentId: 'dept-mk', name: 'Marketing', parentDepartmentId: null, roles: [{ roleId: 'r', name: 'Member' }] }],
      members: [{ rosterId: sally.rosterId, departmentId: 'dept-mk', roleId: 'r', reportsTo: null }],
    });
    await flushHostExtPersistence();
    await s1.close();

    // Simulate a restart: clear the in-memory maps + re-open the same file.
    __resetRosterStore();
    __resetOrgChartStore();
    __resetHostExtPersistence();
    expect(listRoster('acme')).toHaveLength(0); // proven empty before hydrate

    const s2 = openSqliteStorage(path);
    initHostExtPersistence(s2);
    await hydrateRoster();
    await hydrateOrgCharts();

    const roster = listRoster('acme');
    expect(roster).toHaveLength(1);
    expect(roster[0]!.persona).toBe('Sally');
    expect(roster[0]!.workflows).toEqual(['wf-1']);
    const chart = getChart('acme');
    expect(chart?.departments[0]!.name).toBe('Marketing');
    expect(chart?.members[0]!.rosterId).toBe(sally.rosterId);
    await s2.close();
  });

  it('is a no-op when persistence is not wired (unit-test mode)', async () => {
    // No initHostExtPersistence — mutations must not throw.
    createRosterEntry({ tenantId: 't', persona: 'X', agentRef: { agentId: 'a.b.c.d' } });
    await flushHostExtPersistence();
    expect(listRoster('t')).toHaveLength(1);
  });
});
