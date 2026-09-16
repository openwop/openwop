/**
 * Approval-interrupt scenarios — exercises the run-scoped HITL
 * resolve surface (`POST /v1/runs/{runId}/interrupts/{nodeId}`)
 * using the `conformance-approval` fixture.
 *
 * Per fixtures.md, the fixture's approval node id is `gate` and the
 * resume schema is `{action: 'accept' | 'reject'}`.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-approval';
const NODE_ID = 'gate';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

const REFINE_WORKFLOW_ID = 'conformance-approval-refine';
const SKIP_NO_REFINE = !isFixtureAdvertised(REFINE_WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('interrupt: approval accept resumes to `completed`', () => {
  it('run suspends at gate, accept resolution drives terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const suspended = await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });
    expect(suspended.currentNodeId, req('openwop.it.interrupt-approval.run-suspends-at-gate-accept-resolution-drives-terminal-completed', 
      'fixtures.md conformance-approval',
      'suspended run MUST report currentNodeId === "gate"',
    )).toBe(NODE_ID);

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'accept' } },
    );
    expect(resolve.status, req('openwop.it.interrupt-approval.run-suspends-at-gate-accept-resolution-drives-terminal-completed', 
      'rest-endpoints.md POST /v1/runs/{runId}/interrupts/{nodeId}',
      'valid approval resolve MUST return 200',
    )).toBe(200);

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status, req('openwop.it.interrupt-approval.run-suspends-at-gate-accept-resolution-drives-terminal-completed', 
      'fixtures.md conformance-approval §Terminal status',
      'fixture after accept MUST reach terminal `completed`',
    )).toBe('completed');
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('interrupt: invalid resolve payload rejected per resumeSchema', () => {
  it('400 (or 422) when action is not in {accept, reject}', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'maybe' } },
    );
    expect(
      [400, 422].includes(resolve.status),
      req('openwop.it.interrupt-approval.400-or-422-when-action-is-not-in-accept-reject', 
        'interrupt.md + resumeSchema validation',
        'resolve payload that violates resumeSchema MUST return 400 or 422',
      ),
    ).toBe(true);

    // Cleanup: cancel the still-suspended run so the test doesn't leave
    // a dangling fixture run on the server.
    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('interrupt: resolving an unknown interrupt returns 404', () => {
  it('400/404 when nodeId does not match an active interrupt', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/no-such-node`,
      { resumeValue: { action: 'accept' } },
    );
    expect(resolve.status, req('openwop.it.interrupt-approval.400-404-when-nodeid-does-not-match-an-active-interrupt', 
      'rest-endpoints.md POST /v1/runs/{runId}/interrupts/{nodeId}',
      'resolving an unknown nodeId MUST return 404',
    )).toBe(404);

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});

/**
 * RFC 0183 §A.1/§A.2 — a `refine` resolution must be recordable.
 *
 * Before RFC 0183, `interruptResolved` was `additionalProperties: false` with no
 * seat for the resume action and no seat for the feedback a refine REQUIRES, and
 * `decision` was an unconstrained string whose documented vocabulary is a
 * different axis (governance: granted|rejected|overridden). A host resolving by
 * refine could record neither what the approver did nor the feedback they gave.
 *
 * Uses its own fixture rather than widening `conformance-approval`, because
 * adding `refine` to that fixture's `actions` would change a registered workflow
 * definition every host already serves.
 */
describe.skipIf(SKIP_NO_REFINE)('interrupt: refine resolution carries action + refineFeedback (RFC 0183)', () => {
  it('a refine resolve round-trips `action` and the structured feedback it requires', async () => {
    const create = await driver.post('/v1/runs', { workflowId: REFINE_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const suspended = await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });
    expect(suspended.currentNodeId).toBe(NODE_ID);

    const refineFeedback = { scope: 'whole', text: 'conformance: please tighten the summary' };
    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'refine', refineFeedback } },
    );
    expect(
      resolve.status,
      req('openwop.it.interrupt-approval.a-refine-resolve-round-trips-action-and-the-structured-feedback-it-requires',
        'RFCS/0183-interrupt-resolved-action-fidelity.md §A.1',
        'a gate offering `refine` MUST accept a refine resolution carrying refineFeedback',
      ),
    ).toBe(200);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(events.status).toBe(200);
    const rows = ((events.json as { events?: Array<Record<string, unknown>> } | undefined)?.events ?? []);
    const resolved = rows.find((e) => String(e.type).endsWith('interrupt.resolved') || String(e.type).endsWith('approval.received'));
    expect(
      resolved,
      req('openwop.it.interrupt-approval.a-refine-resolve-round-trips-action-and-the-structured-feedback-it-requires',
        'RFCS/0183-interrupt-resolved-action-fidelity.md §A.1',
        'the resolution MUST be recorded as an event',
      ),
    ).toBeDefined();

    const payload = (resolved?.payload ?? {}) as Record<string, unknown>;
    expect(
      payload.action,
      req('openwop.it.interrupt-approval.a-refine-resolve-round-trips-action-and-the-structured-feedback-it-requires',
        'RFCS/0183-interrupt-resolved-action-fidelity.md §A.1',
        'the resolved payload MUST carry `action: "refine"` — the seat RFC 0183 adds',
      ),
    ).toBe('refine');
    expect(
      payload.refineFeedback,
      req('openwop.it.interrupt-approval.a-refine-resolve-round-trips-action-and-the-structured-feedback-it-requires',
        'RFCS/0183-interrupt-resolved-action-fidelity.md §A.2',
        'a refine resolution MUST carry the refineFeedback it was given — an action whose meaning is incomplete without it',
      ),
    ).toBeTruthy();
  });

  it('refuses a refine resolution that supplies no refineFeedback', async () => {
    const create = await driver.post('/v1/runs', { workflowId: REFINE_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'refine' } },
    );
    expect(
      [400, 422].includes(resolve.status),
      req('openwop.it.interrupt-approval.refuses-a-refine-resolution-that-supplies-no-refinefeedback',
        'RFCS/0183-interrupt-resolved-action-fidelity.md §A.2',
        'refine without refineFeedback MUST be refused — the feedback is what the action means',
      ),
    ).toBe(true);
  });
});
