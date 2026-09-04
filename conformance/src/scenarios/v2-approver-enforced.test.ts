/**
 * RFC 0173 §B — `approver-enforced` (suite 2.0.0, target major 2; gated on `interrupt` + `refKinds`).
 *
 * Enforcement is an obligation of the fields, not a discovery flag: a host that
 * advertises `interrupt` MUST refuse a resolver not in `approversList`
 * everywhere, and MUST enforce `approverGroupRefs` / `approverRoleRefs` where
 * `refKinds` includes `group` / `role` (`spec/v2/core/interrupt.md` §Approver
 * enforcement; security-defaults.md §Approver enforcement; RFC 0173 §B row C6.4).
 *
 * Gate: the `interrupt` family with a `refKinds[]` facet
 * (`spec/v2/facets/interrupt.schema.json`). Absent facet ⇒ `inapplicable`.
 *
 * What the suite can drive: it holds ONE bearer. A fixture whose approval gate
 * names a synthetic principal the suite is not (`conformance-approval-approvers`,
 * approversList: ["urn:conformance:listed-approver"]) makes the suite's own
 * bearer the non-listed resolver by construction. No such fixture ships in
 * `conformance/fixtures/` (`conformance-approval` has no approversList), so a
 * host that does not advertise it records `blocked` naming it.
 *
 * @see spec/v2/core/interrupt.md §Approver enforcement
 * @see spec/v2/core/security-defaults.md §Approver enforcement
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

/** An approval fixture whose `approversList` names a principal the suite's bearer is not. */
const FIXTURE = 'conformance-approval-approvers';
const NODE_ID = 'gate';
const REF_KINDS = ['principal', 'group', 'role'];

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function waitStatus(runId: string, wanted: ReadonlySet<string>, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
    if (status !== null && wanted.has(status)) return status;
    if (Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('RFC 0173 §B — approver-enforced (gated on interrupt + refKinds)', () => {
  it('a resolver outside approversList is refused at resolve time', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const interrupt = await gateFamily('interrupt');
    if (!interrupt) return softSkip('inapplicable', 'interrupt family not advertised (gate recorded under openwop.family.interrupt)');
    const refKinds = interrupt['refKinds'];
    if (!Array.isArray(refKinds)) return softSkip('inapplicable', 'interrupt.refKinds facet absent — the host advertises no approver ref kinds (interrupt.md §Approver enforcement binds approversList everywhere, but the facet is the gate this scenario keys on)');
    for (const k of refKinds) {
      expect(
        REF_KINDS,
        req('openwop.requirement.0173.approver-enforced', 'facets/interrupt.schema.json refKinds', `refKinds[] MUST be ⊆ principal | group | role (got ${String(k)})`),
      ).toContain(k);
    }
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(FIXTURE)) {
      return softSkip('blocked', `no interrupt-raising fixture with an approversList the suite's bearer is not on — advertise \`${FIXTURE}\` (a core.approvalGate whose approversList is ["urn:conformance:listed-approver"]) so a non-listed resolve can be driven`);
    }

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.requirement.0173.approver-enforced', 'runs.md §Create', `POST /runs MUST answer 201 for the advertised ${FIXTURE} fixture`)).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    const status = await waitStatus(runId, new Set(['waiting-approval', 'completed', 'failed', 'cancelled']), 10_000);
    expect(
      status,
      req('openwop.requirement.0173.approver-enforced', 'interrupt.md §Approver enforcement', 'the fixture MUST suspend on its approval gate (status waiting-approval) before a resolve can be attempted'),
    ).toBe('waiting-approval');

    // The suite's bearer is not `urn:conformance:listed-approver`.
    const resolve = await driver.post(`/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`, { resumeValue: { action: 'accept' } });
    expect(
      resolve.status,
      req('openwop.requirement.0173.approver-enforced', 'interrupt.md §Approver enforcement', 'a host advertising `interrupt` MUST refuse a resolver not in approversList with 403 (RFC 0173 §B — enforcement, not advice)'),
    ).toBe(403);
    expect(
      ['forbidden', 'run_forbidden'],
      req('openwop.requirement.0173.approver-enforced', 'errors.json', 'the refusal MUST carry a registered 403 code (forbidden | run_forbidden) in the canonical envelope'),
    ).toContain(readErrorCode(resolve.json));
    // The gate is still pending: a refused resolve MUST NOT advance it.
    const after = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    expect(
      (after.json as { status?: unknown } | null)?.status,
      req('openwop.requirement.0173.approver-enforced', 'interrupt.md §Approver enforcement', 'a refused resolve MUST NOT resume the run — the interrupt stays pending'),
    ).toBe('waiting-approval');
    await driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {});
  });
});
