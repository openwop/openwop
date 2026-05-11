/**
 * Error envelope shape — every non-2xx response MUST share the same
 * `{error, message, details?}` JSON shape. Per rest-endpoints.md.
 *
 * We exercise a few intentional failure paths and verify each error
 * response has the correct envelope.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface ErrorEnvelope {
  error: unknown;
  message: unknown;
  details?: unknown;
  [key: string]: unknown;
}

function assertErrorEnvelope(body: unknown, specSection: string): void {
  expect(typeof body, driver.describe(specSection, 'error response MUST be a JSON object')).toBe(
    'object',
  );
  const env = body as ErrorEnvelope;

  expect(typeof env.error, driver.describe(
    specSection,
    'error envelope MUST include `error` (machine-readable string)',
  )).toBe('string');

  expect(typeof env.message, driver.describe(
    specSection,
    'error envelope MUST include `message` (human-readable string)',
  )).toBe('string');

  if (env.details !== undefined) {
    expect(typeof env.details, driver.describe(
      specSection,
      'error envelope `details` (when present) MUST be a JSON object',
    )).toBe('object');
    expect(env.details, driver.describe(
      specSection,
      'error envelope `details` (when present) MUST NOT be null',
    )).not.toBeNull();
  }

  // schemas/error-envelope.schema.json declares `additionalProperties: false`.
  // Top-level body keys MUST be exactly some subset of {error, message, details}.
  // Hosts that emit extras at the top level (correlationId, hint, requestId, etc.)
  // violate the schema. The canonical home for contextual data is `details`.
  const allowedKeys = new Set(['error', 'message', 'details']);
  const extraneousKeys = Object.keys(env as Record<string, unknown>).filter(
    (k) => !allowedKeys.has(k),
  );
  expect(extraneousKeys, driver.describe(
    'schemas/error-envelope.schema.json (additionalProperties:false)',
    `error envelope MUST NOT have keys outside {error, message, details}; extraneous: [${extraneousKeys.join(', ')}]`,
  )).toEqual([]);
}

/**
 * Assert correlationId convention per spec/v1/rest-endpoints.md §error-envelope.
 * When a host issues a server-side trace ID for a 5xx, it goes under
 * `details.correlationId` (the contextual-data slot), NEVER at the top level.
 * RECOMMENDED, not REQUIRED — hosts that don't emit trace IDs are still
 * conformant. This helper just pins the placement.
 */
function assertCorrelationIdShape(body: unknown, specSection: string): void {
  const env = body as ErrorEnvelope;
  // Top-level correlationId would be a spec violation; the assertErrorEnvelope
  // additionalProperties check above catches it. This helper additionally
  // pins the type when present under details.
  if (env.details && typeof env.details === 'object') {
    const det = env.details as Record<string, unknown>;
    if (det.correlationId !== undefined) {
      expect(typeof det.correlationId, driver.describe(
        specSection,
        'when present, details.correlationId MUST be a string',
      )).toBe('string');
      expect((det.correlationId as string).length, driver.describe(
        specSection,
        'details.correlationId MUST be a non-empty string',
      )).toBeGreaterThan(0);
    }
  }
}

describe('errors: 404 envelope', () => {
  it('GET /v1/runs/{nonexistentId} returns canonical envelope', async () => {
    const res = await driver.get('/v1/runs/openwop-conformance-this-run-id-does-not-exist');

    expect(
      [403, 404].includes(res.status),
      driver.describe('rest-endpoints.md', 'unknown run MUST return 404 (or 403 if leaking existence is forbidden)'),
    ).toBe(true);

    assertErrorEnvelope(res.json, 'rest-endpoints.md error envelope');
    assertCorrelationIdShape(res.json, 'rest-endpoints.md §error-envelope');
  });
});

describe('errors: 400 envelope (validation)', () => {
  it('POST /v1/runs with empty body returns canonical envelope', async () => {
    const res = await driver.post('/v1/runs', {});

    // 400 is canonical, but some servers may return 422; accept either as
    // long as the envelope is correct. The point of this test is the shape,
    // not the status code.
    expect(
      res.status,
      driver.describe('rest-endpoints.md', 'malformed POST /v1/runs MUST return 4xx'),
    ).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    assertErrorEnvelope(res.json, 'rest-endpoints.md error envelope');
    assertCorrelationIdShape(res.json, 'rest-endpoints.md §error-envelope');
  });
});

describe('errors: details.correlationId placement convention', () => {
  it('correlationId (when emitted on 5xx) MUST be in details, never top-level', async () => {
    // We can't easily induce a 5xx from a black-box client, but we CAN
    // verify the structural constraint on every error envelope returned
    // throughout the suite: `correlationId` at the top level is a
    // schema violation per `additionalProperties: false`. The
    // additionalProperties check in assertErrorEnvelope catches that.
    // This test provides a focused recap so the convention is
    // explicitly named in the suite.
    //
    // Hosts MAY omit correlationId entirely (it's RECOMMENDED, not
    // REQUIRED). This scenario passes against any host that conforms.
    const res = await driver.get('/v1/runs/openwop-conformance-correlation-probe-' + Date.now());
    expect(
      [400, 403, 404].includes(res.status),
      driver.describe('rest-endpoints.md', 'unknown run returns 4xx envelope'),
    ).toBe(true);
    const body = res.json as Record<string, unknown>;
    expect(body, driver.describe('rest-endpoints.md', 'response MUST be a JSON object')).toBeDefined();
    // The structural constraint: no top-level correlationId.
    expect(body.correlationId, driver.describe(
      'spec/v1/rest-endpoints.md §error-envelope (correlationId convention)',
      'correlationId MUST NOT appear at the top level of the error envelope; canonical home is `details.correlationId`',
    )).toBeUndefined();
  });
});
