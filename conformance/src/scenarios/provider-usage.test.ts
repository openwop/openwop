/**
 * RFC 0026 — `provider.usage` event conformance.
 *
 * Verifies the new optional event type added to `RunEventType` per RFC
 * 0026. The event MUST fire after every LLM provider invocation,
 * carrying per-call token counts + optional cost estimate. Three
 * describe blocks:
 *
 *   1. Advertisement shape (`capabilities.providerUsage` block).
 *   2. Schema round-trip (positive + negative fixtures).
 *   3. Event presence + shape via the test-only emit seam +
 *      event-log query seam (Thread E.1).
 *
 * Each describe block soft-skips when the host doesn't expose the
 * relevant seam OR the matching capability isn't advertised.
 *
 * @see RFCS/0026-provider-usage-event.md
 * @see schemas/run-event-payloads.schema.json#/$defs/providerUsage
 * @see SECURITY/invariants.yaml#provider-usage-no-credential-leak
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode } from '../lib/error-envelope.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  capabilities?: {
    providerUsage?: { supported?: boolean; costEstimates?: boolean; currency?: string };
  };
}

async function readProviderUsageCap(): Promise<{ supported?: boolean; costEstimates?: boolean; currency?: string } | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const cap = capabilityFamily(body, 'providerUsage');
  return cap && typeof cap === 'object' ? cap : null;
}

describe('provider-usage: capability advertisement (RFC 0026 §E)', () => {
  it('capabilities.providerUsage is either absent or a well-formed object', async () => {
    const cap = await readProviderUsageCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe('RFC 0026 §E', 'capabilities.providerUsage.supported MUST be a boolean when the block is present'),
    ).toBe('boolean');
    if (cap.costEstimates !== undefined) {
      expect(
        typeof cap.costEstimates,
        driver.describe('RFC 0026 §E', 'capabilities.providerUsage.costEstimates MUST be a boolean when present'),
      ).toBe('boolean');
    }
    if (cap.currency !== undefined) {
      expect(
        /^[A-Z]{3}$/.test(cap.currency),
        driver.describe('RFC 0026 §E', 'capabilities.providerUsage.currency MUST be a 3-letter uppercase ISO 4217 code when present'),
      ).toBe(true);
    }
  });
});

describe('provider-usage: schema round-trip (RFC 0026 §A)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  // Load full payloads schema so internal $refs resolve.
  const payloadsDoc = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'run-event-payloads.schema.json'), 'utf8')) as Record<string, unknown>;
  const providerUsageDef = (payloadsDoc.$defs as Record<string, unknown>).providerUsage as Record<string, unknown>;
  const validate = ajv.compile(providerUsageDef);

  it('positive fixture validates', () => {
    const ok = validate({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      inputTokens: 145,
      outputTokens: 312,
      totalTokens: 457,
      costEstimateUsd: 0.005115,
      currency: 'USD',
      cacheHit: false,
      nodeId: 'chat-respond',
    });
    expect(ok, `positive fixture MUST validate; errors: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('negative fixture (missing required field) MUST be rejected', () => {
    const ok = validate({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      inputTokens: 100,
      // outputTokens missing — required per §A
    });
    expect(
      ok,
      driver.describe('RFC 0026 §A', 'payload missing required `outputTokens` MUST fail schema validation'),
    ).toBe(false);
  });

  it('negative fixture (additionalProperties — credentialRef leak) MUST be rejected', () => {
    const ok = validate({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      inputTokens: 100,
      outputTokens: 50,
      credentialRef: 'secret:tenant:byok-anthropic:v1', // banned — additionalProperties:false
    });
    expect(
      ok,
      driver.describe('RFC 0026 §D', 'additionalProperties:false MUST reject credentialRef-shaped fields per provider-usage-no-credential-leak'),
    ).toBe(false);
  });

  it('negative fixture (non-integer token count) MUST be rejected', () => {
    const ok = validate({
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 100.5, // non-integer
      outputTokens: 50,
    });
    expect(ok, 'inputTokens MUST be integer per §A').toBe(false);
  });
});

describe('provider-usage: event presence via emit-seam + event-log query (RFC 0026 §B)', () => {
  it('emit-seam projects exactly one provider.usage event with required fields populated', async () => {
    if (!(await isEventLogSeamAvailable())) return; // E.1 seam not exposed — soft-skip
    const runId = `r-pu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const correlationId = `${runId}:node-1:turn-0:pu-1`;
    const payload = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      nodeId: 'node-1',
    };
    const emit = await driver.post('/v1/host/sample/test/emit-provider-usage', { runId, payload, correlationId, nodeId: 'node-1' });
    if (emit.status === 404) return; // emit seam not exposed
    expect(emit.status).toBe(200);

    const events = await queryTestEvents(runId, { type: 'provider.usage' });
    if (!events.ok) return;
    expect(
      events.events.length,
      driver.describe('RFC 0026 §B', 'emit-seam MUST project exactly one provider.usage event'),
    ).toBe(1);
    const e = events.events[0]!;
    expect(e.payload.provider).toBe('anthropic');
    expect(e.payload.model).toBe('claude-3-5-sonnet-20240620');
    expect(e.payload.inputTokens).toBe(200);
    expect(e.payload.outputTokens).toBe(80);
    expect(e.causationId).toBe(correlationId);
    expect(e.nodeId).toBe('node-1');
    await resetTestSeam();
  });

  it('emit-seam refuses payloads containing credentialRef-shaped content (provider-usage-no-credential-leak invariant)', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-pu-leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Inject a credentialRef-shaped field via a synthetic payload that
    // contains 'secret:' in a string field. The seam's defense-in-depth
    // check MUST refuse — even though the production emitter's schema
    // validation would also catch this via additionalProperties:false.
    const res = await driver.post('/v1/host/sample/test/emit-provider-usage', {
      runId,
      payload: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20240620',
        inputTokens: 100,
        outputTokens: 50,
        nodeId: 'secret:tenant:byok-anthropic:v1', // banned content
      },
    });
    if (res.status === 404) return;
    expect(
      res.status,
      driver.describe('SECURITY/invariants.yaml provider-usage-no-credential-leak', 'payload with credentialRef-shaped content MUST be refused'),
    ).toBe(400);
    expect(readErrorCode(res.json)).toBe('provider_usage_credential_leak');
    await resetTestSeam();
  });
});
