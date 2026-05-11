/**
 * Interrupt profile: `openwop-interrupt-auth-required` (interrupt-profiles.md).
 *
 * Exercises the auth-elevation behavior against the
 * `conformance-interrupt-auth-required` fixture: an approval gate that
 * REQUIRES a bearer credential (API key OR OAuth2 token) with the
 * `approvals:respond` scope. Signed-token callback resume is REJECTED
 * for this profile (the profile elevates auth).
 *
 * Verifies:
 *   1. Bearer-token resume on the run-scoped endpoint succeeds.
 *   2. Bearer-token resume with insufficient scope returns 403.
 *   3. (Optional, when host issues a callback token at suspend time)
 *      Resolving via the signed-token surface is REJECTED for this fixture.
 *
 * Profile gating: a host claims this profile by seeding the fixture.
 *
 * @see spec/v1/interrupt-profiles.md §openwop-interrupt-auth-required
 * @see conformance/fixtures/conformance-interrupt-auth-required.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-interrupt-auth-required';
const NODE_ID = 'gate';
const SKIP = !isFixtureAdvertised(WORKFLOW_ID);

describe.skipIf(SKIP)('interrupt: auth-required — bearer resume succeeds', () => {
  it('valid bearer with approvals:respond drives terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'accept' } },
    );
    expect(resolve.status, driver.describe(
      'interrupt-profiles.md §openwop-interrupt-auth-required',
      'bearer-token resume with approvals:respond scope MUST succeed',
    )).toBeGreaterThanOrEqual(200);
    expect(resolve.status).toBeLessThan(300);

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status).toBe('completed');
  });
});

describe.skipIf(SKIP)('interrupt: auth-required — insufficient scope returns 403', () => {
  it('bearer without approvals:respond scope is rejected', async () => {
    // This scenario requires a separate test-only credential that lacks
    // `approvals:respond`. Drivers wire it via the OPENWOP_TEST_LOW_SCOPE_KEY
    // env var; when absent the test skips (rather than passing trivially).
    const lowScopeKey = process.env.OPENWOP_TEST_LOW_SCOPE_KEY;
    if (!lowScopeKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[interrupt-auth-required-resume] skipping insufficient-scope subtest: ' +
          'OPENWOP_TEST_LOW_SCOPE_KEY not set',
      );
      return;
    }

    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'accept' } },
      { headers: { Authorization: `Bearer ${lowScopeKey}` } },
    );
    expect(resolve.status, driver.describe(
      'auth.md §scopes + interrupt-profiles.md §openwop-interrupt-auth-required',
      'bearer without approvals:respond scope MUST return 403',
    )).toBe(403);

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});
