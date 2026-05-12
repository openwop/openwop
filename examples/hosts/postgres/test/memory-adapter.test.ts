/**
 * MemoryAdapter smoke (Phase I.1).
 *
 * Verifies RFC 0004 + capabilities.md §`memory`:
 *
 *   1. Discovery advertises `capabilities.memory.supported: true`.
 *   2. `list()` on unknown memoryRef returns `[]` (not null).
 *   3. Write + read roundtrip: write 3 entries, list returns 3 in
 *      created_at DESC order.
 *   4. Tag filter: `list({tag: 'foo'})` returns only foo-tagged.
 *   5. Limit honored: `list({limit: 2})` returns ≤2.
 *   6. `get()` returns the entry; unknown id returns `null`.
 *   7. TTL expiry: an entry with `expiresAt` in the past does NOT
 *      surface from `list()` or `get()`.
 *   8. CTI-1: tenant A's entries are NOT visible to tenant B.
 *   9. SR-1 byte cap: entries beyond MAX_ENTRY_SIZE_BYTES rejected
 *      at write time with a thrown Error.
 *
 * @see spec/v1/agent-memory.md §"MemoryAdapter interface"
 * @see SECURITY/invariants.yaml §CTI-1
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-memory-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.ts';
import type { Querier, QueryResult } from '../src/db.js';
import {
  setupMemorySchema,
  listMemoryEntries,
  getMemoryEntry,
  writeMemoryEntry,
  deleteMemoryEntry,
} from '../src/memory-adapter.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  const q = pgliteQuerier(db);
  setQuerier(q);
  await setupMemorySchema(q);
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Discovery advertises memory capability.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    const discoBody = (await disco.json()) as {
      capabilities?: { memory?: { supported?: boolean; maxEntrySizeBytes?: number; ttlSupported?: boolean } };
    };
    assert.equal(discoBody.capabilities?.memory?.supported, true);
    assert.equal(typeof discoBody.capabilities?.memory?.maxEntrySizeBytes, 'number');
    assert.equal(discoBody.capabilities?.memory?.ttlSupported, true);

    // 2. list() on unknown ref returns [].
    const empty = await listMemoryEntries(q, 'tenant-a', 'mem://unknown');
    assert.equal(empty.length, 0);

    // 3. Write + list roundtrip.
    await writeMemoryEntry(q, {
      tenantId: 'tenant-a', memoryRef: 'mem://agent-1', memoryId: 'm1',
      content: 'first memory', tags: ['foo'],
    });
    await new Promise((r) => setTimeout(r, 5));
    await writeMemoryEntry(q, {
      tenantId: 'tenant-a', memoryRef: 'mem://agent-1', memoryId: 'm2',
      content: 'second memory', tags: ['foo', 'bar'],
    });
    await new Promise((r) => setTimeout(r, 5));
    await writeMemoryEntry(q, {
      tenantId: 'tenant-a', memoryRef: 'mem://agent-1', memoryId: 'm3',
      content: 'third memory', tags: ['bar'],
    });
    const entries = await listMemoryEntries(q, 'tenant-a', 'mem://agent-1');
    assert.equal(entries.length, 3);
    // DESC order: m3 most recent.
    assert.equal(entries[0]?.id, 'm3');
    assert.equal(entries[2]?.id, 'm1');

    // 4. Tag filter.
    const fooOnly = await listMemoryEntries(q, 'tenant-a', 'mem://agent-1', { tag: 'foo' });
    assert.equal(fooOnly.length, 2);
    assert.ok(fooOnly.every((e) => e.tags.includes('foo')));

    // 5. Limit honored.
    const limited = await listMemoryEntries(q, 'tenant-a', 'mem://agent-1', { limit: 2 });
    assert.equal(limited.length, 2);

    // 6. get() roundtrip + null on miss.
    const m1 = await getMemoryEntry(q, 'tenant-a', 'mem://agent-1', 'm1');
    assert.ok(m1);
    assert.equal(m1.content, 'first memory');
    const miss = await getMemoryEntry(q, 'tenant-a', 'mem://agent-1', 'never-existed');
    assert.equal(miss, null);

    // 7. TTL expiry — entry with past expiresAt is invisible.
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    await writeMemoryEntry(q, {
      tenantId: 'tenant-a', memoryRef: 'mem://ttl-test', memoryId: 'expired',
      content: 'should be invisible', expiresAt: pastIso,
    });
    const ttlList = await listMemoryEntries(q, 'tenant-a', 'mem://ttl-test');
    assert.equal(ttlList.length, 0, 'expired entry MUST NOT surface from list()');
    const ttlGet = await getMemoryEntry(q, 'tenant-a', 'mem://ttl-test', 'expired');
    assert.equal(ttlGet, null, 'expired entry MUST NOT surface from get()');

    // 8. CTI-1 — cross-tenant isolation.
    await writeMemoryEntry(q, {
      tenantId: 'tenant-b', memoryRef: 'mem://agent-1', memoryId: 'b-private',
      content: 'tenant-b private memory', tags: ['private'],
    });
    const tenantBView = await listMemoryEntries(q, 'tenant-a', 'mem://agent-1');
    assert.ok(
      tenantBView.every((e) => e.id !== 'b-private'),
      'CTI-1: tenant A MUST NOT see tenant B entries even on same memoryRef',
    );
    const crossGet = await getMemoryEntry(q, 'tenant-a', 'mem://agent-1', 'b-private');
    assert.equal(crossGet, null, 'CTI-1: get() MUST NOT resolve another tenant\'s memoryId');

    // 9. SR-1 byte cap — oversized content rejected.
    const huge = 'x'.repeat(65_537);
    let threw = false;
    try {
      await writeMemoryEntry(q, {
        tenantId: 'tenant-a', memoryRef: 'mem://agent-1', memoryId: 'huge', content: huge,
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'writeMemoryEntry MUST reject content > maxEntrySizeBytes');

    // Cleanup verification.
    await deleteMemoryEntry(q, 'tenant-a', 'mem://agent-1', 'm1');
    const afterDelete = await getMemoryEntry(q, 'tenant-a', 'mem://agent-1', 'm1');
    assert.equal(afterDelete, null);

    void port; void baseUrl;
    // eslint-disable-next-line no-console
    console.log('ok memory-adapter — I.1 verified (9 paths + CTI-1 + SR-1 byte cap)');
  } finally {
    await close();
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
