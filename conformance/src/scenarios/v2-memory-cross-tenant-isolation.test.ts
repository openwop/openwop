/**
 * `v2-memory-cross-tenant-isolation` (target major 2; gated on the `memory`
 * family and the `conformance-agent-memory-cross-tenant` fixture).
 *
 * `spec/v2/core/host-services.md` §`memory`, **Tenant isolation**: "A ref MUST
 * resolve to one tenant's entries, whatever the caller's permissions." No
 * protocol path serves memory — pack code reads it as `ctx.memory` — so the
 * observation surface is a run of the EXISTING fixture
 * `conformance-agent-memory-cross-tenant` (conformance/fixtures.md), whose node
 * writes one entry at the fixed `memoryRef` `conformance/agent-memory-cti` and
 * lands `ownerEntryId`, then lists that ref into `ownerProbe`. No seam, no new
 * fixture.
 *
 * The witness is two tenants running the SAME fixture, so both name the SAME
 * ref string. Tenant A (OPENWOP_API_KEY) runs it first; tenant B
 * (OPENWOP_TEST_TENANT_B_API_KEY) runs it second, and B's `ownerProbe` — a list
 * of that ref under B's identity, issued after A's write — MUST hold none of
 * A's entries. A host that resolves the ref without its tenant returns A's
 * entry to B here. The major-1 scenario (`agentMemoryCrossTenantIsolation`)
 * runs under one tenant and probes a ref nobody wrote, so it could not see that
 * defect; until this file no major-2 scenario cited §`memory` at all
 * (docs/V2-WITNESS-COVERAGE.md risk #2).
 *
 * Not witnessed here: the malformed-ref half (traversal, NUL, oversize ⇒ `[]` /
 * `null`). The fixture's refs are fixed strings, and a new ref-taking fixture
 * would be a new host obligation with no implementer to prove it against.
 *
 * Dispositions: family not advertised, or advertised without the fixture ⇒
 * `inapplicable` (the host has not claimed the fixture). Fixture advertised but
 * the second-tenant key is absent / identical, a run cannot be created, or the
 * fixture's own positive control (a non-empty `ownerProbe` holding
 * `ownerEntryId`) is absent ⇒ `blocked`: the host took the obligation on and
 * the suite could not measure it.
 */
import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/host-services.md §memory';
const FIXTURE = 'conformance-agent-memory-cross-tenant';
const ID = 'openwop.requirement.0004.memory-ref-one-tenant';

interface Probe { runId: string; status: string; entryId: string | null; ownerIds: string[]; ownerProbe: unknown; crossTenantProbe: unknown }

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

function idsOf(list: unknown): string[] {
  return Array.isArray(list) ? list.map((e) => (e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined)).filter((x): x is string => typeof x === 'string') : [];
}

/** One settled run of the fixture as the given caller, with the variables the fixture lands. */
async function runFixture(as: Record<string, unknown>, who: string): Promise<Probe | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs: {} }, as));
  const runId = (res?.json as { runId?: unknown } | undefined)?.runId;
  if (res === null || res.status !== 201 || typeof runId !== 'string') return { reason: `${who}: POST /runs {${FIXTURE}} answered ${res?.status ?? 'nothing'}` };
  const deadline = Date.now() + scaledTimeoutMs(15_000);
  while (Date.now() < deadline) {
    const s = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`, as));
    const snap = s?.json as { status?: unknown; variables?: Record<string, unknown> } | undefined;
    const status = String(snap?.status ?? '');
    if (s?.status === 200 && ['completed', 'failed', 'cancelled'].includes(status)) {
      const v = snap?.variables ?? {};
      return { runId, status, entryId: typeof v['ownerEntryId'] === 'string' ? v['ownerEntryId'] : null, ownerIds: idsOf(v['ownerProbe']), ownerProbe: v['ownerProbe'], crossTenantProbe: v['crossTenantProbe'] };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { reason: `${who}: the ${FIXTURE} run ${runId} did not settle within 15 s` };
}

/**
 * The fixture's own positive control: its owner list holds the entry it wrote.
 * `failed` is allowed — the catalog lets a host fail the run at the fixture's
 * third step (the probe of a foreign ref), after the owner write and list.
 */
function controlled(p: Probe): boolean {
  return ['completed', 'failed'].includes(p.status) && p.entryId !== null && p.ownerIds.includes(p.entryId);
}

describe('v2 memory: a ref resolves to one tenant\'s entries (host-services.md §memory)', () => {
  it('a second tenant listing the same memoryRef sees none of the first tenant\'s entries', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if (!(await gateFamily('memory'))) return softSkip('inapplicable', 'memory family not advertised (gate recorded under openwop.family.memory)');
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `fixture ${FIXTURE} is not advertised — memory has no protocol path, and the host does not claim the fixture that observes it`);
    const b = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (!b) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-tenant leg cannot run');
    if (b === loadEnv().apiKey) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant');
    const asB = { authenticated: false, headers: { Authorization: `Bearer ${b}` } };

    const a = await runFixture({}, 'tenant A');
    if ('reason' in a) return softSkip('blocked', a.reason);
    if (!controlled(a)) return softSkip('blocked', `tenant A's run ${a.runId} ended ${a.status} without the fixture's positive control (ownerProbe holding ownerEntryId ${String(a.entryId)}) — the adapter was not observably exercised`);
    const bRun = await runFixture(asB, 'tenant B');
    if ('reason' in bRun) return softSkip('blocked', bRun.reason);
    if (bRun.runId.includes('/') && a.runId.includes('/') && bRun.runId.split('/')[0] === a.runId.split('/')[0]) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY binds the same tenant as OPENWOP_API_KEY (the run ids share a tenant segment) — the leg needs a second tenant');
    if (!controlled(bRun)) return softSkip('blocked', `tenant B's run ${bRun.runId} ended ${bRun.status} without the fixture's positive control — the list B's run issued was not observed`);
    if (bRun.entryId === a.entryId) return softSkip('blocked', `both tenants' writes report entry id ${String(a.entryId)} — ids that repeat across tenants cannot tell A's entry from B's`);

    const leaked = a.ownerIds.filter((id) => bRun.ownerIds.includes(id));
    expect(leaked, req(ID, DOC, `a ref MUST resolve to one tenant's entries: tenant B's list of conformance/agent-memory-cti (run ${bRun.runId}) returned tenant A's entries`)).toEqual([]);
    expect(bRun.ownerIds, req(ID, DOC, `tenant B's list MUST NOT hold the entry tenant A just wrote (${String(a.entryId)})`)).not.toContain(a.entryId);
    for (const p of [a, bRun].filter((r) => r.status === 'completed')) {
      const x = p.crossTenantProbe;
      expect(x === null || (Array.isArray(x) && x.length === 0), req(ID, DOC, `the fixture's probe of a ref another tenant owns MUST be [] or null (run ${p.runId})`)).toBe(true);
    }
  });
});
