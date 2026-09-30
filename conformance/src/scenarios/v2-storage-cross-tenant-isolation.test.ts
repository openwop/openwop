/**
 * `spec/v2/core/storage.md` §Shared rules — host storage never reads across
 * tenants (target major 2; gated per storage family + the
 * `conformance-storage-probe` fixture + a second-tenant credential).
 *
 * The rule: "A read for one tenant MUST NOT return data another tenant wrote,
 * even under an identical key or name: `kvStorage` `get` and `list`,
 * `tableStorage` `get` and `query`, `vectorStore` and `searchIndex` `query`,
 * `blobStorage` and `cache` `get`" — and `sql` / `nosql` datasources are
 * scoped per tenant. Until this file it had a witness only at major 1 (the v1
 * `test/surface` seam, four families); `vectorStore`, `searchIndex`, `sql` and
 * `nosql` had none at any major.
 *
 * No seam. Each leg drives the ordinary run surface with the
 * `conformance-storage-probe` fixture (conformance/fixtures.md §"The storage
 * probe fixtures"), whose node calls the host's own storage service for the
 * run's tenant, under two credentials that bind two different tenants:
 *
 *   1. tenant A (`OPENWOP_API_KEY`) writes a fresh value V at a fresh key K;
 *   2. tenant A reads K — V MUST come back (the positive control: without it a
 *      host that ignores the probe passes every leg vacuously);
 *   3. tenant B (`OPENWOP_TEST_TENANT_B_API_KEY`) reads K, handing it A's
 *      `ref` (row / document id) too — B's run MUST NOT return V or K. A refusal
 *      (`forbidden` / `not_found`, storage.md's refusal codes) is also correct;
 *   4. tenant A deletes K (best-effort cleanup, asserted nothing).
 *
 * One `it` and one requirement id per family, so a failure names its family.
 *
 * Dispositions: family not in the v2 root ⇒ `inapplicable` before anything
 * runs. Family advertised but the probe fixture not advertised, no second
 * credential, a second credential that binds the SAME tenant, or a fixture run
 * that cannot be created ⇒ `blocked` (an advertised isolation claim this run
 * could not observe; RFC 0148 §A, the 2.45.1 rule for a withheld fixture).
 *
 * Sabotage (run against a patched local copy of the v2 reference host that
 * serves these families in memory): key each store by name only — dropping the
 * tenant — and every family's leg fails on step 3; a probe that ignores
 * `write` fails step 2.
 *
 * @see spec/v2/core/storage.md §Shared rules
 * @see conformance/fixtures.md §"The storage probe fixtures (storage.md)"
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-storage-probe';
const NODE_ID = 'storage-probe';
const DOC = 'spec/v2/core/storage.md §Shared rules';
const ID_KV = 'openwop.requirement.storage.cross-tenant-kv-storage';
const ID_TABLE = 'openwop.requirement.storage.cross-tenant-table-storage';
const ID_BLOB = 'openwop.requirement.storage.cross-tenant-blob-storage';
const ID_CACHE = 'openwop.requirement.storage.cross-tenant-cache';
const ID_VECTOR = 'openwop.requirement.storage.cross-tenant-vector-store';
const ID_SEARCH = 'openwop.requirement.storage.cross-tenant-search-index';
const ID_SQL = 'openwop.requirement.storage.cross-tenant-sql';
const ID_NOSQL = 'openwop.requirement.storage.cross-tenant-nosql';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
/** storage.md: "A refused call carries `not_found`, `forbidden`, `validation_error`, or `storage_limit_exceeded`". */
const REFUSALS = new Set(['not_found', 'forbidden', 'validation_error', 'storage_limit_exceeded']);

type Family = 'kvStorage' | 'tableStorage' | 'blobStorage' | 'cache' | 'vectorStore' | 'searchIndex' | 'sql' | 'nosql';
type As = { authenticated?: boolean; headers?: Record<string, string> };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
const tenantOf = (runId: string): string => runId.slice(0, Math.max(0, runId.indexOf('/')));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

interface Probe {
  readonly runId: string;
  readonly status: string;
  readonly result: Record<string, unknown> | null;
  readonly errorCode: string | null;
}

