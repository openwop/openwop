/**
 * In-memory host surfaces (demo-grade).
 *
 * Wires the `ctx.*` surfaces that core packs delegate to (RFCs
 * 0014–0019 + queueBus + observability) so the workflow-engine sample
 * can actually run the most common pack-authored nodes. All state is
 * process-local — restart wipes everything. Tenant isolation is
 * enforced by keying every Map / sqlite-row on `tenantId`.
 *
 * What's NOT here:
 *   - NoSQL (`ctx.db.nosql`) — pack defines insert/find/update/delete
 *     but the demo doesn't pick a document shape; a real impl would
 *     wire Mongo/Firestore.
 *   - Full-text search (`ctx.db.search`) — needs a real index.
 *   - File-system image / pdf / archive helpers — out of scope.
 *   - FTP / SFTP / SSH transports — out of scope.
 *
 * Path to real backends (Phase 6):
 *   The surface interfaces below are the same the real-backend hosts
 *   will satisfy. Swap each `create*InMemory()` with a `create*Postgres`
 *   / `create*Redis` / `create*S3` / etc. in `examples/hosts/postgres`
 *   (which already exists) and re-export through this module's
 *   `HostSurfaceBundle`. NodeContext typing doesn't change.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createLogger } from '../observability/logger.js';
import { registerHostSurface } from '../bootstrap/hostSurfaceRegistry.js';
import { redactForCompaction } from '../byok/textRedaction.js';
import { DurableCollection } from './hostExtPersistence.js';

const log = createLogger('host.inMemorySurfaces');

// ───────────────────────────────────────────────────────────────────
// Surface bundle. Each field matches the pack-side delegate target
// exactly:
//   core.openwop.storage  → ctx.storage.<surface>.<method>
//   core.openwop.db       → ctx.db.<surface>.<method>
//   core.openwop.files    → ctx.fs.<method>  (+ ctx.fs.<sub>.<method> for image/pdf — NOT wired)
//   core.openwop.messaging → ctx.queueBus.<method>
//   core.openwop.obs      → ctx.observability.<method>
// ───────────────────────────────────────────────────────────────────

export interface HostSurfaceBundle {
  storage: {
    kv: KvSurface;
    table: TableSurface;
    cache: CacheSurface;
    blob: BlobSurface;
    queue: QueueSurface;
  };
  db: {
    sql: SqlSurface;
    vector: VectorSurface;
    /** RFC 0018 §A.searchIndex — full-text / BM25 search surface.
     *  Distinct from `vector` (semantic) and `sql` (relational). */
    search: SearchSurface;
  };
  fs: FsSurface;
  queueBus: QueueBusSurface;
  observability: ObservabilitySurface;
}

/** Inputs all surface methods receive. Pack delegates spread
 *  `{ ...ctx.config, ...ctx.inputs }` onto the call, so the host sees
 *  one flat record with both. The host must know its own field names
 *  (matches the schemas under packs/<name>/schemas/). */
export type SurfaceArgs = Record<string, unknown>;
/** All surface methods are async + return a free-form result that the
 *  pack delegate forwards as `outputs`. */
export type SurfaceFn = (args: SurfaceArgs) => Promise<Record<string, unknown>>;

export type KvSurface = {
  get: SurfaceFn;
  set: SurfaceFn;
  delete: SurfaceFn;
  list: SurfaceFn;
  atomicIncrement: SurfaceFn;
  cas: SurfaceFn;
};
export type TableSurface = {
  insert: SurfaceFn;
  update: SurfaceFn;
  upsert: SurfaceFn;
  delete: SurfaceFn;
  query: SurfaceFn;
  count: SurfaceFn;
};
export type CacheSurface = {
  get: SurfaceFn;
  put: SurfaceFn;
  evict: SurfaceFn;
};
export type BlobSurface = {
  put: SurfaceFn;
  get: SurfaceFn;
  presign: SurfaceFn;
};
export type QueueSurface = {
  enqueue: SurfaceFn;
  dequeue: SurfaceFn;
};
export type SqlSurface = {
  query: SurfaceFn;
  execute: SurfaceFn;
  transaction: SurfaceFn;
};
export type VectorSurface = {
  upsert: SurfaceFn;
  query: SurfaceFn;
  delete: SurfaceFn;
};
/** RFC 0018 §A.searchIndex — full-text search surface. The in-memory
 *  reference impl uses a naive bag-of-words relevance score (token
 *  frequency in the indexed fields); production hosts back this with
 *  Elasticsearch / OpenSearch / Meilisearch / Typesense per the
 *  advertised `backends[]` list. */
export type SearchSurface = {
  index: SurfaceFn;
  query: SurfaceFn;
  delete: SurfaceFn;
};
export type FsSurface = {
  read: SurfaceFn;
  write: SurfaceFn;
  delete: SurfaceFn;
  stat: SurfaceFn;
  list: SurfaceFn;
};
export type QueueBusSurface = {
  publish: SurfaceFn;
  /** RFC 0017 §B point 2 — consume one message from the named `subject`.
   *  Returns `{ found, deliveryToken, payload, subject, id }` on hit;
   *  `{ found: false }` on empty. Consumed messages move to an
   *  in-flight tracking map keyed by `deliveryToken`; `ack` removes
   *  the entry, `nack` re-queues, `deadLetter` routes to a `.dlq`
   *  subject. */
  consume: SurfaceFn;
  ack: SurfaceFn;
  nack: SurfaceFn;
  deadLetter: SurfaceFn;
  streamPublish: SurfaceFn;
  /** RFC 0017 §A `stream` sub-block — subscribe to the named stream.
   *  When `fromBeginning: true` returns a snapshot of all records
   *  currently on the stream; when `false` (or absent) returns an
   *  empty snapshot (in-memory impl has no buffered new-record
   *  delivery — real impls would back the surface with a true
   *  log-style storage like Kafka / NATS JetStream). */
  streamSubscribe: SurfaceFn;
};
export type ObservabilitySurface = {
  log: SurfaceFn;
  metric: SurfaceFn;
  startSpan: SurfaceFn;
  endSpan: SurfaceFn;
  alert: SurfaceFn;
};

