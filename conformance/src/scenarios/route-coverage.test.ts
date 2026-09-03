/**
 * Route coverage scenarios — direct probes for OpenAPI operations that are
 * otherwise only indirectly exercised by fixture flows.
 *
 * These tests intentionally stay small: they assert route existence, status
 * class, and canonical error-envelope shape for edge cases that every host can
 * answer without special fixtures.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

interface ErrorEnvelope {
  error?: unknown;
  message?: unknown;
  details?: unknown;
  [key: string]: unknown;
}

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

function assertCanonicalErrorEnvelope(requirementId: string, body: unknown, specSection: string): void {
  expect(typeof body, req(requirementId, specSection, 'error response MUST be a JSON object')).toBe(
    'object',
  );
  expect(body, req(requirementId, specSection, 'error response MUST NOT be null')).not.toBeNull();

  const env = body as ErrorEnvelope;
  expect(typeof env.error, req(requirementId, 
    specSection,
    'error envelope MUST include machine-readable string `error`',
  )).toBe('string');
  expect(typeof env.message, req(requirementId, 
    specSection,
    'error envelope MUST include human-readable string `message`',
  )).toBe('string');

  if (env.details !== undefined) {
    expect(typeof env.details, req(requirementId, 
      specSection,
      'error envelope `details`, when present, MUST be an object',
    )).toBe('object');
    expect(env.details, req(requirementId, 
      specSection,
      'error envelope `details`, when present, MUST NOT be null',
    )).not.toBeNull();
  }

  const allowedKeys = new Set(['error', 'message', 'details']);
  const extras = Object.keys(env).filter((key) => !allowedKeys.has(key));
  expect(extras, req(requirementId, 
    'schemas/error-envelope.schema.json',
    'error envelope MUST NOT contain top-level keys outside {error,message,details}',
  )).toEqual([]);
}

describe.skipIf(SKIP_NO_NOOP)('route coverage: GET /v1/workflows/{workflowId}', () => {
  it('returns the seeded workflow definition for an advertised fixture workflow', async () => {
    const res = await driver.get(`/v1/workflows/${encodeURIComponent(NOOP_WORKFLOW_ID)}`);

    expect(res.status, req('openwop.it.route-coverage.returns-the-seeded-workflow-definition-for-an-advertised-fixture-workflow', 
      'api/openapi.yaml operationId=getWorkflow',
      'GET /v1/workflows/{workflowId} MUST return 200 for a known workflow',
    )).toBe(200);

    const body = res.json as { id?: unknown; nodes?: unknown } | undefined;
    expect(body?.id, req('openwop.it.route-coverage.returns-the-seeded-workflow-definition-for-an-advertised-fixture-workflow', 
      'schemas/workflow-definition.schema.json',
      'workflow definition MUST echo its id',
    )).toBe(NOOP_WORKFLOW_ID);
    expect(Array.isArray(body?.nodes), req('openwop.it.route-coverage.returns-the-seeded-workflow-definition-for-an-advertised-fixture-workflow', 
      'schemas/workflow-definition.schema.json',
      'workflow definition MUST include a nodes array',
    )).toBe(true);
  });
});

describe('route coverage: negative operation probes', () => {
  it('GET /v1/workflows/{unknownWorkflowId} returns a canonical 404 or 403 envelope', async () => {
    const res = await driver.get('/v1/workflows/openwop-conformance-missing-workflow');

    expect([403, 404].includes(res.status), req('openwop.it.route-coverage.get-v1-workflows-unknownworkflowid-returns-a-canonical-404-or-403-envelope', 
      'api/openapi.yaml operationId=getWorkflow',
      'unknown workflow MUST return 404 or 403 if existence is protected',
    )).toBe(true);
    assertCanonicalErrorEnvelope('openwop.it.route-coverage.get-v1-workflows-unknownworkflowid-returns-a-canonical-404-or-403-envelope', res.json, 'rest-endpoints.md error envelope');
  });

  it('GET /v1/runs/{runId}/artifacts/{artifactId} for an unknown artifact returns a canonical 404 or 403 envelope', async () => {
    const res = await driver.get(
      '/v1/runs/openwop-conformance-missing-run/artifacts/openwop-conformance-missing-artifact',
    );

    expect([403, 404].includes(res.status), req('openwop.it.route-coverage.get-v1-runs-runid-artifacts-artifactid-for-an-unknown-artifact-returns-a-canonic', 
      'api/openapi.yaml operationId=getArtifact',
      'unknown artifact MUST return 404 or 403 if existence is protected',
    )).toBe(true);
    assertCanonicalErrorEnvelope('openwop.it.route-coverage.get-v1-runs-runid-artifacts-artifactid-for-an-unknown-artifact-returns-a-canonic', res.json, 'rest-endpoints.md error envelope');
  });

  it('POST /v1/webhooks with an invalid URL returns a canonical validation envelope', async () => {
    const res = await driver.post('/v1/webhooks', {
      url: 'not-a-valid-url',
      events: ['run.completed'],
    });

    expect(res.status, req('openwop.it.route-coverage.post-v1-webhooks-with-an-invalid-url-returns-a-canonical-validation-envelope', 
      'api/openapi.yaml operationId=registerWebhook',
      'invalid webhook registration MUST return a 4xx validation response',
    )).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    assertCanonicalErrorEnvelope('openwop.it.route-coverage.post-v1-webhooks-with-an-invalid-url-returns-a-canonical-validation-envelope', res.json, 'rest-endpoints.md error envelope');
  });

  it('DELETE /v1/webhooks/{webhookId} for an unknown subscription returns 204, 404, or 403', async () => {
    const res = await driver.delete('/v1/webhooks/openwop-conformance-missing-webhook');

    expect([204, 403, 404].includes(res.status), req('openwop.it.route-coverage.delete-v1-webhooks-webhookid-for-an-unknown-subscription-returns-204-404-or-403', 
      'api/openapi.yaml operationId=unregisterWebhook',
      'unknown webhook unregister MUST be idempotent 204 or return 404/403',
    )).toBe(true);

    if (res.status !== 204) {
      assertCanonicalErrorEnvelope('openwop.it.route-coverage.delete-v1-webhooks-webhookid-for-an-unknown-subscription-returns-204-404-or-403', res.json, 'rest-endpoints.md error envelope');
    }
  });
});
