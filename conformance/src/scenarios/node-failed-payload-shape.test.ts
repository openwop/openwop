/**
 * `node.failed` payload shape — `run-event-payloads.schema.json` §nodeFailed:
 * `{ nodeId, error: { code, message, details?, retryable? }, attempts? }`. The
 * error is an OBJECT (`_errorObject`), not a bare string, and it is REQUIRED.
 *
 * Why this exists (S34, 2026-08-17): nothing on the wire checked it. The second
 * sibling host measured that it — and the reference hosts — emitted
 * `node.failed { error: "<string>", code }` / `{ data: { code } }` for years
 * while the schema said otherwise, and only noticed because a replay scenario
 * happens to read `payload.error.code`. A schema nobody drives is a wish.
 *
 * Fixture-gated on `conformance-failure` (the run that fails at a node); a host
 * that does not advertise the fixture records inapplicable. Every `node.failed`
 * on that run's log MUST validate against §nodeFailed.
 *
 * @see spec/v1/rest-endpoints.md · schemas/run-event-payloads.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-failure';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

function nodeFailedValidator() {
  const payloads = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'run-event-payloads.schema.json'), 'utf8')) as {
    $id?: string;
    $defs: Record<string, unknown>;
  };
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:openwop:node-failed-leg', $defs: payloads.$defs, $ref: '#/$defs/nodeFailed' };
  return ajv.compile(schema);
}

describe.skipIf(SKIP_NO_FIXTURE)('run-event-payloads.schema.json §nodeFailed — node.failed carries a structured error object', () => {
  it('every node.failed on the conformance-failure run validates against §nodeFailed (error: { code, message } is an object, not a string)', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status, req('openwop.it.node-failed-payload-shape.every-node-failed-on-the-conformance-failure-run-validates-against-nodefailed-er', 'rest-endpoints.md', 'POST /v1/runs MUST return 201 for the failing fixture')).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, req('openwop.it.node-failed-payload-shape.every-node-failed-on-the-conformance-failure-run-validates-against-nodefailed-er', 'fixtures.md conformance-failure §Terminal status', 'fixture MUST reach terminal `failed`')).toBe('failed');

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(res.status).toBe(200);
    const events = ((res.json as { events?: Array<{ type: string; payload?: unknown }> } | undefined)?.events ?? []);
    const failed = events.filter((e) => e.type === 'node.failed');
    expect(
      failed.length,
      req('openwop.it.node-failed-payload-shape.every-node-failed-on-the-conformance-failure-run-validates-against-nodefailed-er', 'rest-endpoints.md §Run events', 'a run that fails at a node MUST carry at least one node.failed event on its log'),
    ).toBeGreaterThan(0);

    const validate = nodeFailedValidator();
    for (const ev of failed) {
      const ok = validate(ev.payload);
      expect(
        ok,
        req('openwop.it.node-failed-payload-shape.every-node-failed-on-the-conformance-failure-run-validates-against-nodefailed-er', 
          'run-event-payloads.schema.json §nodeFailed',
          `node.failed payload MUST validate — error is a REQUIRED object { code, message } (_errorObject), not a bare string or a data.code: ${JSON.stringify(validate.errors)} — payload: ${JSON.stringify(ev.payload).slice(0, 300)}`,
        ),
      ).toBe(true);
    }
  });
});