// ───────────────────────────────────────────────────────────────────
// Tenant-scoping helpers
// ───────────────────────────────────────────────────────────────────

/** Every surface method receives args + an implicit tenantId context.
 *  Because the pack delegates spread inputs+config flat, the host
 *  resolver injects tenantId via a closure: the executor builds one
 *  surface bundle PER RUN, with its tenantId baked in. */
export interface BundleScope {
  tenantId: string;
  scopeId?: string;
}

// ───────────────────────────────────────────────────────────────────
// kv / table / cache / blob / queue (all Map-backed)
// ───────────────────────────────────────────────────────────────────

/** Tenant-namespaced map. The outer Map keys are tenantIds; the inner
 *  Maps are per-key state. Re-allocated only when missing — no leaks
 *  for tenants that come and go. */
class TenantMap<V> {
  private readonly inner = new Map<string, Map<string, V>>();
  bucket(tenantId: string): Map<string, V> {
    let b = this.inner.get(tenantId);
    if (!b) { b = new Map(); this.inner.set(tenantId, b); }
    return b;
  }
}

interface KvEntry { value: unknown; expiresAtMs?: number; }

function createKv(state: TenantMap<KvEntry>, scope: BundleScope): KvSurface {
  const bucket = () => state.bucket(scope.tenantId);
  const now = () => Date.now();
  const fresh = (e: KvEntry | undefined) =>
    !e ? null : (e.expiresAtMs && e.expiresAtMs <= now() ? null : e);
  return {
    async get({ key }) {
      const entry = fresh(bucket().get(String(key)));
      const ttlRemainingMs = entry?.expiresAtMs ? Math.max(0, entry.expiresAtMs - now()) : null;
      return { value: entry?.value ?? null, found: !!entry, ttlRemainingMs };
    },
    async set({ key, value, ttlSeconds }) {
      const entry: KvEntry = { value };
      if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
        entry.expiresAtMs = now() + ttlSeconds * 1000;
      }
      bucket().set(String(key), entry);
      return { ok: true };
    },
    async delete({ key }) {
      const existed = bucket().delete(String(key));
      return { ok: true, existed };
    },
    async list({ prefix }) {
      const p = typeof prefix === 'string' ? prefix : '';
      const keys: string[] = [];
      for (const [k, e] of bucket().entries()) {
        if (!fresh(e)) continue;
        if (!p || k.startsWith(p)) keys.push(k);
      }
      return { keys };
    },
    async atomicIncrement({ key, delta }) {
      const b = bucket();
      const existing = fresh(b.get(String(key)));
      const prev = typeof existing?.value === 'number' ? existing.value : 0;
      const next = prev + (typeof delta === 'number' ? delta : 1);
      b.set(String(key), { value: next });
      return { value: next };
    },
    async cas(args) {
      // RFC 0015 §B point 5 canonical CAS shape: input `{key, expect,
      // set}`, output `{swapped: boolean, actual?: unknown}` (the live
      // value at the call). Accept legacy `{expected, value}` from older
      // sample call sites for backward compatibility; emit only the
      // canonical output shape.
      const a = args as { key?: unknown; expect?: unknown; expected?: unknown; set?: unknown; value?: unknown };
      const key = String(a.key);
      const expectVal = 'expect' in a ? a.expect : a.expected;
      const setVal = 'set' in a ? a.set : a.value;
      const b = bucket();
      const cur = fresh(b.get(key))?.value ?? null;
      if (JSON.stringify(cur) !== JSON.stringify(expectVal ?? null)) {
        // Spec field name is `actual` (the live value at miss-time) per
        // `kv-cas.test.ts`. The legacy `currentValue` alias had no remaining
        // readers (src, packs, conformance) so it's dropped.
        return { swapped: false, actual: cur };
      }
      b.set(key, { value: setVal });
      return { swapped: true, actual: setVal };
    },
  };
}

interface TableRow { id: string; [field: string]: unknown; }
/** RFC 0016 §B point 2 — schema declared on first insert; subsequent
 *  rows MUST conform. Per-tenant + per-table column-type registry. */
type TableColType = 'string' | 'number' | 'boolean' | 'object';
const _tableSchemas = new Map<string /* tenantId::tableName */, Map<string, TableColType>>();
function inferColType(v: unknown): TableColType {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'object';
}
function createTable(state: TenantMap<TableRow>, scope: BundleScope): TableSurface {
  // Tenant-bucket is a Map<rowId, row>. `args.table` namespaces by
  // table name via a prefix on the row id (since we only have one Map).
  const key = (table: unknown, id: unknown) => `${String(table)}::${String(id)}`;
  const bucket = () => state.bucket(scope.tenantId);
  const schemaKey = (table: unknown) => `${scope.tenantId}::${String(table)}`;
  return {
    async insert({ table, row }) {
      const r = row as TableRow;
      const sKey = schemaKey(table);
      let schema = _tableSchemas.get(sKey);
      if (!schema) {
        // First insert — declare the schema from this row's columns.
        schema = new Map();
        for (const [col, val] of Object.entries(r)) {
          if (col === 'id') continue;
          schema.set(col, inferColType(val));
        }
        _tableSchemas.set(sKey, schema);
      } else {
        // Subsequent insert — every column MUST conform.
        for (const [col, val] of Object.entries(r)) {
          if (col === 'id') continue;
          const declared = schema.get(col);
          if (declared === undefined) continue; // new column — additive, allowed
          const got = inferColType(val);
          if (got !== declared) {
            throw Object.assign(new Error(`Column '${col}' declared as '${declared}', got '${got}'`), {
              code: 'table_schema_violation',
            });
          }
        }
      }
      bucket().set(key(table, r.id), { ...r });
      return { id: r.id };
    },
    async update({ table, id, patch }) {
      const b = bucket();
      const k = key(table, id);
      const cur = b.get(k);
      if (!cur) return { updated: 0 };
      b.set(k, { ...cur, ...(patch as Record<string, unknown>) });
      return { updated: 1 };
    },
    async upsert({ table, row }) {
      const r = row as TableRow;
      const b = bucket();
      const k = key(table, r.id);
      const existed = b.has(k);
      b.set(k, { ...b.get(k), ...r });
      return { upserted: 1, created: !existed };
    },
    async delete({ table, id }) {
      const b = bucket();
      const k = key(table, id);
      const existed = b.delete(k);
      return { deleted: existed ? 1 : 0 };
    },
    async query({ table, filter, limit, cursor }) {
      const t = String(table);
      // RFC 0016 §B point 3 — cursor pagination. The cursor is an
      // opaque token; the in-memory impl uses base64(after_id) so the
      // caller can resume after the last-returned row deterministically.
      const afterId = typeof cursor === 'string' && cursor.length > 0
        ? Buffer.from(cursor, 'base64').toString('utf8')
        : '';
      const lim = typeof limit === 'number' && limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
      // Collect all matching rows in deterministic order (sorted by id),
      // skipping anything ≤ afterId, capped at `lim`.
      const allMatching: TableRow[] = [];
      for (const [k, row] of bucket().entries()) {
        if (!k.startsWith(`${t}::`)) continue;
        if (filter && typeof filter === 'object') {
          let ok = true;
          for (const [fk, fv] of Object.entries(filter as Record<string, unknown>)) {
            if (row[fk] !== fv) { ok = false; break; }
          }
          if (!ok) continue;
        }
        allMatching.push(row);
      }
      allMatching.sort((a, b) => a.id.localeCompare(b.id));
      const rows: TableRow[] = [];
      for (const row of allMatching) {
        if (afterId && row.id <= afterId) continue;
        rows.push(row);
        if (rows.length >= lim) break;
      }
      const last = rows[rows.length - 1];
      // `nextCursor` is null when we've reached the end of the result set;
      // otherwise it encodes the last-returned id for resumption.
      const consumedThroughId = last ? last.id : afterId;
      const hasMore = allMatching.some((r) => r.id > consumedThroughId);
      const nextCursor = hasMore && last ? Buffer.from(last.id, 'utf8').toString('base64') : null;
      return { rows, count: rows.length, nextCursor };
    },
    async count({ table }) {
      const t = String(table);
      let n = 0;
      for (const k of bucket().keys()) if (k.startsWith(`${t}::`)) n++;
      return { count: n };
    },
  };
}

