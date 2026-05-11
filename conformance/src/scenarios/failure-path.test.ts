/**
 * Failure-path scenarios — exercises the `conformance-failure` fixture
 * which always throws. Verifies the terminal `failed` status surface
 * and `RunSnapshot.error` shape per rest-endpoints.md.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-failure';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('failure: conformance-failure fixture reaches terminal `failed`', () => {
  it('POST /v1/runs accepts the run and run terminates as failed with structured error', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status, driver.describe(
      'rest-endpoints.md',
      'POST /v1/runs MUST return 201 even for fixtures that fail at runtime',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);

    expect(terminal.status, driver.describe(
      'fixtures.md conformance-failure §Terminal status',
      'fixture MUST reach terminal `failed`',
    )).toBe('failed');

    expect(typeof terminal.error, driver.describe(
      'rest-endpoints.md RunSnapshot.error',
      'RunSnapshot.error MUST be a structured object on terminal `failed`',
    )).toBe('object');
    expect(terminal.error, 'RunSnapshot.error MUST be non-null').not.toBeNull();

    expect(typeof terminal.error?.code, driver.describe(
      'rest-endpoints.md RunSnapshot.error.code',
      'RunSnapshot.error.code MUST be a string',
    )).toBe('string');
    expect(typeof terminal.error?.message, driver.describe(
      'rest-endpoints.md RunSnapshot.error.message',
      'RunSnapshot.error.message MUST be a string',
    )).toBe('string');
  });
});
