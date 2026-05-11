/**
 * Cancellation scenarios — exercises `POST /v1/runs/{runId}/cancel`
 * mid-flight using the `conformance-cancellable` fixture.
 *
 * The fixture sleeps `delayMs` (caller-supplied). The test starts a
 * run with delayMs=10s, polls until `running`, issues cancel, and
 * verifies terminal `cancelled` within 5s.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-cancellable';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('cancellation: in-flight :cancel reaches terminal `cancelled`', () => {
  it('POST /v1/runs/{runId}/cancel returns 200 and run terminates as cancelled', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 10_000 },
    });
    expect(create.status, driver.describe(
      'rest-endpoints.md',
      'POST /v1/runs MUST return 201 on accepted run',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // Wait for run to reach `running` so the cancel hits a live executor,
    // not the dispatch queue. Allow up to 5s for boot.
    await pollUntilStatus(runId, 'running', { timeoutMs: 5_000 });

    const cancel = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/cancel`,
      { reason: 'conformance-cancellation-test' },
    );
    expect(cancel.status, driver.describe(
      'rest-endpoints.md POST /v1/runs/{runId}/cancel',
      'cancel MUST return 200 on accepted cancellation',
    )).toBe(200);

    const cancelBody = cancel.json as { status?: string };
    expect(
      ['cancelled', 'cancelling'].includes(cancelBody.status ?? ''),
      driver.describe(
        'rest-endpoints.md POST /v1/runs/{runId}/cancel',
        'cancel response status MUST be one of `cancelled` or `cancelling`',
      ),
    ).toBe(true);

    const terminal = await pollUntilStatus(runId, 'cancelled', { timeoutMs: 5_000 });
    expect(terminal.status, driver.describe(
      'fixtures.md conformance-cancellable §Terminal status',
      'fixture MUST reach terminal `cancelled` within 5s of cancel',
    )).toBe('cancelled');
  });
});

describe('cancellation: cancelling an unknown run returns 404', () => {
  it('POST /v1/runs/{nonexistentId}/cancel returns 404', async () => {
    const res = await driver.post('/v1/runs/openwop-conformance-no-such-run/cancel', {});
    expect(
      [403, 404].includes(res.status),
      driver.describe('rest-endpoints.md', 'cancel on unknown run MUST return 404 or 403'),
    ).toBe(true);
  });
});