function createCache(state: TenantMap<KvEntry>, scope: BundleScope): CacheSurface {
  // Cache shares the KV shape but is a separate namespace per tenant.
  const kv = createKv(state, scope);
  return {
    // Cache `get` wraps kv.get's `{value, found, ttlRemainingMs}`
    // shape into the canonical `{hit, value, ttlRemainingMs}` per
    // RFC 0019 §B point 2 — `hit` is the cache-semantic flag the
    // conformance suite gates on (a miss MUST surface `hit: false`,
    // not just an absent value).
    get: async (args) => {
      const out = await kv.get(args) as { value: unknown; found?: boolean; ttlRemainingMs?: number | null };
      return { hit: !!out.found, value: out.value, ttlRemainingMs: out.ttlRemainingMs ?? null, found: !!out.found };
    },
    put: async (args) => kv.set({ key: args.key, value: args.value, ttlSeconds: args.ttlSeconds ?? 60 }),
    evict: kv.delete,
  };
}

interface BlobEntry { contentBase64: string; contentType?: string; }
/** RFC 0019 §B point 1 — presigned URLs MUST expire at the advertised
 *  TTL. The token map below pairs each issued token with the resource
 *  + expiry; the HTTP route at `/v1/host/sample/blob/presigned/:token`
 *  (registered by `registerTestSeamRoutes`) resolves it, returning 200
 *  inside the window and 403 after. */
