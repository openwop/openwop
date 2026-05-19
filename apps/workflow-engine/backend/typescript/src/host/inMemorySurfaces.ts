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
import Database from 'better-sqlite3';
import { createLogger } from '../observability/logger.js';
import { registerHostSurface } from '../bootstrap/hostSurfaceRegistry.js';

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
    async cas({ key, expected, value }) {
      const b = bucket();
      const cur = fresh(b.get(String(key)))?.value ?? null;
      if (JSON.stringify(cur) !== JSON.stringify(expected ?? null)) {
        return { ok: false, currentValue: cur };
      }
      b.set(String(key), { value });
      return { ok: true, value };
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
    get: kv.get,
    put: async (args) => kv.set({ key: args.key, value: args.value, ttlSeconds: args.ttlSeconds ?? 60 }),
    evict: kv.delete,
  };
}

interface BlobEntry { contentBase64: string; contentType?: string; }
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
      // In-memory demo: presigned URL is a synthetic data: URL so the
      // workflow can complete. Real impls return an S3/GCS signed URL.
      const e = bucket().get(String(key));
      if (!e) return { found: false };
      const url = `data:${e.contentType ?? 'application/octet-stream'};base64,${e.contentBase64.slice(0, 64)}...`;
      return { url, expiresAtMs: Date.now() + (Number(expiresInSeconds) || 300) * 1000, _demoOnly: true };
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
const _sqlPool = new Map<string, Database.Database>();

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
  registerHostSurface({ name: 'host.messaging', supported: true, implementation: inmem });
  registerHostSurface({ name: 'host.observability', supported: true, implementation: 'structured-logger', note: 'Routes through the workflow-engine logger.' });

  _initialized = true;
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
    },
    fs: createFs(fsRoot, scope),
    queueBus: createQueueBus(_busState, scope),
    observability: createObservability(scope),
  };
}
