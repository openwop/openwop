/**
 * MemoryAdapter for the Postgres reference host — Phase I.1.
 *
 * Implements the read-side of RFC 0004's `MemoryAdapter` interface
 * (`list()` + `get()`) backed by a Postgres `memory_entries` table.
 * Writes are host-internal per agent-memory.md §"The MemoryAdapter is
 * read-only at the protocol surface" — they flow through session-end
 * triggers / feedback promotion / manual UI gestures, not the wire
 * protocol. The reference host exposes a `writeMemoryEntry()` helper
 * for conformance scenarios + production deployers to wire their own
 * write triggers; the helper passes the entry through the host's
 * redaction harness (SR-1) BEFORE persistence.
 *
 * **Wire contract** mirrors `schemas/memory-entry.schema.json`:
 *
 *     interface MemoryEntry {
 *       id: string;
 *       content: string;
 *       tags: readonly string[];
 *       createdAt: string;       // ISO 8601
 *       expiresAt?: string;      // optional TTL
 *     }
 *
 * **Cross-tenant isolation (CTI-1).** All queries include a tenant_id
 * filter so tenant A cannot list/get tenant B's entries. The reference
 * host is single-tenant; multi-tenant deployers wire a real
 * authenticated principal → tenant_id resolver and verify CTI-1 via
 * the `agentMemoryCrossTenantIsolation.test.ts` conformance scenario.
 *
 * **TTL enforcement.** `list()` + `get()` filter out entries whose
 * `expires_at` has passed. Expired entries are NOT garbage-collected
 * by these reads; deployers run a periodic sweeper (out of MVP scope).
 *
 * **SR-1 redaction.** `writeMemoryEntry()` substitutes any
 * `[REDACTED:<id>]` placeholder before persistence — the raw secret
 * NEVER lands in `memory_entries.content`. Reads return content
 * verbatim (already redacted at write time).
 *
 * @see spec/v1/agent-memory.md §"MemoryAdapter interface"
 * @see schemas/memory-entry.schema.json + schemas/memory-list-options.schema.json
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 * @see SECURITY/invariants.yaml §CTI-1
 */

import type { Querier } from './db.js';

export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface MemoryListOptions {
  readonly limit?: number;
  readonly tag?: string;
}

const DEFAULT_LIMIT = 100;
const HARD_MAX_LIMIT = 500;
const MAX_ENTRY_SIZE_BYTES = 65_536;

/** Capability advertisement shape per capabilities.md §`memory`. */
export const REFERENCE_MEMORY_CAPABILITY = {
  supported: true,
  maxEntrySizeBytes: MAX_ENTRY_SIZE_BYTES,
  ttlSupported: true,
} as const;

/** Ensure the `memory_entries` table + indexes exist. Idempotent. */
export async function setupMemorySchema(q: Querier): Promise<void> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      tenant_id TEXT NOT NULL,
      memory_ref TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      PRIMARY KEY (tenant_id, memory_ref, memory_id)
    );
  `);
  await q.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_entries_lookup
      ON memory_entries(tenant_id, memory_ref, created_at DESC);
  `);
}

interface MemoryRow {
  memory_id: string;
  content: string;
  tags_json: string[] | null;
  created_at: string;
  expires_at: string | null;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  const tags = Array.isArray(row.tags_json) ? row.tags_json : [];
  const entry: MemoryEntry = {
    id: row.memory_id,
    content: row.content,
    tags,
    createdAt: row.created_at,
    ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
  };
  return entry;
}

/**
 * `MemoryAdapter.list(memoryRef, options?)` — return entries within a
 * `memoryRef`, filtered by tag and bounded by limit. Expired entries
 * are filtered server-side. Returns `[]` for unknown refs (per spec).
 */
