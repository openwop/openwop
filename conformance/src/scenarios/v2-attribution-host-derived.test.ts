/**
 * `v2-attribution-host-derived` (target major 2) — who owns a run and who
 * resolved an interrupt come from the authenticated credential, never from what
 * the request says about itself.
 *
 *   identity.md §2.1: every lane MUST "bind the verified identity to the
 *   request, never to an asserted header … resolve to a Subject before any
 *   authorization decision".
 *   run-event-payloads.schema.json `$defs/interruptResolved.resolvedBy`
 *   (RFC 0259 §A.1): "A host MUST NOT record here a Subject that the request
 *   merely presented a resume token for, named in its body, or was addressed
 *   by."
 *
 * Until this file both invariants had major-1 pointers only, and neither v1
 * file drove the rule: `identity-passthrough` round-trips inputs, and
 * `approval-payload` pins vocabulary without resolving anything.
 *
 * Legs:
 *   1. `identity.owner-tenant-from-credential` (invariant
 *      `prompt-injection-tenant-host-derived`) — a baseline `conformance-noop`
 *      run gives the caller's tenant as the host records it (`owner.tenant`).
 *      Then the same create is sent asserting another tenant three ways: in
 *      headers (`OpenWOP-Tenant`, `X-Tenant-Id`, `X-Workspace-Id`), in `inputs`
 *      (`tenantId`, `workspaceId`, `owner`), and as top-level body members. The
 *      header-only create MUST succeed (headers it does not define are not a
 *      reason to refuse) and record the baseline tenant; each body variant MUST
 *      either be refused 4xx or record the baseline tenant. A run whose
 *      `owner.tenant`, `owner.workspace` or tenant-bound `runId` names the
 *      asserted scope fails.
 *   2. `interrupt.resolved-by-not-body-named` (invariant
 *      `prompt-injection-decidedby-host-only`) — a `conformance-approval` run is
 *      resolved `accept` by the suite's own credential with a resume value that
 *      also names a forged Subject as `resolvedBy` and a forged `decidedBy`. The
 *      resolve MAY be refused 4xx (a host that closes the resume value). If it
 *      is accepted, the recorded `interrupt.resolved.resolvedBy` MUST be absent
 *      or the caller's own Subject (`run.started.owner.subject`), and MUST NOT
 *      be the forged one. `decidedBy` itself is opaque at v2 (interrupt.md
 *      §Approval) — the attribution the invariant protects is `resolvedBy`.
 *
 * Dispositions: discovery unreachable ⇒ `blocked`; a fixture not advertised ⇒
 * `inapplicable` (leg 2 also needs the `interrupt` family); a baseline run that
 * cannot be created or read ⇒ `blocked`.
 *
 * Sabotage (local v2 reference host): `src/identity.ts` `authenticate` taking
 * `tenant` from an `x-tenant-id` header when present fails leg 1;
 * `src/executor.ts` `resolveAndResume` recording `resumeValue.resolvedBy` when
 * present fails leg 2.
 *
 * @see spec/v2/core/identity.md §2.1
 * @see schemas/v2/run-event-payloads.schema.json $defs/interruptResolved
 * @see SECURITY/invariants.yaml id: prompt-injection-tenant-host-derived, prompt-injection-decidedby-host-only
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID_TENANT = 'openwop.requirement.identity.owner-tenant-from-credential';
const ID_RESOLVED_BY = 'openwop.requirement.interrupt.resolved-by-not-body-named';
const DOC_TENANT = 'spec/v2/core/identity.md §2.1';
const DOC_RESOLVED_BY = 'run-event-payloads.schema.json $defs/interruptResolved.resolvedBy (RFC 0259 §A.1)';
const NOOP = 'conformance-noop';
const APPROVAL = 'conformance-approval';
const GATE = 'gate';
const FORGED_TENANT = 'openwop-conformance-forged-tenant';
const FORGED_WORKSPACE = 'openwop-conformance-forged-workspace';
const FORGED_SUBJECT = { issuer: 'urn:openwop:conformance:forged', subjectId: 'forged-approver', tenant: FORGED_TENANT, lane: 'api-key', kind: 'user' };
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
interface Owner { tenant?: unknown; workspace?: unknown; subject?: unknown }
interface Ev { type?: string; payload?: Record<string, unknown> }

async function ownerOf(runId: string): Promise<Owner | null> {
  const s = await http(() => driver.get(`/runs/${enc(runId)}`));
  return s?.status === 200 ? ((s.json as { owner?: Owner } | null)?.owner ?? null) : null;
}
const tenantSegment = (id: string): string | null => (id.includes('/') ? id.slice(0, id.indexOf('/')) : null);

describe('v2 attribution is host-derived (identity.md §2.1; interruptResolved.resolvedBy)', () => {
  it('a run\'s owner tenant comes from the credential, not from headers, inputs or body members naming another', async () => {
    if (!(await v2Discovery().catch(() => null))) return softSkip('blocked', UNREADABLE);
    if (!isFixtureAdvertised(NOOP)) return softSkip('inapplicable', `${NOOP} is not advertised — no run to create`);
    const base = await http(() => driver.post('/runs', { workflowId: NOOP }));
    const baseId = (base?.json as { runId?: unknown } | null)?.runId;
    if (base?.status !== 201 || typeof baseId !== 'string') return softSkip('blocked', `the baseline POST /runs {${NOOP}} answered ${base?.status ?? 'nothing'} ${readErrorCode(base?.json) ?? ''}`.trim());
    const baseOwner = await ownerOf(baseId);
    if (typeof baseOwner?.tenant !== 'string') return softSkip('blocked', `the baseline run ${baseId} snapshot carries no owner.tenant — the caller's tenant cannot be learned`);
    const tenant = baseOwner.tenant;

    const forgedHeaders = { 'OpenWOP-Tenant': FORGED_TENANT, 'X-Tenant-Id': FORGED_TENANT, 'X-Workspace-Id': FORGED_WORKSPACE };
    const variants: Array<{ what: string; body: Record<string, unknown>; headers?: Record<string, string>; mayRefuse: boolean }> = [
      { what: 'headers', body: { workflowId: NOOP }, headers: forgedHeaders, mayRefuse: false },
      { what: 'inputs', body: { workflowId: NOOP, inputs: { tenantId: FORGED_TENANT, workspaceId: FORGED_WORKSPACE, owner: { tenant: FORGED_TENANT, workspace: FORGED_WORKSPACE } } }, mayRefuse: true },
      { what: 'top-level body members', body: { workflowId: NOOP, tenantId: FORGED_TENANT, workspaceId: FORGED_WORKSPACE, owner: { tenant: FORGED_TENANT, workspace: FORGED_WORKSPACE } }, mayRefuse: true },
    ];
    for (const v of variants) {
      const res = await http(() => driver.post('/runs', v.body, v.headers ? { headers: v.headers } : {}));
      expect(res, req(ID_TENANT, DOC_TENANT, `POST /runs with another tenant asserted in ${v.what} MUST be answered`)).not.toBeNull();
      if (v.mayRefuse && res!.status >= 400 && res!.status < 500) continue;
      expect(res!.status, req(ID_TENANT, DOC_TENANT, `POST /runs with another tenant asserted in ${v.what} MUST create the run under the caller's own tenant${v.mayRefuse ? ' or refuse it 4xx' : ''} (got ${res!.status} ${readErrorCode(res!.json) ?? ''})`)).toBe(201);
      const runId = (res!.json as { runId?: unknown } | null)?.runId as string;
      const seg = tenantSegment(runId);
      if (seg !== null) expect(seg, req(ID_TENANT, DOC_TENANT, `the tenant-bound runId MUST name the caller's tenant when another is asserted in ${v.what} (got ${runId})`)).toBe(tenantSegment(baseId));
      const owner = await ownerOf(runId);
      expect(owner?.tenant, req(ID_TENANT, DOC_TENANT, `owner.tenant MUST be the credential's tenant ${tenant} when another tenant is asserted in ${v.what} (got ${String(owner?.tenant)})`)).toBe(tenant);
      expect(owner?.workspace, req(ID_TENANT, DOC_TENANT, `owner.workspace MUST NOT be a workspace asserted in ${v.what}`)).not.toBe(FORGED_WORKSPACE);
    }
  }, 60_000);

  it('interrupt.resolved records the authenticated resolver, never a Subject named in the resume value', async () => {
    if (!(await v2Discovery().catch(() => null))) return softSkip('blocked', UNREADABLE);
    if (!(await familyAdvertised('interrupt'))) return softSkip('inapplicable', 'the interrupt family is not advertised — there is no resolution to attribute');
    if (!isFixtureAdvertised(APPROVAL)) return softSkip('inapplicable', `${APPROVAL} is not advertised — no approval gate to resolve`);
    const created = await http(() => driver.post('/runs', { workflowId: APPROVAL }));
    const runId = (created?.json as { runId?: unknown } | null)?.runId;
    if (created?.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs {${APPROVAL}} answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim());
    let status = '';
    for (const deadline = Date.now() + 15_000; Date.now() < deadline;) {
      status = String(((await http(() => driver.get(`/runs/${enc(runId)}`)))?.json as { status?: unknown } | null)?.status ?? '');
      if (status === 'waiting-approval' || TERMINAL.has(status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (status !== 'waiting-approval') return softSkip('blocked', `the ${APPROVAL} run did not suspend on its gate (status ${status || 'unreadable'})`);
    const res = await http(() => driver.post(`/runs/${enc(runId)}/interrupts/${enc(GATE)}`, { resumeValue: { action: 'accept', resolvedBy: FORGED_SUBJECT, decidedBy: FORGED_SUBJECT.subjectId } }));
    expect(res, req(ID_RESOLVED_BY, DOC_RESOLVED_BY, 'the resolve MUST be answered')).not.toBeNull();
    // A 4xx refusal is conforming: nothing forged can have been recorded. Only an accepted resolve has a record to read.
    if (res!.status < 400 || res!.status >= 500) {
      expect(res!.status >= 200 && res!.status < 300, req(ID_RESOLVED_BY, DOC_RESOLVED_BY, `an accepted resolve answers 2xx (got ${res!.status} ${readErrorCode(res!.json) ?? ''})`)).toBe(true);
      let evs: Ev[] = [];
      for (const deadline = Date.now() + 15_000; Date.now() < deadline;) {
        const poll = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
        evs = ((poll?.json as { events?: Ev[] } | null)?.events ?? []);
        if (evs.some((e) => e.type === 'interrupt.resolved')) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const resolved = evs.find((e) => e.type === 'interrupt.resolved')?.payload;
      expect(resolved, req(ID_RESOLVED_BY, DOC_RESOLVED_BY, 'an accepted resolve MUST record interrupt.resolved')).toBeDefined();
      const by = resolved?.['resolvedBy'];
      const caller = (evs.find((e) => e.type === 'run.started')?.payload?.['owner'] as Owner | undefined)?.subject;
      expect(JSON.stringify(by ?? null).includes(FORGED_SUBJECT.issuer), req(ID_RESOLVED_BY, DOC_RESOLVED_BY, `resolvedBy MUST NOT be a Subject the request named in its body (recorded ${JSON.stringify(by)})`)).toBe(false);
      if (by !== undefined && caller !== undefined) {
        expect(by, req(ID_RESOLVED_BY, DOC_RESOLVED_BY, 'resolvedBy, when recorded, MUST be the Subject the resolving request authenticated as — the caller\'s own run.started.owner.subject')).toEqual(caller);
      }
    }
  }, 60_000);
});
