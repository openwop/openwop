/**
 * envelope-refusal-shape — RFC 0032 §B.3 runtime behavior (MUST tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`
 * AND `events[]` includes `envelope.refusal`. Non-skippable when both flags
 * are advertised — `envelope.refusal` is one of the two MUST-tier events.
 *
 * Also exercises SECURITY invariant `envelope-refusal-no-prompt-leak`: the
 * host's emit-seam refuses payloads that look like they could carry a
 * credentialRef or prompt-content substring. Production emitters MUST redact
 * BEFORE invoking the seam; the seam's refusal is a defense-in-depth CI gate.
 *
 * Drives the host's `POST /v1/host/sample/test/emit-envelope-reliability`
 * seam with synthetic payloads. The seam validates the per-type required
 * fields per `run-event-payloads.schema.json` §envelope* `$defs` and
 * appends to the test event log. Conformance asserts:
 *   1. The seam accepts a well-formed `envelope.refusal` payload.
 *   2. The seam rejects payloads with `refusalText` containing a
 *      `secret-canary-*` substring (BYOK leak defense).
 *   3. The seam rejects payloads with a top-level `credentialRef` field.
 *   4. Required field absence (`provider` missing) returns 400.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.3 + §G
 * @see RFCS/0033-envelope-completion-contract.md §D + §F
 * @see SECURITY/invariants.yaml envelope-refusal-no-prompt-leak
 * @see schemas/run-event-payloads.schema.json §envelopeRefusal
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: {
      reliability?: {
        supported?: unknown;
        events?: unknown;
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

async function emit(input: Record<string, unknown>): Promise<{ status: number; body: { event?: { type?: string; payload?: Record<string, unknown> }; error?: { code?: string } } }> {
  const res = await driver.post('/v1/host/sample/test/emit-envelope-reliability', input);
  return {
    status: res.status,
    body: res.json as { event?: { type?: string; payload?: Record<string, unknown> }; error?: { code?: string } },
  };
}

describe.skipIf(HTTP_SKIP)('envelope-refusal-shape: seam emission (RFC 0032 §B.3 MUST)', () => {
  it('accepts a well-formed `envelope.refusal` payload + writes it to the test event log', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reliability = d.capabilities?.envelopes?.reliability;
    if (!reliability || reliability.supported !== true) return;
    if (!Array.isArray(reliability.events) || !(reliability.events as unknown[]).includes('envelope.refusal')) return;

    const r = await emit({
      runId: 'conformance-refusal-1',
      type: 'envelope.refusal',
      payload: {
        nodeId: 'writer',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        refusalText: 'I cannot proceed with that request because the safety filter triggered on category X.',
        safetyCategory: 'harmful-content',
      },
      nodeId: 'writer',
    });
    if (r.status === 404) return;
    expect(
      r.status,
      driver.describe(
        'schemas/run-event-payloads.schema.json §envelopeRefusal',
        'a payload with the required {nodeId, provider, model} fields MUST be accepted by the seam',
      ),
    ).toBe(200);
    expect(r.body.event?.type).toBe('envelope.refusal');
    const payload = r.body.event?.payload ?? {};
    expect(payload.nodeId).toBe('writer');
    expect(payload.provider).toBe('anthropic');
    expect(payload.model).toBe('claude-3-5-sonnet');
  });

  it('rejects payloads with `refusalText` containing a `secret-canary-*` substring (BYOK leak defense per envelope-refusal-no-prompt-leak)', async () => {
    const r = await emit({
      runId: 'conformance-refusal-leak',
      type: 'envelope.refusal',
      payload: {
        nodeId: 'writer',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        refusalText: 'The model echoed back secret-canary-leak-test verbatim.',
        safetyCategory: 'harmful-content',
      },
    });
    if (r.status === 404) return;
    expect(
      r.status,
      driver.describe(
        'SECURITY/invariants.yaml §envelope-refusal-no-prompt-leak',
        'envelope.refusal.refusalText MUST be passed through the host BYOK redaction harness; seam refuses payloads carrying secret-canary-* substrings (defense-in-depth CI gate per RFC 0032 §B.3 + §G)',
      ),
    ).toBe(400);
    expect(r.body.error?.code).toBe('envelope_reliability_credential_leak');
  });

  it('rejects payloads with a top-level `credentialRef` field', async () => {
    const r = await emit({
      runId: 'conformance-refusal-credref',
      type: 'envelope.refusal',
      payload: {
        nodeId: 'writer',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        credentialRef: 'secret-byok-abc123', // forbidden
      },
    });
    if (r.status === 404) return;
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('envelope_reliability_credential_leak');
  });

  it('rejects payloads missing required `provider` field', async () => {
    const r = await emit({
      runId: 'conformance-refusal-missing',
      type: 'envelope.refusal',
      payload: {
        nodeId: 'writer',
        // provider intentionally omitted
        model: 'claude-3-5-sonnet',
      },
    });
    if (r.status === 404) return;
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('invalid_argument');
  });
});

describe.skipIf(HTTP_SKIP)('envelope-refusal-shape: advertisement contract (RFC 0032 §C)', () => {
  it('capabilities.envelopes.reliability (when supported: true with non-empty events[]) MUST list both MUST-tier events', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reliability = d.capabilities?.envelopes?.reliability;
    if (!reliability || reliability.supported !== true) return;
    // Hosts running the legacy undifferentiated retry loop advertise
    // `events: []` (per the OPENWOP_ENVELOPE_RELIABILITY_END_TO_END=false
    // operator override). The two MUST-tier events still surface through
    // the test seam in that case; the advertisement-shape MUST applies
    // only when events[] is non-empty.
    if (!Array.isArray(reliability.events) || (reliability.events as unknown[]).length === 0) return;
    expect(
      (reliability.events as unknown[]).includes('envelope.refusal'),
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §C',
        'hosts that advertise reliability.supported: true with non-empty events[] MUST include envelope.refusal (one of the two MUST-tier events per RFC 0032 §C normative text)',
      ),
    ).toBe(true);
    expect(
      (reliability.events as unknown[]).includes('envelope.retry.exhausted'),
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §C',
        'hosts that advertise reliability.supported: true with non-empty events[] MUST also include envelope.retry.exhausted (the other MUST-tier event; both MUSTs land together)',
      ),
    ).toBe(true);
  });
});

describe('envelope-refusal-shape: end-to-end refusal through dispatchStructured', () => {
  it.todo(
    'when an LLM provider returns an explicit refusal (mock provider mockRefusal: true), the host emits exactly one envelope.refusal event AND does NOT retry — promoted when dispatchStructured() wires the safety-stop detection',
  );
  it.todo(
    'node fails with RunSnapshot.error.code = "envelope_refused_by_provider" per RFC 0033 §F',
  );
  it.todo(
    'RunSnapshot.error.message MUST NOT echo the provider\'s refusal text (that surface lives only on the event field, redacted)',
  );
});
