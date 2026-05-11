/**
 * Multi-node ordering — exercises the `conformance-multi-node` fixture
 * (3-node DAG: a → b → c, all noop) and asserts that node.completed
 * events arrive in topological order via the `sequence` field on the
 * canonical RunEvent shape.
 *
 * Uses `GET /v1/runs/{runId}/events/poll?lastSequence=0&timeout=1` to
 * fetch the full event log after the run terminates. Long-poll
 * `timeout=1` keeps the test fast — terminal runs return immediately
 * because the server has no more events to wait for.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-multi-node';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

interface RunEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly nodeId?: string;
  readonly type: string;
  readonly sequence: number;
}

describe.skipIf(SKIP_NO_FIXTURE)('multi-node: conformance-multi-node fixture emits node.completed in topological order', () => {
  it('a, b, c node.completed events arrive in DAG order by sequence', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, driver.describe(
      'fixtures.md conformance-multi-node §Terminal status',
      'fixture MUST reach terminal `completed`',
    )).toBe('completed');

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    expect(eventsRes.status, driver.describe(
      'rest-endpoints.md GET /v1/runs/{runId}/events/poll',
      'event-poll MUST return 200 for known runs',
    )).toBe(200);

    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];
    const nodeCompletions = events
      .filter((e) => e.type === 'node.completed')
      .sort((x, y) => x.sequence - y.sequence)
      .map((e) => e.nodeId);

    expect(nodeCompletions, driver.describe(
      'fixtures.md conformance-multi-node §Topology',
      'all three node.completed events (a, b, c) MUST be present',
    )).toEqual(['a', 'b', 'c']);
  });
});
