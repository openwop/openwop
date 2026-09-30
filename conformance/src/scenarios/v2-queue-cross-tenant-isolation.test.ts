/**
 * `spec/v2/core/host-services.md` §`queueBus` — "A tenant's consumer MUST NOT
 * receive another tenant's messages, even on the same topic." (target major 2;
 * gated on the `queueBus` family, the queue-probe fixture pair and a second
 * tenant's credential).
 *
 * Before this file the rule was witnessed at major 1 only
 * (`queue-cross-tenant-isolation`), through the v1 seam
 * `POST /v1/host/sample/test/surface`, which names the tenant in the REQUEST
 * BODY — so it never tested the thing that matters, that the tenant comes from
 * the credential. Topics are named by pack authors, so two tenants running the
 * same pack share topic names by default; a host that keys the physical queue
 * by topic alone hands one tenant's messages to the other.
 *
 * No seam (`conformance.md` forbids growing the seam count). The leg drives
 * `ctx.queueBus` through the normal run surface with two fixtures
 * (`conformance/fixtures.md` §`conformance-queue-publish` /
 * §`conformance-queue-consume`): tenant A (`OPENWOP_API_KEY`) publishes a fresh
 * nonce on a fresh topic T; tenant B (`OPENWOP_TEST_TENANT_B_API_KEY`) consumes
 * T and MUST NOT receive it; then A consumes T and MUST receive it — the
 * positive control, without which "B got nothing" would also be what a host
 * whose queue does nothing at all shows.
 *
 * Dispositions: `queueBus` not advertised, or either probe fixture not
 * advertised ⇒ `inapplicable` (read with `familyAdvertised`, not `gateFamily`:
 * no host advertises `queueBus` at v2 today, and a strict-mode family gate would
 * demand a `family.queueBus` opt-out from every one of them). The family and fixtures advertised but no second
 * tenant key, or the key binds the primary tenant ⇒ `blocked` (the only
 * observation that convicts a leaking host did not run). A probe run that does
 * not complete, or a consume that leaves `consumed` unset, fails: the fixture
 * contract is the host's claim once it advertises the fixture.
 *
 * @see spec/v2/core/host-services.md §`queueBus`
 * @see SECURITY/invariants.yaml `queue-cross-tenant-isolation`
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse, type OpenWOPRequestInit } from '../lib/driver.js';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/host-services.md §queueBus';
const ID = 'openwop.requirement.queueBus.cross-tenant-isolation';
const PUBLISH = 'conformance-queue-publish';
const CONSUME = 'conformance-queue-consume';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const enc = (id: string): string => encodeURIComponent(id);
const tenantOf = (runId: string): string => runId.slice(0, Math.max(0, runId.indexOf('/')));
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

/** The `consumed` array the consume node output, wherever the host surfaces it (node.completed, run.completed, the snapshot). */
function consumedOf(docs: readonly unknown[]): string[] | null {
  let hit: string[] | null = null;
  const walk = (v: unknown): void => {
    if (hit !== null || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const c = (v as Record<string, unknown>)['consumed'];
    if (Array.isArray(c)) { hit = c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))); return; }
    Object.values(v as Record<string, unknown>).forEach(walk);
  };
  docs.forEach(walk);
  return hit;
}

interface Ran { readonly runId: string; readonly status: string; readonly docs: unknown[] }

async function run(workflowId: string, inputs: Record<string, unknown>, as: OpenWOPRequestInit, who: string): Promise<Ran | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId, inputs }, as));
  if (created === null) return { reason: `${who}: POST /runs unreachable (fetch failed)` };
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `${who}: POST /runs {workflowId: ${workflowId}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the fixture is advertised but did not start`.trim() };
  const deadline = Date.now() + 20_000;
  let snap: OpenWOPResponse | null = null;
  let status = '';
  while (Date.now() < deadline) {
    snap = await http(() => driver.get(`/runs/${enc(runId)}`, as));
    status = snap?.status === 200 ? String((snap.json as { status?: unknown } | undefined)?.status ?? '') : status;
    if (TERMINAL.has(status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!TERMINAL.has(status)) return { reason: `${who}: the ${workflowId} run ${runId} did not settle within 20 s (last status: ${status || 'unreadable'})` };
  const poll = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`, as));
  return { runId, status, docs: [snap?.json, poll?.status === 200 ? poll.json : null] };
}

describe('v2 queue-cross-tenant-isolation (host-services.md §queueBus)', () => {
  it('a message tenant A publishes on topic T is never consumed by tenant B on T, and A\'s own consumer receives it', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 under OpenWOP-Version: 2.0');
    if (!(await familyAdvertised('queueBus'))) return softSkip('inapplicable', 'queueBus family not advertised — no obligation');
    for (const f of [PUBLISH, CONSUME]) if (!isFixtureAdvertised(f)) return softSkip('inapplicable', `fixture ${f} is not advertised — the host does not claim the queue-probe fixture pair`);
    const keyB = process.env['OPENWOP_TEST_TENANT_B_API_KEY'];
    if (!keyB) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY is not set — the second-tenant consume, the only observation a leaking host fails, cannot run');
    const asA: OpenWOPRequestInit = {};
    const asB: OpenWOPRequestInit = { authenticated: false, headers: { Authorization: `Bearer ${keyB}` } };

    const topic = `openwop.conformance.xtenant.${randomBytes(6).toString('hex')}`;
    const nonce = `openwop-conformance-queue-${randomBytes(12).toString('hex')}`;

    const pub = await run(PUBLISH, { topic, message: nonce }, asA, 'tenant A publish'); if ('reason' in pub) return softSkip('blocked', pub.reason);
    expect(pub.status, req(ID, `conformance/fixtures.md §${PUBLISH}`, `tenant A's publish run MUST complete (got ${pub.status})`)).toBe('completed');

    const b = await run(CONSUME, { topic }, asB, 'tenant B consume'); if ('reason' in b) return softSkip('blocked', b.reason);
    if (tenantOf(b.runId) === tenantOf(pub.runId)) return softSkip('blocked', `OPENWOP_TEST_TENANT_B_API_KEY binds the same tenant as OPENWOP_API_KEY (${tenantOf(pub.runId)}) — the leg needs a second tenant`);
    expect(b.status, req(ID, `conformance/fixtures.md §${CONSUME}`, `tenant B's consume run MUST complete (got ${b.status})`)).toBe('completed');
    const gotB = consumedOf(b.docs);
    expect(Array.isArray(gotB), req(ID, `conformance/fixtures.md §${CONSUME}`, 'the consume node MUST output `consumed` as an array ([] when nothing arrived), never leave it unset — an unset output would pass the isolation check vacuously')).toBe(true);
    expect(gotB ?? [], req(ID, DOC, `a tenant's consumer MUST NOT receive another tenant's messages, even on the same topic — tenant B (${tenantOf(b.runId)}) consumed tenant A's (${tenantOf(pub.runId)}) message on ${topic}`)).not.toContain(nonce);

    const a = await run(CONSUME, { topic }, asA, 'tenant A consume'); if ('reason' in a) return softSkip('blocked', a.reason);
    expect(a.status, req(ID, `conformance/fixtures.md §${CONSUME}`, `tenant A's consume run MUST complete (got ${a.status})`)).toBe('completed');
    expect(consumedOf(a.docs) ?? [], req(ID, `conformance/fixtures.md §${CONSUME}`, `positive control: tenant A's own consumer on ${topic} MUST receive the message A published — without it "tenant B received nothing" is also what a queue that delivers nothing shows`)).toContain(nonce);
  }, 90_000);
});
