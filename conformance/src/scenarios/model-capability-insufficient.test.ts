/**
 * model-capability-insufficient — RFC 0031 §B step 4 + §D runtime behavior.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true`.
 * Drives the host's `POST /v1/host/sample/test/evaluate-model-capability-gate`
 * seam through the refusal branches of the §B 4-step dispatch flow.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4 + §D
 * @see schemas/run-event-payloads.schema.json §modelCapabilityInsufficient
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface GateResponse {
  outcome?: {
    route?: 'dispatch' | 'substitute' | 'refuse';
    missingCapabilities?: string[];
    fallbackAttempted?: boolean;
  };
  event?: { type?: string; payload?: Record<string, unknown> } | null;
}

async function evaluateGate(input: Record<string, unknown>): Promise<{ status: number; body: GateResponse }> {
  const res = await driver.post('/v1/host/sample/test/evaluate-model-capability-gate', input);
  return { status: res.status, body: res.json as GateResponse };
}

describe.skipIf(HTTP_SKIP)('model-capability-insufficient: dispatch refusal (RFC 0031 §B step 4 + §D)', () => {
  it('unmet + NO fallbackModel declared → refuse with fallbackAttempted: false', async () => {
    const r = await evaluateGate({
      module: { requiredModelCapabilities: ['structured-output', 'reasoning'] },
      // no fallbackModel
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['unknown-vendor'],
      nodeId: 'editor-node',
    });
    if (r.status === 404) return softSkip('blocked', 'precondition not met — `r.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(
      r.body.outcome?.route,
      req('openwop.it.model-capability-insufficient.unmet-no-fallbackmodel-declared-refuse-with-fallbackattempted-false', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4',
        'unmet capability + no fallbackModel declared → host MUST refuse',
      ),
    ).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      req('openwop.it.model-capability-insufficient.unmet-no-fallbackmodel-declared-refuse-with-fallbackattempted-false', 
        'schemas/run-event-payloads.schema.json §modelCapabilityInsufficient',
        'fallbackAttempted MUST be false when no fallbackModel was declared on the NodeModule',
      ),
    ).toBe(false);
    expect(
      r.body.event?.type,
      req('openwop.it.model-capability-insufficient.unmet-no-fallbackmodel-declared-refuse-with-fallbackattempted-false', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §D',
        'refuse path MUST emit `model.capability.insufficient` BEFORE the node failure',
      ),
    ).toBe('model.capability.insufficient');
    const payload = (r.body.event?.payload ?? {}) as Record<string, unknown>;
    expect(payload.nodeId).toBe('editor-node');
    expect(payload.provider).toBe('unknown-vendor');
    expect(payload.fallbackAttempted).toBe(false);
    expect(Array.isArray(payload.missingCapabilities)).toBe(true);
  });

  it('unmet + fallback declared but provider NOT in supportedProviders → refuse with fallbackAttempted: true', async () => {
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        fallbackModel: { provider: 'unauthenticated-vendor', model: 'foo' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      // Fallback's provider is NOT in supportedProviders — host cannot
      // authenticate per RFC 0031 §B step 3 final clause.
      supportedProviders: ['anthropic', 'unknown-vendor'],
    });
    if (r.status === 404) return softSkip('blocked', 'precondition not met — `r.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(r.body.outcome?.route).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      req('openwop.it.model-capability-insufficient.unmet-fallback-declared-but-provider-not-in-supportedproviders-refuse-with-fallb', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §B step 3',
        'fallback provider NOT in capabilities.aiProviders.supported[] → host cannot authenticate → fallbackAttempted MUST be true (the attempt failed at credential resolution)',
      ),
    ).toBe(true);
    expect(r.body.event?.type).toBe('model.capability.insufficient');
  });

  it('unmet + substitutionSupported: false (host posture) → refuse with fallbackAttempted: false', async () => {
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        fallbackModel: { provider: 'anthropic', model: 'claude-opus-4-7' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: false,
      supportedProviders: ['anthropic', 'unknown-vendor'],
    });
    if (r.status === 404) return softSkip('blocked', 'precondition not met — `r.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(r.body.outcome?.route).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      req('openwop.it.model-capability-insufficient.unmet-substitutionsupported-false-host-posture-refuse-with-fallbackattempted-fal', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §E',
        'capabilities.modelCapabilities.substitutionSupported: false → host MUST NOT attempt fallback even when NodeModule.fallbackModel is declared → fallbackAttempted MUST be false (no attempt was made)',
      ),
    ).toBe(false);
  });

  it('recursive fallback NOT permitted — fallback that itself fails capability check → refuse with fallbackAttempted: true', async () => {
    // Construct a scenario where fallback's provider is in supportedProviders
    // BUT the fallback provider itself doesn't advertise the required capability.
    // The probe map's 'unknown-vendor-2' has empty capabilities; the gate
    // refuses with fallbackAttempted: true (RFC 0031 §"Unresolved questions" #3).
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        fallbackModel: { provider: 'unknown-vendor-2', model: 'fallback-model' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['unknown-vendor', 'unknown-vendor-2'],
    });
    if (r.status === 404) return softSkip('blocked', 'precondition not met — `r.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(r.body.outcome?.route).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      req('openwop.it.model-capability-insufficient.recursive-fallback-not-permitted-fallback-that-itself-fails-capability-check-ref', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §"Unresolved questions" #3',
        'recursive fallback NOT permitted — when the declared fallback model itself fails the capability check, host MUST refuse with fallbackAttempted: true (NOT chain to another fallback)',
      ),
    ).toBe(true);
  });
});

// End-to-end pipeline: a fixture-declared workflow whose only node carries a
// NodeModule with `requiredModelCapabilities: ['nonexistent-capability-9b3f']`
// (registered as `conformance.modelCapability.insufficient` on the reference
// host). The executor's model-capability gate at dispatch time refuses with
// `capability_not_provided` AND emits `model.capability.insufficient` into
// the run event log per RFC 0031 §D. Capability-gated AND fixture-gated:
// soft-skips when either is absent.

import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const E2E_FIXTURE = 'conformance-model-capability-insufficient';

describe.skipIf(HTTP_SKIP)('model-capability-insufficient: end-to-end refusal through executor', () => {
  it('workflow with a node declaring requiredModelCapabilities the active provider does not satisfy fails with RunSnapshot.error.code = "capability_not_provided" AND emits model.capability.insufficient into the run event log BEFORE node.failed', async () => {
    if (!isFixtureAdvertised(E2E_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(E2E_FIXTURE)` returned early (fixture not seeded — soft-skip)'); // fixture not seeded — soft-skip

    const create = await driver.post('/v1/runs', { workflowId: E2E_FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status).toBe('failed');
    expect(
      (terminal as { error?: { code?: string } }).error?.code,
      req('openwop.it.model-capability-insufficient.workflow-with-a-node-declaring-requiredmodelcapabilities-the-active-provider-doe', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4',
        'unmet capability without viable fallback MUST fail with error.code = "capability_not_provided"',
      ),
    ).toBe('capability_not_provided');

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: Array<{ type: string }> } | undefined)?.events ?? []);
    const insufficientIdx = events.findIndex((e) => e.type === 'model.capability.insufficient');
    const nodeFailedIdx = events.findIndex((e) => e.type === 'node.failed');
    expect(insufficientIdx, req('openwop.it.model-capability-insufficient.workflow-with-a-node-declaring-requiredmodelcapabilities-the-active-provider-doe', 'RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4', 'model.capability.insufficient MUST appear in the event log')).toBeGreaterThanOrEqual(0);
    expect(nodeFailedIdx, req('openwop.it.model-capability-insufficient.workflow-with-a-node-declaring-requiredmodelcapabilities-the-active-provider-doe', 'RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4', 'node.failed MUST appear in the event log')).toBeGreaterThanOrEqual(0);
    expect(
      insufficientIdx < nodeFailedIdx,
      req('openwop.it.model-capability-insufficient.workflow-with-a-node-declaring-requiredmodelcapabilities-the-active-provider-doe', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §D',
        'model.capability.insufficient MUST be emitted BEFORE node.failed (cause precedes effect)',
      ),
    ).toBe(true);
  });

  it('NO envelope emission occurs after the refusal (no node.completed, provider.usage, or envelope-reliability events)', async () => {
    if (!isFixtureAdvertised(E2E_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(E2E_FIXTURE)` returned early (fixture not seeded — soft-skip)'); // fixture not seeded — soft-skip

    const create = await driver.post('/v1/runs', { workflowId: E2E_FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const events = ((eventsRes.json as { events?: Array<{ type: string }> } | undefined)?.events ?? []);
    const forbidden = [
      'node.completed',
      'provider.usage',
      'envelope.retry.attempted',
      'envelope.retry.exhausted',
      'envelope.refusal',
      'envelope.truncated',
      'envelope.nlToFormat.engaged',
      'envelope.recovery.applied',
    ];
    const leaked = events.filter((e) => forbidden.includes(e.type)).map((e) => e.type);
    expect(
      leaked,
      req('openwop.it.model-capability-insufficient.no-envelope-emission-occurs-after-the-refusal-no-node-completed-provider-usage-o', 
        'RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4',
        'a refused dispatch MUST NOT emit any downstream envelope-emission events — the node never ran',
      ),
    ).toEqual([]);
  });
});
