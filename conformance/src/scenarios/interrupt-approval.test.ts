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
