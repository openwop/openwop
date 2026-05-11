/**
 * Clarification-interrupt scenarios — exercises the run-scoped HITL
 * resolve surface using the `conformance-clarification` fixture.
 *
 * Per fixtures.md, the clarification node id is `ask` and the resume
 * schema requires `{answers: {q1: string}}`.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-clarification';
const NODE_ID = 'ask';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('interrupt: clarification answers resume to `completed`', () => {
  it('run suspends at ask, answers payload drives terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const suspended = await pollUntilStatus(runId, 'waiting-input', { timeoutMs: 10_000 });
    expect(suspended.currentNodeId, driver.describe(
      'fixtures.md conformance-clarification',
      'suspended run MUST report currentNodeId === "ask"',
    )).toBe(NODE_ID);

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { answers: { q1: 'blue' } } },
    );
    expect(resolve.status, driver.describe(
      'rest-endpoints.md POST /v1/runs/{runId}/interrupts/{nodeId}',
      'valid clarification resolve MUST return 200',
    )).toBe(200);

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status, driver.describe(
      'fixtures.md conformance-clarification §Terminal status',
      'fixture after resolve MUST reach terminal `completed`',
    )).toBe('completed');
  });
});