interface PresignToken { tenantId: string; key: string; contentBase64: string; contentType?: string; expiresAtMs: number; }
const _blobPresignTokens = new Map<string, PresignToken>();
export function resolvePresignToken(token: string, now: number = Date.now()):
  | { ok: true; entry: PresignToken }
  | { ok: false; reason: 'not_found' | 'expired' } {
  const entry = _blobPresignTokens.get(token);
  if (!entry) return { ok: false, reason: 'not_found' };
  if (entry.expiresAtMs <= now) return { ok: false, reason: 'expired' };
  return { ok: true, entry };
}
function createBlob(state: TenantMap<BlobEntry>, scope: BundleScope): BlobSurface {
  const bucket = () => state.bucket(scope.tenantId);
  return {
    async put({ key, contentBase64, contentType }) {
      bucket().set(String(key), { contentBase64: String(contentBase64), contentType: contentType as string | undefined });
      return { ok: true, key };
    },
    async get({ key }) {
      const e = bucket().get(String(key));
      if (!e) return { found: false };
      return { found: true, contentBase64: e.contentBase64, contentType: e.contentType };
    },
    async presign({ key, expiresInSeconds }) {
      const e = bucket().get(String(key));
      if (!e) return { found: false };
      const ttlSec = Number(expiresInSeconds) > 0 ? Number(expiresInSeconds) : 300;
      const expiresAtMs = Date.now() + ttlSec * 1000;
      const token = `pre-${scope.tenantId}-${String(key)}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      _blobPresignTokens.set(token, {
        tenantId: scope.tenantId,
        key: String(key),
        contentBase64: e.contentBase64,
        contentType: e.contentType,
        expiresAtMs,
      });
      const url = `/v1/host/sample/blob/presigned/${encodeURIComponent(token)}`;
      return { url, expiresAtMs, token, expiresInSeconds: ttlSec };
    },
  };
}

interface QueueEntry { id: string; payload: unknown; enqueuedAtMs: number; }
function createQueue(state: TenantMap<QueueEntry[]>, scope: BundleScope): QueueSurface {
  const bucket = (queueName: string) => {
    const t = state.bucket(scope.tenantId);
    let arr = t.get(queueName);
    if (!arr) { arr = []; t.set(queueName, arr); }
    return arr;
  };
  let seq = 0;
  return {
    async enqueue({ queue, payload }) {
      const id = `q-${++seq}`;
      bucket(String(queue)).push({ id, payload, enqueuedAtMs: Date.now() });
      return { id, enqueued: true };
    },
    async dequeue({ queue }) {
      const arr = bucket(String(queue));
      const e = arr.shift();
      if (!e) return { found: false };
      return { found: true, id: e.id, payload: e.payload };
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// SQL — better-sqlite3, one in-memory DB per tenant.
// ───────────────────────────────────────────────────────────────────

// Sample-grade injection heuristic. Flags template-literal interpolation
// (`${`) and the classic `OR '1'='1'` shape. A real parser belongs in the
// pack delegate when this is wired to a production SQL impl.
const PARAM_REJECT_RE = /\$\{|\b(?:OR|AND)\b\s+(?:'[^']*'|"[^"]*")\s*=\s*(?:'[^']*'|"[^"]*")/i;

function createSql(dbPool: Map<string, Database.Database>, scope: BundleScope): SqlSurface {
  const dbFor = () => {
    let db = dbPool.get(scope.tenantId);
    if (!db) {
      db = new Database(':memory:');
      dbPool.set(scope.tenantId, db);
    }
    return db;
  };
  /** RFC 0018 §"SQL injection invariant": only parametric queries.
   *  Heuristic: if the input contains template literals (`${`) or
   *  obvious string-concat shapes, refuse. Real hosts wire a real
   *  parser; this is sample-grade defense in depth. */
  const requireParametric = (sql: string) => {
    if (PARAM_REJECT_RE.test(sql)) {
      throw Object.assign(
        new Error('Non-parametric SQL rejected by host (RFC 0018).'),
        { code: 'SQL_NON_PARAMETRIC' },
      );
    }
  };
  return {
    async query(args: Record<string, unknown>) {
      const sqlStr = String(args.sql);
      requireParametric(sqlStr);
      const stmt = dbFor().prepare(sqlStr);
      const params = args.params;
      const rows = Array.isArray(params) ? stmt.all(...(params as unknown[])) : stmt.all();
      return { rows: rows as unknown[], count: (rows as unknown[]).length };
    },
    async execute(args: Record<string, unknown>) {
      const sqlStr = String(args.sql);
      requireParametric(sqlStr);
      const stmt = dbFor().prepare(sqlStr);
      const params = args.params;
      const info = Array.isArray(params) ? stmt.run(...(params as unknown[])) : stmt.run();
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    },
    async transaction({ statements }) {
      const db = dbFor();
      const txn = db.transaction((stmts: Array<{ sql: string; params?: unknown[] }>) => {
        for (const s of stmts) {
          requireParametric(s.sql);
          db.prepare(s.sql).run(...(s.params ?? []));
        }
      });
      txn((statements as Array<{ sql: string; params?: unknown[] }>) ?? []);
      return { ok: true };
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Vector — brute-force cosine over an in-memory Map.
// ───────────────────────────────────────────────────────────────────

interface VectorEntry { id: string; vector: number[]; metadata?: Record<string, unknown>; }
function createVector(state: TenantMap<Map<string, VectorEntry>>, scope: BundleScope): VectorSurface {
  const ns = (namespace: unknown) => {
    const t = state.bucket(scope.tenantId);
    const k = String(namespace ?? 'default');
    let m = t.get(k);
    if (!m) { m = new Map(); t.set(k, m); }
    return m;
  };
  return {
    async upsert({ namespace, items }) {
      const m = ns(namespace);
      const arr = items as VectorEntry[];
      for (const it of arr) m.set(it.id, it);
      return { upserted: arr.length };
    },
    async query({ namespace, vector, topK }) {
      const m = ns(namespace);
      const q = vector as number[];
      const results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = [];
      for (const e of m.values()) {
        const s = cosine(q, e.vector);
        results.push({ id: e.id, score: s, metadata: e.metadata });
      }
      results.sort((a, b) => b.score - a.score);
      const k = typeof topK === 'number' && topK > 0 ? topK : 10;
      return { matches: results.slice(0, k) };
    },
    async delete({ namespace, ids }) {
      const m = ns(namespace);
      let n = 0;
      for (const id of ids as string[]) {
        if (m.delete(id)) n++;
      }
      return { deleted: n };
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Search — naive token-frequency bag-of-words score.
// ───────────────────────────────────────────────────────────────────

interface SearchDoc { id: string; fields: Record<string, string | number | boolean>; }
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,.!?;:\-_/\\()[\]{}<>"']+/)
    .filter((t) => t.length > 0);
}
function createSearch(state: TenantMap<Map<string, SearchDoc>>, scope: BundleScope): SearchSurface {
  const idx = (indexName: unknown) => {
    const t = state.bucket(scope.tenantId);
    const k = String(indexName ?? 'default');
    let m = t.get(k);
    if (!m) { m = new Map(); t.set(k, m); }
    return m;
  };
  return {
    async index({ index, docs }) {
      const m = idx(index);
      const arr = docs as SearchDoc[];
      for (const d of arr) m.set(d.id, d);
      return { indexed: arr.length };
    },
    async query({ index, q, k }) {
      const m = idx(index);
      const queryTokens = tokenize(String(q ?? ''));
      if (queryTokens.length === 0) return { hits: [] };
      const hits: Array<{ id: string; score: number; fields: Record<string, unknown> }> = [];
      for (const d of m.values()) {
        // Concatenate all field values into one bag-of-tokens.
        const haystack = Object.values(d.fields)
          .map((v) => String(v))
          .join(' ');
        const docTokens = tokenize(haystack);
        if (docTokens.length === 0) continue;
        let score = 0;
        for (const qt of queryTokens) {
          // Naive TF: count occurrences in the doc.
          const tf = docTokens.filter((t) => t === qt).length;
          if (tf > 0) score += 1 + Math.log(1 + tf); // weight + diminishing returns
        }
        if (score > 0) hits.push({ id: d.id, score, fields: d.fields });
      }
      hits.sort((a, b) => b.score - a.score);
      const limit = typeof k === 'number' && k > 0 ? k : 10;
      return { hits: hits.slice(0, limit) };
    },
    async delete({ index, ids }) {
      const m = idx(index);
      let n = 0;
      for (const id of ids as string[]) if (m.delete(id)) n++;
      return { deleted: n };
    },
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const L = Math.min(a.length, b.length);
  for (let i = 0; i < L; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ───────────────────────────────────────────────────────────────────
// FS — sandboxed under <dataDir>/host-fs/<tenant>/
// ───────────────────────────────────────────────────────────────────

function createFs(rootDir: string, scope: BundleScope): FsSurface {
  const tenantRoot = join(rootDir, sanitizeSegment(scope.tenantId));
  mkdirSync(tenantRoot, { recursive: true });
  /** Resolve a user-supplied relative path INSIDE the tenant root.
   *  Reject anything that escapes the sandbox after normalization. */
  const safePath = (relRaw: unknown): string => {
    const rel = String(relRaw ?? '');
    // Absolute paths (POSIX `/foo` or Windows `C:\foo`) MUST be
    // rejected up-front per `SECURITY/invariants.yaml fs-path-
    // traversal` + RFC 0014 §C. Stripping the leading slash and
    // re-resolving against tenantRoot would silently REINTERPRET
    // an absolute path as relative, which loses the security
    // violation (a request for `/etc/passwd` would land at
    // `<tenantRoot>/etc/passwd` and ENOENT — that's a bug, not a
    // reject). Catch both POSIX absolute (`/`) and Windows drive
    // letters (`C:`) here.
    if (/^[/\\]/.test(rel) || /^[A-Za-z]:/.test(rel)) {
      throw Object.assign(new Error('Absolute paths escape the tenant sandbox.'), { code: 'path_outside_sandbox' });
    }
    const normalized = normalize(rel).replace(/^[/\\]+/, '');
    const abs = resolve(tenantRoot, normalized);
    if (!abs.startsWith(tenantRoot + sep) && abs !== tenantRoot) {
      // Canonical per RFC 0014 §B + SECURITY/invariants.yaml fs-path-traversal.
      throw Object.assign(new Error('Path escapes tenant sandbox.'), { code: 'path_outside_sandbox' });
    }
    return abs;
  };
  return {
    async read({ path }) {
      const abs = safePath(path);
      const buf = readFileSync(abs);
      return { contentBase64: buf.toString('base64'), size: buf.byteLength };
    },
    async write({ path, contentBase64, createOnly }) {
      const abs = safePath(path);
      if (createOnly && existsSync(abs)) {
        return { ok: false, reason: 'already_exists' };
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(String(contentBase64 ?? ''), 'base64'));
      return { ok: true, path: String(path) };
    },
    async delete({ path }) {
      const abs = safePath(path);
      if (!existsSync(abs)) return { deleted: false };
      rmSync(abs, { recursive: true, force: true });
      return { deleted: true };
    },
    async stat({ path }) {
      const abs = safePath(path);
      if (!existsSync(abs)) return { found: false };
      const s = statSync(abs);
      return { found: true, size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs };
    },
    async list({ path }) {
      const abs = safePath(path ?? '.');
      if (!existsSync(abs)) return { entries: [] };
      const entries = readdirSync(abs, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isFile: e.isFile(),
        isDirectory: e.isDirectory(),
      }));
      return { entries };
    },
  };
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}

// ───────────────────────────────────────────────────────────────────
// queueBus + observability
// ───────────────────────────────────────────────────────────────────

interface BusMessage { id: string; payload: unknown; subject: string; deliveryCount: number; }
/** RFC 0017 ack/nack/dlq state machine: messages move from the per-
 *  subject queue → in-flight map on `consume`. `ack` drops the entry;
 *  `nack(requeue=true)` puts it back at the head of the subject queue;
 *  `deadLetter` appends it to a per-tenant `<subject>.dlq` subject. */
const _busInFlight = new Map<string /* tenantId */, Map<string /* deliveryToken */, BusMessage>>();
function createQueueBus(state: TenantMap<BusMessage[]>, scope: BundleScope): QueueBusSurface {
  const subj = (subject: unknown) => {
    const t = state.bucket(scope.tenantId);
    const k = String(subject ?? 'default');
    let arr = t.get(k);
    if (!arr) { arr = []; t.set(k, arr); }
    return arr;
  };
  const inflightForTenant = () => {
    let m = _busInFlight.get(scope.tenantId);
    if (!m) { m = new Map(); _busInFlight.set(scope.tenantId, m); }
    return m;
  };
  let seq = 0;
  return {
    async publish({ subject, payload }) {
      const id = `m-${++seq}`;
      subj(subject).push({ id, payload, subject: String(subject), deliveryCount: 1 });
      return { id, published: true };
    },
    async consume({ subject }) {
      const arr = subj(subject);
      const msg = arr.shift();
      if (!msg) return { found: false };
      const deliveryToken = `dt-${++seq}`;
      inflightForTenant().set(deliveryToken, msg);
      return {
        found: true,
        deliveryToken,
        id: msg.id,
        subject: msg.subject,
        payload: msg.payload,
        deliveryCount: msg.deliveryCount,
      };
    },
    async ack({ deliveryToken }) {
      const m = inflightForTenant();
      const existed = m.delete(String(deliveryToken));
      return { acked: existed, deliveryToken };
    },
    async nack({ deliveryToken, requeue }) {
      const m = inflightForTenant();
      const key = String(deliveryToken);
      const msg = m.get(key);
      if (!msg) return { nacked: false, reason: 'unknown_delivery_token' };
      m.delete(key);
      if (requeue === false) {
        return { nacked: true, requeued: false };
      }
      const arr = subj(msg.subject);
      arr.unshift({ ...msg, deliveryCount: msg.deliveryCount + 1 });
      return { nacked: true, requeued: true };
    },
    async deadLetter({ deliveryToken, reason }) {
      const m = inflightForTenant();
      const key = String(deliveryToken);
      const msg = m.get(key);
      if (!msg) return { deadLettered: false, reason: 'unknown_delivery_token' };
      m.delete(key);
      const dlqSubject = `${msg.subject}.dlq`;
      subj(dlqSubject).push({ ...msg, payload: { original: msg.payload, deadLetterReason: String(reason ?? 'unspecified') } });
      return { deadLettered: true, dlqSubject };
    },
    async streamPublish({ stream, record }) {
      const id = `r-${++seq}`;
      subj(stream).push({ id, payload: record, subject: String(stream), deliveryCount: 1 });
      return { id, published: true };
    },
    async streamSubscribe({ stream, fromBeginning }) {
      if (fromBeginning !== true) {
        return { records: [], fromBeginningSnapshot: false };
      }
      // Return the full snapshot of records currently on the stream.
      const records = subj(stream).map((m) => ({ id: m.id, payload: m.payload }));
      return { records, fromBeginningSnapshot: true, count: records.length };
    },
  };
}

function createObservability(scope: BundleScope): ObservabilitySurface {
  return {
    async log({ level, message, attributes }) {
      const lvl = String(level || 'info');
      const msg = String(message ?? '');
      const attrs = (attributes as Record<string, unknown>) ?? {};
      const payload = { tenantId: scope.tenantId, ...attrs };
      if (lvl === 'error') log.error(msg, payload);
      else if (lvl === 'warn') log.warn(msg, payload);
      else if (lvl === 'debug') log.debug(msg, payload);
      else log.info(msg, payload);
      return { logged: true };
    },
    async metric({ kind, name, value, attributes, unit }) {
      // In-memory demo: just log. Real impl wires OTel meters.
      log.debug('metric', { kind, name, value, unit, attributes, tenantId: scope.tenantId });
      return { recorded: true };
    },
    async startSpan({ name, attributes }) {
      const handle = `span-${Math.random().toString(36).slice(2, 10)}`;
      log.debug('span.start', { name, handle, attributes });
      return { spanHandle: handle };
    },
    async endSpan({ spanHandle, status, attributes }) {
      log.debug('span.end', { spanHandle, status, attributes });
      return { ok: true };
    },
    async alert(event) {
      log.warn('alert.fired', { ...event, tenantId: scope.tenantId });
      return { fired: true };
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Singleton state — created once per process, scope-bound per call.
// ───────────────────────────────────────────────────────────────────

const _kvState = new TenantMap<KvEntry>();
const _tableState = new TenantMap<TableRow>();
const _cacheState = new TenantMap<KvEntry>();
const _blobState = new TenantMap<BlobEntry>();
const _queueState = new TenantMap<QueueEntry[]>();
const _busState = new TenantMap<BusMessage[]>();
const _vectorState = new TenantMap<Map<string, VectorEntry>>();
const _searchState = new TenantMap<Map<string, SearchDoc>>();
const _sqlPool = new Map<string, Database.Database>();
// RFC 0004 memory: tenant → memoryRef → entries. Host-internal write side
// (run-summary on completion); read side exposed via GET /v1/host/sample/memory.
const _memoryState = new TenantMap<MemoryRow[]>();

let _fsRoot: string | null = null;
let _initialized = false;

/** RFC 0014 §A — exposed for /.well-known/openwop discovery so the
 *  spec-canonical `capabilities.fs.sandboxRoot` matches the in-memory
 *  surface's actual root. Returns null before initInMemorySurfaces() runs. */
export function getFsSandboxRoot(): string | null {
  return _fsRoot;
}

/** Initialize the surfaces module + advertise each surface. Idempotent. */
export function initInMemorySurfaces(deps: { dataDir: string }): void {
  if (_initialized) return;
  _fsRoot = join(deps.dataDir, 'host-fs');
  mkdirSync(_fsRoot, { recursive: true });

  // Flip each surface to supported=true in the advertisement.
  const inmem = 'in-memory';
  registerHostSurface({ name: 'host.kvStorage', supported: true, implementation: inmem, note: 'Demo only. Restarts wipe state.' });
  registerHostSurface({ name: 'host.tableStorage', supported: true, implementation: inmem, note: 'Demo only. No indexes; query is O(n).' });
  registerHostSurface({ name: 'host.cache', supported: true, implementation: inmem });
  registerHostSurface({ name: 'host.blobStorage', supported: true, implementation: inmem, note: 'presign() returns a synthetic data: URL.' });
  registerHostSurface({ name: 'host.queue', supported: true, implementation: inmem });
  registerHostSurface({ name: 'host.fs', supported: true, implementation: 'sandboxed-local-fs', note: `Sandboxed under ${_fsRoot}.` });
  registerHostSurface({ name: 'host.db.sql', supported: true, implementation: 'sqlite-in-memory', note: 'better-sqlite3, one in-memory DB per tenant.' });
  registerHostSurface({ name: 'host.db.vector', supported: true, implementation: 'brute-force-cosine', note: 'O(n) cosine over an in-memory Map.' });
  registerHostSurface({ name: 'host.db.search', supported: true, implementation: 'naive-bag-of-words', note: 'Token-frequency relevance score. Real impls use Elasticsearch / OpenSearch / Meilisearch / Typesense.' });
  registerHostSurface({ name: 'host.messaging', supported: true, implementation: inmem });
  registerHostSurface({ name: 'host.observability', supported: true, implementation: 'structured-logger', note: 'Routes through the workflow-engine logger.' });
  registerHostSurface({ name: 'host.memory', supported: true, implementation: inmem, note: 'Demo only. RFC 0004 read-side (list/get); host writes a run-summary on completion. Restarts wipe state.' });

  _initialized = true;
}

// ───────────────────────────────────────────────────────────────────
// RFC 0004 memory (host-internal write side + read side)
//
// The wire contract (agent-memory.md) is read-only: `list(memoryRef,
// options)` + `get(memoryRef, memoryId)`. Writes are host-internal — for
// the demo the host writes a run-summary entry on completion (the
// "session-end write" the spec sanctions). Tenant-scoped per CTI-1;
// content is plain (no BYOK secrets flow through summaries, so SR-1 holds
// trivially here).
// ───────────────────────────────────────────────────────────────────

/** One stored memory entry (matches schemas/memory-entry.schema.json). */
export interface MemoryRow {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  /** RFC 0004 TTL — entries past this MUST NOT surface in list/get. */
  expiresAt?: string;
}

export interface MemoryListOpts {
  limit?: number;
  tag?: string;
}

/** The demo's single per-tenant memoryRef. Real hosts derive memoryRefs
 *  from agent manifests (RFC 0004 §C); the sample uses one shared ref so
 *  the ledger shows a tenant's accumulating run history. */
export const MEMORY_DEMO_REF = 'tenant-memory';

const MEMORY_HARD_MAX = 500;

function memoryBucket(tenantId: string): Map<string, MemoryRow[]> {
  return _memoryState.bucket(tenantId);
}

function notExpired(row: MemoryRow, nowMs: number): boolean {
  if (!row.expiresAt) return true;
  const t = Date.parse(row.expiresAt);
  return !Number.isFinite(t) || t > nowMs;
}

/** Host-internal write. Appends a tenant-scoped entry under `memoryRef`. */
export function writeMemoryEntry(
  tenantId: string,
  memoryRef: string,
  input: { content: string; tags?: string[]; ttlSeconds?: number },
): MemoryRow {
  if (!_initialized) throw new Error('initInMemorySurfaces() must be called first');
  const now = Date.now();
  const row: MemoryRow = {
    id: `mem_${randomUUID().slice(0, 12)}`,
    content: input.content,
    tags: input.tags ?? [],
    createdAt: new Date(now).toISOString(),
    ...(typeof input.ttlSeconds === 'number' && input.ttlSeconds > 0
      ? { expiresAt: new Date(now + input.ttlSeconds * 1000).toISOString() }
      : {}),
  };
  const bucket = memoryBucket(tenantId);
  const entries = bucket.get(memoryRef) ?? [];
  entries.push(row);
  bucket.set(memoryRef, entries);
  return row;
}

/** RFC 0004 read side. Tenant-scoped; TTL-filtered; newest first. */
export function listMemoryEntries(
  tenantId: string,
  memoryRef: string,
  opts: MemoryListOpts = {},
): MemoryRow[] {
  const now = Date.now();
  const all = (memoryBucket(tenantId).get(memoryRef) ?? []).filter((r) => notExpired(r, now));
  const tagged = opts.tag ? all.filter((r) => r.tags.includes(opts.tag!)) : all;
  const sorted = [...tagged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = Math.min(opts.limit ?? MEMORY_HARD_MAX, MEMORY_HARD_MAX);
  return sorted.slice(0, limit);
}

/** RFC 0004 read side. Single tenant-scoped entry, or null when absent/expired. */
export function getMemoryEntry(tenantId: string, memoryRef: string, memoryId: string): MemoryRow | null {
  const now = Date.now();
  const row = (memoryBucket(tenantId).get(memoryRef) ?? []).find((r) => r.id === memoryId);
  return row && notExpired(row, now) ? row : null;
}

/**
 * Host-internal delete. Removes a tenant-scoped entry under `memoryRef`.
 * Returns true when an entry was removed, false when none matched.
 *
 * Tenant-scoped exactly like the read side — the caller passes the
 * principal-derived `tenantId`, never a query value, so a delete can never
 * cross a tenant boundary (CTI-1). Demo-only convenience for the CLI/inspector;
 * the agent-memory wire contract keeps writes/deletes host-internal.
 */
export function removeMemoryEntry(tenantId: string, memoryRef: string, memoryId: string): boolean {
  const bucket = memoryBucket(tenantId);
  const entries = bucket.get(memoryRef);
  if (!entries) return false;
  const idx = entries.findIndex((r) => r.id === memoryId);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  bucket.set(memoryRef, entries);
  return true;
}

// ───────────────────────────────────────────────────────────────────
// RFC 0012 memory compaction (host-managed + client-requested)
//
// Compaction collapses many short-lived `longTerm` entries into one
// distilled entry. Derived content is routed through the BYOK redaction
// harness (`redactForCompaction`) so SR-1 carry-forward holds — a distilled
// archive MUST NOT re-expose a source-side leak (RFC 0012 §D). The distilled
// entry carries a `compacted-from:<id>` provenance tag (§C). These helpers
// back the `/v1/test/memory/{seed,compact}` conformance seam.
// ───────────────────────────────────────────────────────────────────

/** Host-internal write with a caller-supplied id (compaction seed seam). */
export function seedMemoryEntry(
  tenantId: string,
  memoryRef: string,
  input: { id: string; content: string; tags?: string[] },
): MemoryRow {
  if (!_initialized) throw new Error('initInMemorySurfaces() must be called first');
  const row: MemoryRow = {
    id: input.id,
    content: input.content,
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
  };
  const bucket = memoryBucket(tenantId);
  const entries = bucket.get(memoryRef) ?? [];
  entries.push(row);
  bucket.set(memoryRef, entries);
  return row;
}

export interface CompactionResult {
  /** Id of the distilled entry. */
  outputId: string;
  /** Number of source entries collapsed. */
  sourceCount: number;
  /** Exhaustive source ids (RFC 0012 §B: omit upstream when > 100). */
  sourceIds: string[];
  /** UTF-8 byte size of the distilled content. */
  byteSize: number;
  /** The persisted distilled content, SR-1-redacted (non-wire; for the
   *  seam's §D verification — the wire `memory.compacted` event omits it). */
  outputContent: string;
}

/**
 * Collapse every live entry under `(tenantId, memoryRef)` into a single
 * SR-1-redacted distilled entry, replacing the sources. Returns null when
 * there is nothing to compact.
 */
export function compactMemory(tenantId: string, memoryRef: string): CompactionResult | null {
  if (!_initialized) throw new Error('initInMemorySurfaces() must be called first');
  const bucket = memoryBucket(tenantId);
  const now = Date.now();
  const sources = (bucket.get(memoryRef) ?? []).filter((r) => notExpired(r, now));
  if (sources.length === 0) return null;

  const sourceIds = sources.map((r) => r.id);
  // §D: redact derived content through the BYOK harness — never echo a
  // source-side leak, never silently strip it.
  const outputContent = redactForCompaction(sources.map((r) => r.content).join('\n'));
  const compactionId = `cmp_${randomUUID().slice(0, 12)}`;
  const outputId = `mem_${randomUUID().slice(0, 12)}`;
  const archive: MemoryRow = {
    id: outputId,
    content: outputContent,
    // §C provenance tag — lets consumers detect compacted entries without
    // the event stream. Shape: `compacted-from:<id>` (no whitespace).
    tags: [`compacted-from:${compactionId}`, 'compacted'],
    createdAt: new Date(now).toISOString(),
  };
  bucket.set(memoryRef, [archive]);
  return {
    outputId,
    sourceCount: sourceIds.length,
    sourceIds,
    byteSize: Buffer.byteLength(outputContent, 'utf8'),
    outputContent,
  };
}

// ───────────────────────────────────────────────────────────────────
// RFC 0055 §C media assets — tenant-scoped, non-guessable asset URLs
//
// An emitted `media.{image,audio,file}` envelope references its asset by a
// host-served URL (above the inline cap). We mint a capability token the
// interrupt way (32 random bytes, base64url — opaque, not guessable) and
// key the store by token; the entry carries its own tenantId so a token
// minted for tenant A never resolves to tenant B's bytes (the
// `media-asset-url-tenant-scoped` SECURITY invariant).
//
// Durable + read-through (the same hardening PR #395 applied to the other
// host-extension stores, now extended here): each asset is one row in the
// generic `host_ext_kv` table keyed `hostext:media:asset:<token>`, so a URL
// minted on one Cloud Run instance resolves on every instance, survives a
// restart, and — critically — survives a `POST /v1/runs/{runId}:fork` replay
// of a chat turn that referenced the asset by URL (see replay.md). Inline
// `dataBase64` attachments are replay-safe by construction (they live in
// `run.inputs`, copied verbatim on fork); URL-referenced attachments are
// replay-safe only because this store is now durable with a retention window
// (≥ run lifetime) that outlives the run.
// ───────────────────────────────────────────────────────────────────

interface MediaAssetEntry {
  /** The capability token — also the durable row id (`idOf`). */
  token: string;
  tenantId: string;
  contentBase64: string;
  contentType: string;
  /** Decoded asset size in bytes. */
  bytes: number;
  expiresAtMs: number;
}

/** token → entry, one durable row per asset (read-through, multi-instance
 *  correct). Tokens are globally unique + carry their own tenantId. */
const _mediaAssets = new DurableCollection<MediaAssetEntry>('media:asset', (e) => e.token);
/** LLM-emitted media (RFC 0055) is ephemeral — a short TTL keeps the store
 *  small. User-uploaded chat attachments override this with a longer TTL
 *  (see UPLOADED_ASSET_TTL_MS in routes/mediaAssets.ts) so a fork/replay of
 *  the turn within a reasonable window can still re-resolve the URL. */
const MEDIA_ASSET_DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

// Unlike the old in-memory Map (which every restart cleared), the durable
// store keeps expired rows until something touches them — `resolveMediaAsset`
// only deletes lazily on access, so an asset never re-fetched after its TTL
// would linger forever in the shared host_ext_kv table. Reclaim them with a
// throttled background sweep kicked off on store (idempotent across instances;
// each prunes independently). Demo-grade — a production host would expire at
// the storage layer (TTL column / object-store lifecycle rule).
const MEDIA_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // at most once / 10 min / process
let _lastMediaSweepMs = 0;

async function sweepExpiredMediaAssets(): Promise<void> {
  const now = Date.now();
  const all = await _mediaAssets.list();
  for (const e of all) {
    if (e.expiresAtMs <= now) await _mediaAssets.delete(e.token);
  }
}

function maybeSweepExpiredMediaAssets(): void {
  const now = Date.now();
  if (now - _lastMediaSweepMs < MEDIA_SWEEP_INTERVAL_MS) return;
  _lastMediaSweepMs = now;
  // Fire-and-forget: never let GC bookkeeping delay or fail a store.
  void sweepExpiredMediaAssets().catch((err) => {
    log.warn('media-asset sweep failed', { error: err instanceof Error ? err.message : String(err) });
  });
}

/** Store an asset for `tenantId` and mint a tenant-scoped capability URL.
 *  Returns the relative serve URL + decoded byte size + expiry. */
export async function storeMediaAsset(
  tenantId: string,
  input: { contentBase64: string; contentType: string; ttlSeconds?: number },
): Promise<{ token: string; url: string; bytes: number; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const bytes = Buffer.byteLength(input.contentBase64, 'base64');
  const ttlMs =
    typeof input.ttlSeconds === 'number' && input.ttlSeconds > 0
      ? input.ttlSeconds * 1000
      : MEDIA_ASSET_DEFAULT_TTL_MS;
  const expiresAtMs = Date.now() + ttlMs;
  await _mediaAssets.put({ token, tenantId, contentBase64: input.contentBase64, contentType: input.contentType, bytes, expiresAtMs });
  maybeSweepExpiredMediaAssets();
  return { token, url: `/v1/host/sample/assets/${token}`, bytes, expiresAt: new Date(expiresAtMs).toISOString() };
}

/** Resolve a media-asset token. Returns null when unknown or expired (the
 *  token IS the capability — a caller without it cannot reach the bytes).
 *  The returned entry carries its own `tenantId`; callers that resolve on
 *  behalf of a request MUST check it against `req.tenantId` to uphold the
 *  `media-asset-url-tenant-scoped` invariant (the token is unguessable, so a
 *  cross-tenant read requires already holding tenant A's token). */
export async function resolveMediaAsset(token: string): Promise<MediaAssetEntry | null> {
  const e = await _mediaAssets.get(token);
  if (!e) return null;
  if (e.expiresAtMs <= Date.now()) {
    await _mediaAssets.delete(token);
    return null;
  }
  return e;
}

/** Build a per-run scoped surface bundle. Inject into NodeContext at
 *  run kickoff. Each call gives the run a tenant-scoped view of the
 *  shared process-local state. */
export function buildHostSurfaceBundle(scope: BundleScope): HostSurfaceBundle {
  if (!_initialized) {
    throw new Error('initInMemorySurfaces() must be called before buildHostSurfaceBundle()');
  }
  const fsRoot = _fsRoot!;
  return {
    storage: {
      kv: createKv(_kvState, scope),
      table: createTable(_tableState, scope),
      cache: createCache(_cacheState, scope),
      blob: createBlob(_blobState, scope),
      queue: createQueue(_queueState, scope),
    },
    db: {
      sql: createSql(_sqlPool, scope),
      vector: createVector(_vectorState, scope),
      search: createSearch(_searchState, scope),
    },
    fs: createFs(fsRoot, scope),
    queueBus: createQueueBus(_busState, scope),
    observability: createObservability(scope),
  };
}
