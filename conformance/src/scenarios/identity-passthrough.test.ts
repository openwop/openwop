/**
 * Identity-passthrough scenario — exercises the `conformance-identity`
 * fixture. The fixture echoes its `payload` input back to the
 * `payload` variable on output. This verifies:
 *
 *   1. inputs.{var} on POST /v1/runs is observable in subsequent
 *      RunSnapshot.variables.{var} (per fixtures.md §conformance-identity).
 *   2. Object equality is preserved end-to-end (no JSON serialization
 *      drift on the server).
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-identity';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('identity: conformance-identity fixture echoes payload input to variables', () => {
  it('arbitrary nested JSON payload round-trips through inputs → variables', async () => {
    const payload = {
      stringField: 'hello',
      intField: 42,
      boolField: true,
      arrayField: [1, 'two', { three: 3 }],
      nested: {
        deeper: { stillDeeper: { value: 'leaf' } },
      },
    };

    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { payload },
    });
    expect(create.status, driver.describe(
      'rest-endpoints.md',
      'POST /v1/runs MUST return 201',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);

    expect(terminal.status, driver.describe(
      'fixtures.md conformance-identity',
      'identity fixture MUST reach terminal `completed`',
    )).toBe('completed');

    expect(terminal.variables?.payload, driver.describe(
      'fixtures.md conformance-identity §Expected behavior',
      'RunSnapshot.variables.payload MUST deep-equal the input payload',
    )).toEqual(payload);
  });
});