/** Run the probe fixture with `inputs` as the caller `as` names, and read the node's terminal event. */
async function probe(inputs: Record<string, unknown>, as: As = {}): Promise<Probe | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs }, as));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | null)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${FIXTURE}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the fixture run was refused`.trim() };
  const t0 = Date.now(); let status = '';
  while (Date.now() - t0 < 30_000) {
    const snap = await http(() => driver.get(`/runs/${enc(runId)}`, as));
    status = String((snap?.json as { status?: unknown } | null)?.status ?? '');
    if (TERMINAL.has(status)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!TERMINAL.has(status)) return { reason: `the ${FIXTURE} run did not reach a terminal status within 30 s (last: ${status || 'unreadable'})` };
  const ev = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`, as));
  const events = (ev?.json as { events?: unknown } | null)?.events;
  if (ev?.status !== 200 || !Array.isArray(events)) return { reason: `GET /runs/{runId}/events/poll answered ${ev?.status ?? 'nothing'}` };
  const node = (type: string): Record<string, unknown> | undefined => (events as Array<{ type?: unknown; payload?: Record<string, unknown> }>).find((e) => e.type === type && e.payload?.['nodeId'] === NODE_ID)?.payload;
  const outputs = (node('node.completed')?.['outputs'] ?? {}) as Record<string, unknown>;
  const result = outputs['result'];
  const error = (node('node.failed')?.['error'] ?? null) as { code?: unknown } | null;
  return { runId, status, result: result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : null, errorCode: typeof error?.code === 'string' ? error.code : null };
}

interface Observed {
  readonly value: string;
  readonly key: string;
  /** Tenant A's own read of K: the values it returned. */
  readonly control: Probe;
  /** Tenant B's read of the same K (and A's ref). */
  readonly other: Probe;
}

/**
 * Steps 1–4 for one family, or the recorded reason the leg cannot run. Every
 * soft-skip decision is made here, before the calling `it` asserts anything.
 */
async function isolationLeg(family: Family): Promise<Observed | { skip: ['inapplicable' | 'blocked', string] }> {
  if (!(await v2Discovery().catch(() => null))) return { skip: ['blocked', 'v2 discovery unreachable'] };
  if (!(await familyAdvertised(family))) return { skip: ['inapplicable', `${family} is not advertised in the v2 discovery root — the host exposes no ${family} to pack code`] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['blocked', `the host advertises ${family} but not the ${FIXTURE} fixture — the tenant-isolation claim is made and cannot be observed without it`] };
  const otherKey = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
  if (!otherKey) return { skip: ['blocked', `OPENWOP_TEST_TENANT_B_API_KEY is not set — ${family} tenant isolation needs a caller bound to a second tenant`] };
  const asB: As = { authenticated: false, headers: { Authorization: `Bearer ${otherKey}` } };

  const nonce = randomUUID().replace(/-/g, '');
  const key = `openwop-conformance-xtenant-${nonce.slice(0, 16)}`;
  const value = `openwop-conformance-secret-${nonce}`;
  const wrote = await probe({ family, action: 'write', key, value });
  if ('reason' in wrote) return { skip: ['blocked', `tenant A's ${family} write: ${wrote.reason}`] };
  const ref = typeof wrote.result?.['ref'] === 'string' ? wrote.result['ref'] : undefined;
  const readInputs = { family, action: 'read', key, ...(family === 'searchIndex' ? { value } : {}), ...(ref === undefined ? {} : { ref }) };
  const control = await probe(readInputs);
  if ('reason' in control) return { skip: ['blocked', `tenant A's ${family} read: ${control.reason}`] };
  const other = await probe(readInputs, asB);
  if ('reason' in other) return { skip: ['blocked', `tenant B could not run the ${FIXTURE} fixture: ${other.reason}`] };
  if (tenantOf(other.runId) === tenantOf(control.runId)) return { skip: ['blocked', 'OPENWOP_TEST_TENANT_B_API_KEY binds the same tenant as OPENWOP_API_KEY — the leg needs a second tenant'] };
  await probe({ family, action: 'delete', key, ...(ref === undefined ? {} : { ref }) });
  return { value, key, control, other };
}

const leakedValues = (o: Observed): string[] => strings(o.other.result?.['values']).filter((v) => v.includes(o.value));
const leakedKeys = (o: Observed): string[] => strings(o.other.result?.['keys']).filter((k) => k === o.key);
/** A refused read is a correct answer too; anything else must have completed. */
const otherOutcome = (o: Observed): string => (o.other.status === 'completed' ? 'completed' : REFUSALS.has(o.other.errorCode ?? '') ? 'refused' : `${o.other.status} ${o.other.errorCode ?? '(no node.failed code)'}`);

