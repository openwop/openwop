/**
 * Host-extension durability (RFC 0086/0087/0083 sample stores).
 *
 * The stores are now READ-THROUGH, PER-ENTITY, SYNCHRONOUSLY-WRITTEN on the
 * generic `Storage` kv table. These tests verify the three guarantees that
 * make a multi-instance deployment correct:
 *   1. The kv primitives (`kvSet`/`kvGet`/`kvList`/`kvDelete`) round-trip.
 *   2. READ-THROUGH: a write made by one storage handle is visible to a
 *      SECOND, independently-opened handle on the same file WITHOUT any
 *      hydrate step — the proxy for "instance B sees instance A's write."
 *   3. PER-ENTITY: entities are independent rows (delete one, the other
 *      survives) and writes are synchronous (no fire-and-forget window).
 * A `:memory:` DSN is intentionally avoided for the cross-handle tests — it
 * does not share across connections (expected).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { __resetHostExtPersistence, initHostExtPersistence } from '../src/host/hostExtPersistence.js';
import { __resetRosterStore, createRosterEntry, deleteRosterEntry, getRosterEntry, listRoster } from '../src/host/rosterService.js';
import { getChart, putChart } from '../src/host/orgChartService.js';

const dir = mkdtempSync(join(tmpdir(), 'owop-dur-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('host-ext durability: kv primitives', () => {
  it('kvSet/kvGet round-trip across a fresh handle on the same file', async () => {
    const path = join(dir, 'kv.db');
    const a = openSqliteStorage(path);
    await a.kvSet('probe', JSON.stringify({ hello: 'world' }));
    await a.close();
    const b = openSqliteStorage(path);
    expect(JSON.parse((await b.kvGet('probe'))!)).toEqual({ hello: 'world' });
    expect(await b.kvGet('missing')).toBeNull();
    await b.close();
  });

  it('kvList scans by prefix; kvDelete removes one row and reports existence', async () => {
    const s = openSqliteStorage(join(dir, 'kv2.db'));
    await s.kvSet('hostext:thing:a', '1');
    await s.kvSet('hostext:thing:b', '2');
    await s.kvSet('hostext:other:c', '3');
    const things = await s.kvList('hostext:thing:');
    expect(things.map((r) => r.key).sort()).toEqual(['hostext:thing:a', 'hostext:thing:b']);
    expect(await s.kvDelete('hostext:thing:a')).toBe(true);
    expect(await s.kvDelete('hostext:thing:a')).toBe(false); // already gone
    expect((await s.kvList('hostext:thing:')).map((r) => r.key)).toEqual(['hostext:thing:b']);
    await s.close();
  });

  it('pub/sub delivers to subscribers by channel; unsubscribe stops delivery', async () => {
    const s = openSqliteStorage(':memory:');
    const seenA: string[] = [];
    const seenB: string[] = [];
    const unsubA = await s.subscribe('chan.a', (p) => seenA.push(p));
    await s.subscribe('chan.b', (p) => seenB.push(p));
    await s.publish('chan.a', 'a1');
    await s.publish('chan.b', 'b1');
    await s.publish('chan.a', 'a2');
    expect(seenA).toEqual(['a1', 'a2']);
    expect(seenB).toEqual(['b1']); // channel isolation
    await unsubA();
    await s.publish('chan.a', 'a3');
    expect(seenA).toEqual(['a1', 'a2']); // no delivery after unsubscribe
    await s.close();
  });
});

describe('host-ext durability: read-through across instances', () => {
  beforeEach(() => {
    __resetHostExtPersistence();
  });

  it('a second instance sees the first instance’s writes with NO hydrate step', async () => {
    const path = join(dir, 'readthrough.db');

    // "Instance 1": create a roster entry + an org-chart, then go away.
    const s1 = openSqliteStorage(path);
    initHostExtPersistence(s1);
    const sally = await createRosterEntry({ tenantId: 'acme', persona: 'Sally', agentRef: { agentId: 'a.b.c.d' }, workflows: ['wf-1'] });
    await putChart({
      tenantId: 'acme',
      departments: [{ departmentId: 'dept-mk', name: 'Marketing', parentDepartmentId: null, roles: [{ roleId: 'r', name: 'Member' }] }],
      members: [{ rosterId: sally.rosterId, departmentId: 'dept-mk', roleId: 'r', reportsTo: null }],
    });
    await s1.close();

    // "Instance 2": a brand-new handle that never saw instance 1's process
    // state. NO hydrate call — the read goes straight to the durable row.
    const s2 = openSqliteStorage(path);
    initHostExtPersistence(s2);
    const roster = await listRoster('acme');
    expect(roster).toHaveLength(1);
    expect(roster[0]!.persona).toBe('Sally');
    expect(roster[0]!.workflows).toEqual(['wf-1']);
    const chart = await getChart('acme');
    expect(chart?.departments[0]!.name).toBe('Marketing');
    expect(chart?.members[0]!.rosterId).toBe(sally.rosterId);
    await s2.close();
  });

  it('writes are per-entity: deleting one entry leaves the others intact', async () => {
    const s = openSqliteStorage(join(dir, 'perentity.db'));
    initHostExtPersistence(s);
    await __resetRosterStore();
    const a = await createRosterEntry({ tenantId: 't', persona: 'A', agentRef: { agentId: 'x.y.z.a' } });
    const b = await createRosterEntry({ tenantId: 't', persona: 'B', agentRef: { agentId: 'x.y.z.b' } });
    expect(await deleteRosterEntry(a.rosterId)).toBe(true);
    expect(await getRosterEntry(a.rosterId)).toBeNull();
    expect((await getRosterEntry(b.rosterId))?.persona).toBe('B');
    expect(await listRoster('t')).toHaveLength(1);
    await s.close();
  });

  it('throws a clear error when persistence is not wired', async () => {
    __resetHostExtPersistence();
    await expect(createRosterEntry({ tenantId: 't', persona: 'X', agentRef: { agentId: 'a.b.c.d' } })).rejects.toThrow(/not initialized/);
  });
});
