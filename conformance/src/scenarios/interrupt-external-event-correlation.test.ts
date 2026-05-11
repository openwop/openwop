/**
 * Interrupt profile: `openwop-interrupt-external-event` (interrupt-profiles.md).
 *
 * Exercises external-event correlation matching against the
 * `conformance-interrupt-external-event` fixture: suspends waiting for
 * a POST to `/v1/interrupts/{token}` with correlation `{orderId, status}`.
 *
 * Verifies:
 *   1. The suspend persists a signed callback token.
 *   2. A matching external POST resumes the run with the event body.
 *   3. A mismatched correlation payload returns 422 without resuming.
 *
 * Profile gating: a host claims this profile by seeding the fixture;
 * scenario skips when the fixture is not advertised.
 *
 * @see spec/v1/interrupt-profiles.md §openwop-interrupt-external-event
 * @see spec/v1/interrupt.md §Signed-token callback
 * @see conformance/fixtures/conformance-interrupt-external-event.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-interrupt-external-event';
const SKIP = !isFixtureAdvertised(WORKFLOW_ID);

interface SuspendDetails {
  interruptToken?: string;
  callbackUrl?: string;
}

async function fetchInterruptToken(runId: string): Promise<string | null> {
  const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
  const interrupt = (snap.json as { interrupt?: SuspendDetails }).interrupt;
  if (interrupt?.interruptToken) return interrupt.interruptToken;
  if (interrupt?.callbackUrl) {
    const m = interrupt.callbackUrl.match(/\/v1\/interrupts\/([^/?]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

describe.skipIf(SKIP)('interrupt: external-event — matching correlation resumes', () => {
  it('signed-token POST with matching correlation drives terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-external', { timeoutMs: 10_000 });

    const token = await fetchInterruptToken(runId);
    expect(token, driver.describe(
      'interrupt.md §Signed-token callback',
      'suspended external-event interrupt MUST expose a signed token to the caller',
    )).not.toBeNull();

    const resolve = await driver.post(`/v1/interrupts/${encodeURIComponent(token!)}`, {
      resumeValue: {
        orderId: 'fixture-order-1',
        status: 'completed',
        externalReference: 'conformance-test-123',
      },
    });
    expect(resolve.status, driver.describe(
      'rest-endpoints.md POST /v1/interrupts/{token}',
      'token resolve with matching correlation MUST return 2xx',
    )).toBeGreaterThanOrEqual(200);
    expect(resolve.status).toBeLessThan(300);

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status, driver.describe(
      'fixtures.md conformance-interrupt-external-event',
      'matching external event MUST drive terminal completed',
    )).toBe('completed');
  });
});

describe.skipIf(SKIP)('interrupt: external-event — mismatched correlation rejected', () => {
  it('correlation mismatch returns 422 and leaves run suspended', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-external', { timeoutMs: 10_000 });

    const token = await fetchInterruptToken(runId);
    expect(token).not.toBeNull();

    const resolve = await driver.post(`/v1/interrupts/${encodeURIComponent(token!)}`, {
      resumeValue: {
        orderId: 'different-order',
        status: 'completed',
      },
    });
    expect(
      [422, 400].includes(resolve.status),
      driver.describe(
        'interrupt-profiles.md §openwop-interrupt-external-event',
        'correlation mismatch MUST return 422 (or 400) without resuming',
      ),
    ).toBe(true);

    const still = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const status = (still.json as { status: string }).status;
    expect(status, 'run MUST remain suspended after correlation rejection').toMatch(/^waiting-/);

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});