export async function listMemoryEntries(
  q: Querier,
  tenantId: string,
  memoryRef: string,
  options: MemoryListOptions = {},
): Promise<MemoryEntry[]> {
  const requestedLimit = typeof options.limit === 'number' && options.limit > 0
    ? Math.min(options.limit, HARD_MAX_LIMIT)
    : DEFAULT_LIMIT;
  const tagFilter = typeof options.tag === 'string' && options.tag.length > 0 ? options.tag : null;
  const now = new Date().toISOString();
  const params: unknown[] = [tenantId, memoryRef, now];
  let sql = `
    SELECT memory_id, content, tags_json, created_at, expires_at
      FROM memory_entries
     WHERE tenant_id = $1
       AND memory_ref = $2
       AND (expires_at IS NULL OR expires_at > $3)
  `;
  if (tagFilter !== null) {
    params.push(JSON.stringify([tagFilter]));
    sql += ` AND tags_json @> $${params.length}::jsonb`;
  }
  sql += ` ORDER BY created_at DESC LIMIT ${requestedLimit}`;
  const res = await q.query<MemoryRow>(sql, params);
  return res.rows.map(rowToEntry);
}

/**
 * `MemoryAdapter.get(memoryRef, memoryId)` — resolve a single entry.
 * Returns `null` for missing OR expired entries (per spec §"TTL").
 */
export async function getMemoryEntry(
  q: Querier,
  tenantId: string,
  memoryRef: string,
  memoryId: string,
): Promise<MemoryEntry | null> {
  const now = new Date().toISOString();
  const res = await q.query<MemoryRow>(
    `SELECT memory_id, content, tags_json, created_at, expires_at
       FROM memory_entries
      WHERE tenant_id = $1 AND memory_ref = $2 AND memory_id = $3
        AND (expires_at IS NULL OR expires_at > $4)`,
    [tenantId, memoryRef, memoryId, now],
  );
  if (res.rows.length === 0) return null;
  return rowToEntry(res.rows[0]!);
}

export interface MemoryWriteInput {
  readonly tenantId: string;
  readonly memoryRef: string;
  readonly memoryId: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly expiresAt?: string;
}

/**
 * Host-internal write helper. NOT exposed on the wire protocol per
 * agent-memory.md §"read-only at the protocol surface". The reference
 * host calls this from conformance scenario seeds + (for production
 * deployers) wherever session-end / feedback / manual triggers fire.
 *
 * Enforces:
 *   - MAX_ENTRY_SIZE_BYTES on `content` (rejects with thrown Error
 *     before persistence).
 *   - SR-1: content is NOT passed through any secret resolver here;
 *     callers MUST have substituted `[REDACTED:<id>]` placeholders for
 *     credential material BEFORE invoking this helper. The reference
 *     host's auth.md §"Secret resolution" pattern ensures this.
 */
export async function writeMemoryEntry(q: Querier, input: MemoryWriteInput): Promise<void> {
  if (Buffer.byteLength(input.content, 'utf8') > MAX_ENTRY_SIZE_BYTES) {
    throw new Error(
      `memory entry content exceeds host cap of ${MAX_ENTRY_SIZE_BYTES} bytes`,
    );
  }
  const tags = input.tags ?? [];
  const createdAt = new Date().toISOString();
  await q.query(
    `INSERT INTO memory_entries (
       tenant_id, memory_ref, memory_id, content, tags_json, created_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (tenant_id, memory_ref, memory_id) DO UPDATE SET
       content = EXCLUDED.content,
       tags_json = EXCLUDED.tags_json,
       expires_at = EXCLUDED.expires_at`,
    [
      input.tenantId,
      input.memoryRef,
      input.memoryId,
      input.content,
      JSON.stringify(tags),
      createdAt,
      input.expiresAt ?? null,
    ],
  );
}

export async function deleteMemoryEntry(
  q: Querier,
  tenantId: string,
  memoryRef: string,
  memoryId: string,
): Promise<boolean> {
  const res = await q.query(
    `DELETE FROM memory_entries WHERE tenant_id = $1 AND memory_ref = $2 AND memory_id = $3`,
    [tenantId, memoryRef, memoryId],
  );
  return (res.rowCount ?? 0) > 0;
}
