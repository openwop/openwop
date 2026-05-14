/**
 * RFC 0012 memory-compaction host smoke (Postgres reference impl).
 *
 * Boots the Postgres host with the compaction capability advertised
 * + the test seams enabled, drives a compaction synchronously via
 * `POST /v1/test/memory/compact`, and verifies the wire surface:
 *
 *   1. Discovery advertises `capabilities.memory.compaction.{supported,
 *      trigger: 'host-managed', maxInputEntries, maxOutputBytes}`.
 *   2. `POST /v1/test/memory/seed` plants source entries with mixed
 *      content shapes (clean + post-redaction + adversarial
 *      `[BYOK:...]` form-leak signature).
 *   3. `POST /v1/test/memory/compact` returns the canonical
 *      `memory.compacted` event payload per
 *      `run-event-payloads.schema.json` §`memoryCompacted`.
 *   4. The outputId is readable via the same access path as any
 *      MemoryEntry (the host's `getMemoryEntry`).
 *   5. SR-1 carry-forward (RFC 0012 §D): the derived content MUST
 *      NOT carry any `[BYOK:...]` form-leak or non-canonical
 *      `<REDACTED:...>` marker — they MUST have been re-substituted
 *      with the canonical `[REDACTED:carry-forward-<n>]` placeholder
 *      by `applyCompactionRedaction`.
 *   6. The output entry carries a `compacted-from:<id>` provenance
 *      tag per RFC 0012 §C.
 *   7. `POST /v1/test/memory/compact` on a memoryRef with <2 entries
 *      returns 204 (no compaction to perform).
 *
 * @see RFCS/0012-memory-compaction-profile.md
 * @see examples/hosts/postgres/src/memory-adapter.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-compaction-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
process.env.OPENWOP_MEMORY_COMPACTION = 'true';
process.env.OPENWOP_TEST_TRIGGER_COMPACTION = 'true';

// Dynamic import so process.env assignments above land BEFORE the
// server module's top-level const evaluation. The static-import
// alternative gets hoisted past the env writes and silently drops the
// compaction flag.
const { setQuerier, start } = await import('../src/server.js');
const { getMemoryEntry } = await import('../src/memory-adapter.js');
import type { Querier, QueryResult } from '../src/db.js';

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
  const querier = pgliteQuerier(db);
  setQuerier(querier);
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // 1. Discovery advertises the compaction sub-block.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    const discoBody = (await disco.json()) as {
      capabilities?: {
        memory?: {
          compaction?: {
            supported?: boolean;
            trigger?: string;
            maxInputEntries?: number;
            maxOutputBytes?: number;
          };
        };
      };
    };
    const compaction = discoBody.capabilities?.memory?.compaction;
    assert.equal(compaction?.supported, true);
    assert.equal(compaction?.trigger, 'host-managed');
    assert.equal(typeof compaction?.maxInputEntries, 'number');
    assert.ok((compaction!.maxInputEntries as number) > 0);
    assert.equal(typeof compaction?.maxOutputBytes, 'number');

    // 2. Plant source entries — mix clean + post-redaction + adversarial
    //    [BYOK:...] form-leak signatures + non-canonical <REDACTED:...>.
    const memoryRef = 'mem_tenant:default_agent:smoke_longTerm';
    const seedRes = await fetch(`${baseUrl}/v1/test/memory/seed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        memoryRef,
        entries: [
          { id: 'src-1', content: 'Customer asked about pricing tiers.' },
          { id: 'src-2', content: 'User confirmed API key works. Sensitive value: [BYOK:hk_test_abc]' },
          { id: 'src-3', content: 'Latency complaint about <REDACTED:db-prod-creds>' },
          { id: 'src-4', content: 'Followed up on the support thread.' },
        ],
      }),
    });
    assert.equal(seedRes.status, 201, 'seed endpoint MUST return 201');
    const seedBody = (await seedRes.json()) as { plantedIds: string[] };
    assert.equal(seedBody.plantedIds.length, 4);

    // 3. Drive compaction synchronously.
    const compactRes = await fetch(`${baseUrl}/v1/test/memory/compact`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ memoryRef }),
    });
    assert.equal(compactRes.status, 200, 'compact endpoint MUST return 200 with ≥2 entries');
    const event = (await compactRes.json()) as {
      type?: string;
      payload?: {
        memoryRef?: string;
        outputId?: string;
        sourceIds?: string[];
        sourceCount?: number;
        trigger?: string;
        byteSize?: number;
      };
    };

    // 3a. Canonical memory.compacted shape.
    assert.equal(event.type, 'memory.compacted');
    assert.equal(event.payload?.memoryRef, memoryRef);
    assert.equal(typeof event.payload?.outputId, 'string');
    assert.equal(event.payload?.sourceCount, 4);
    assert.equal(event.payload?.trigger, 'host-managed');
    assert.equal(typeof event.payload?.byteSize, 'number');
    assert.ok(Array.isArray(event.payload?.sourceIds));
    assert.deepEqual(event.payload!.sourceIds!.sort(), ['src-1', 'src-2', 'src-3', 'src-4']);

    // 4. outputId readable via MemoryAdapter.get.
    const outputEntry = await getMemoryEntry(
      querier,
      'tenant:default',
      memoryRef,
      event.payload!.outputId!,
    );
    assert.ok(outputEntry, 'outputId MUST be readable via getMemoryEntry');
    assert.equal(typeof outputEntry!.content, 'string');

    // 5. SR-1 carry-forward (RFC 0012 §D): derived content MUST NOT
    //    carry the adversarial form-leak signatures from sources.
    assert.equal(outputEntry!.content.includes('[BYOK:hk_test_abc]'), false,
      'SR-1 carry-forward: [BYOK:...] form-leak MUST be re-substituted');
    assert.equal(outputEntry!.content.includes('<REDACTED:db-prod-creds>'), false,
      'SR-1 carry-forward: non-canonical <REDACTED:...> markers MUST be re-substituted');
    assert.match(outputEntry!.content, /\[REDACTED:carry-forward-\d+\]/,
      'SR-1 carry-forward: canonical [REDACTED:carry-forward-<n>] markers MUST be present');

    // 6. Provenance tag (RFC 0012 §C).
    assert.ok(
      outputEntry!.tags.some((t) => t.startsWith('compacted-from:')),
      'output entry MUST carry compacted-from:<id> tag per RFC 0012 §C',
    );

    // 7. memoryRef with <2 entries returns 204.
    const emptyRef = 'mem_tenant:default_agent:empty_longTerm';
    const emptySeed = await fetch(`${baseUrl}/v1/test/memory/seed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        memoryRef: emptyRef,
        entries: [{ id: 'lonely', content: 'sole entry' }],
      }),
    });
    assert.equal(emptySeed.status, 201);
    const emptyCompact = await fetch(`${baseUrl}/v1/test/memory/compact`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ memoryRef: emptyRef }),
    });
    assert.equal(emptyCompact.status, 204, 'compact on memoryRef with <2 entries MUST return 204');

    // eslint-disable-next-line no-console
    console.log('ok memory-compaction — 7 paths verified (advertisement + seed + compact + outputId + SR-1 §D + provenance + empty-noop)');
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
