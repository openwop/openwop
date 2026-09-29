/**
 * Run-lifecycle scenarios — exercises POST /v1/runs + terminal status visibility.
 *
 * Uses the `conformance-noop` fixture from `../../fixtures/openwop-conformance-noop.json`.
 * Server MUST have seeded that fixture before this test runs (see fixtures.md).
 *
 * The suite assumes synchronous-or-fast completion. For servers that take
 * >10s on a noop, bump OPENWOP_LIFECYCLE_TIMEOUT_MS in the environment.
 * Polling cadence is 250ms.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);
const NO_FIXTURE_REASON = `precondition not met — \`${NOOP_WORKFLOW_ID}\` is not advertised, so this host cannot witness the runs-lifecycle floor. RFC 0148 §A: \`blocked\`, naming the fixture (#1686: a describe-level skip recorded no disposition, and an unrecorded floor rejected the whole certification)`;

describe('run lifecycle: conformance-noop fixture', () => {
  it('POST /v1/runs returns 201 with runId per rest-endpoints.md', async () => {
    if (SKIP_NO_NOOP) return softSkip('blocked', NO_FIXTURE_REASON);
    const res = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });

    expect(res.status, req('openwop.it.runs-lifecycle.post-v1-runs-returns-201-with-runid-per-rest-endpoints-md', 
      'rest-endpoints.md',
      'POST /v1/runs MUST return 201 on accepted run',
    )).toBe(201);

    const body = res.json as { runId?: unknown; status?: unknown } | undefined;
    expect(typeof body?.runId, req('openwop.it.runs-lifecycle.post-v1-runs-returns-201-with-runid-per-rest-endpoints-md', 
      'rest-endpoints.md',
      'POST /v1/runs response body MUST include `runId` string',
    )).toBe('string');
    expect(typeof body?.status, req('openwop.it.runs-lifecycle.post-v1-runs-returns-201-with-runid-per-rest-endpoints-md', 
      'rest-endpoints.md',
      'POST /v1/runs response body MUST include `status` string',
    )).toBe('string');
  });

  it('reaches terminal `completed` within bounded time per fixtures.md noop spec', async () => {
    if (SKIP_NO_NOOP) return softSkip('blocked', NO_FIXTURE_REASON);
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);

    expect(terminal.status, req('openwop.it.runs-lifecycle.reaches-terminal-completed-within-bounded-time-per-fixtures-md-noop-spec', 
      'fixtures.md conformance-noop §Terminal status',
      'fixture MUST reach terminal status `completed`',
    )).toBe('completed');

    expect(terminal.runId, req('openwop.it.runs-lifecycle.reaches-terminal-completed-within-bounded-time-per-fixtures-md-noop-spec', 
      'rest-endpoints.md RunSnapshot',
      'GET /v1/runs/{runId} MUST echo runId',
    )).toBe(runId);
  });

  it('GET /v1/runs/{nonexistentId} returns 404 (or 403) per rest-endpoints.md', async () => {
    if (SKIP_NO_NOOP) return softSkip('blocked', NO_FIXTURE_REASON);
    const res = await driver.get('/v1/runs/openwop-conformance-this-run-id-does-not-exist');
    expect(
      [403, 404].includes(res.status),
      req('openwop.it.runs-lifecycle.get-v1-runs-nonexistentid-returns-404-or-403-per-rest-endpoints-md', 'rest-endpoints.md', 'unknown run MUST return 404 or 403'),
    ).toBe(true);
  });
});