describe('v2 storage cross-tenant isolation (storage.md §Shared rules)', () => {
  it('kvStorage: a read for tenant B never returns what tenant A wrote under the same key (get and list)', async () => {
    const o = await isolationLeg('kvStorage'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_KV, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own read MUST return the value it wrote (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_KV, DOC, "tenant B's read MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_KV, DOC, "a kvStorage get for tenant B MUST NOT return data tenant A wrote under an identical key")).toEqual([]);
    expect(leakedKeys(o), req(ID_KV, DOC, "a kvStorage list for tenant B MUST NOT return a key tenant A wrote")).toEqual([]);
  }, 150_000);

  it('tableStorage: a read for tenant B never returns what tenant A wrote in the same table (get and query)', async () => {
    const o = await isolationLeg('tableStorage'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_TABLE, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own read MUST return the value it wrote (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_TABLE, DOC, "tenant B's read MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_TABLE, DOC, "a tableStorage get or query for tenant B MUST NOT return a row tenant A wrote in the identically named table")).toEqual([]);
    expect(leakedKeys(o), req(ID_TABLE, DOC, "a tableStorage query for tenant B MUST NOT return a row tenant A wrote")).toEqual([]);
  }, 150_000);

  it('blobStorage: a read for tenant B never returns what tenant A wrote under the same bucket and key', async () => {
    const o = await isolationLeg('blobStorage'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_BLOB, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own read MUST return the object it wrote (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_BLOB, DOC, "tenant B's read MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_BLOB, DOC, "a blobStorage get for tenant B MUST NOT return an object tenant A wrote under an identical bucket and key")).toEqual([]);
    expect(leakedKeys(o), req(ID_BLOB, DOC, "a blobStorage list for tenant B MUST NOT return a key tenant A wrote")).toEqual([]);
  }, 150_000);

  it('cache: a get for tenant B never returns what tenant A put under the same key', async () => {
    const o = await isolationLeg('cache'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_CACHE, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own read MUST return the value it put (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_CACHE, DOC, "tenant B's read MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_CACHE, DOC, "a cache get for tenant B MUST NOT return data tenant A wrote under an identical key")).toEqual([]);
    expect(leakedKeys(o), req(ID_CACHE, DOC, "a cache read for tenant B MUST NOT return a key tenant A wrote")).toEqual([]);
  }, 150_000);

  it('vectorStore: a query for tenant B never matches a vector tenant A upserted in the same collection', async () => {
    const o = await isolationLeg('vectorStore'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_VECTOR, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own query MUST return the vector it upserted (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_VECTOR, DOC, "tenant B's query MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_VECTOR, DOC, "a vectorStore query for tenant B MUST NOT return metadata tenant A wrote in the identically named collection")).toEqual([]);
    expect(leakedKeys(o), req(ID_VECTOR, DOC, "a vectorStore query for tenant B MUST NOT return an id tenant A upserted")).toEqual([]);
  }, 150_000);

  it('searchIndex: a query for tenant B never hits a document tenant A indexed in the same index', async () => {
    const o = await isolationLeg('searchIndex'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_SEARCH, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own query MUST return the document it indexed (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_SEARCH, DOC, "tenant B's query MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_SEARCH, DOC, "a searchIndex query for tenant B MUST NOT return fields tenant A indexed in the identically named index")).toEqual([]);
    expect(leakedKeys(o), req(ID_SEARCH, DOC, "a searchIndex query for tenant B MUST NOT return an id tenant A indexed")).toEqual([]);
  }, 150_000);

  it('sql: tenant B reading the same-named datasource never sees a row tenant A inserted', async () => {
    const o = await isolationLeg('sql'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_SQL, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own query MUST return the row it inserted (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_SQL, DOC, "tenant B's query MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_SQL, DOC, "sql datasources are scoped per tenant: tenant B MUST NOT read a row tenant A inserted")).toEqual([]);
    expect(leakedKeys(o), req(ID_SQL, DOC, "sql datasources are scoped per tenant: tenant B MUST NOT see a key tenant A inserted")).toEqual([]);
  }, 150_000);

  it('nosql: tenant B reading the same-named datasource never sees a document tenant A inserted (get and query)', async () => {
    const o = await isolationLeg('nosql'); if ('skip' in o) return softSkip(...o.skip);
    expect(strings(o.control.result?.['values']), req(ID_NOSQL, 'conformance/fixtures.md §The storage probe fixtures', "tenant A's own query MUST return the document it inserted (positive control)")).toContain(o.value);
    expect(otherOutcome(o), req(ID_NOSQL, DOC, "tenant B's read MUST complete or be refused with a storage refusal code")).toMatch(/^(completed|refused)$/);
    expect(leakedValues(o), req(ID_NOSQL, DOC, "nosql datasources are scoped per tenant: tenant B MUST NOT read a document tenant A inserted, by query or by its id")).toEqual([]);
    expect(leakedKeys(o), req(ID_NOSQL, DOC, "nosql datasources are scoped per tenant: tenant B MUST NOT see a key tenant A inserted")).toEqual([]);
  }, 150_000);
});
