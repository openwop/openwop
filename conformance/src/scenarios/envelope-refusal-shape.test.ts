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

// End-to-end refusal through dispatchStructured. Drives the conformance
// `mock` provider with a program returning `stopReason: 'safety'` +
// `refusalText: '...'`; the host's failure-mode-aware retry router
// classifies this as refusal (RFC 0032 §B.3), emits exactly one
// envelope.refusal event, throws envelope_refused_by_provider WITHOUT
// retrying (RFC 0033 §D), and the executor surfaces the error code on
// the RunSnapshot. SECURITY invariant envelope-refusal-no-prompt-leak
// asserts that RunSnapshot.error.message does NOT echo the refusalText.

import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const E2E_FIXTURE = 'conformance-envelope-refusal';
const E2E_NODE_ID = 'structured-call';

interface E2eEvent {
  type: string;
  payload?: Record<string, unknown>;
  nodeId?: string;
  sequence: number;
}

async function programMockRefusal(refusalText: string): Promise<{ status: number }> {
  const res = await driver.post('/v1/host/sample/test/mock-ai/program', {
    nodeId: E2E_NODE_ID,
    program: [{ stopReason: 'safety', refusalText }],
  });
  return { status: res.status };
}

async function runE2eAndRead(): Promise<{ events: E2eEvent[]; terminal: unknown } | null> {
  const create = await driver.post('/v1/runs', { workflowId: E2E_FIXTURE });
  if (create.status !== 201) return null;
  const runId = (create.json as { runId: string }).runId;
  const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
  const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (eventsRes.status !== 200) return null;
  const events = ((eventsRes.json as { events?: E2eEvent[] } | undefined)?.events ?? []) as E2eEvent[];
  return { events, terminal };
}

describe.skipIf(HTTP_SKIP)('envelope-refusal-shape: end-to-end refusal through dispatchStructured', () => {
  it('when mock provider returns stopReason: "safety" with refusalText, host emits exactly one envelope.refusal event AND does NOT retry', async () => {
    if (!isFixtureAdvertised(E2E_FIXTURE)) return;
    const seed = await programMockRefusal('I cannot help with that — safety filter triggered.');
    if (seed.status === 404) return;
    expect(seed.status).toBe(200);

    const result = await runE2eAndRead();
    if (result === null) return;
    const refusals = result.events.filter((e) => e.type === 'envelope.refusal');
    expect(
      refusals.length,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.3',
        'exactly one envelope.refusal event MUST fire on provider safety-stop',
      ),
    ).toBe(1);
    // RFC 0033 §D normative: refusal MUST NOT retry (circumvention concern).
    const retries = result.events.filter((e) => e.type === 'envelope.retry.attempted');
    expect(
      retries.length,
      driver.describe(
        'RFCS/0033-envelope-completion-contract.md §D',
        'host MUST NOT retry after envelope.refusal (refusal is terminal — retrying with prompt mutation creates a circumvention concern)',
      ),
    ).toBe(0);
  });

  it('node fails with RunSnapshot.error.code = "envelope_refused_by_provider" per RFC 0033 §F', async () => {
    if (!isFixtureAdvertised(E2E_FIXTURE)) return;
    const seed = await programMockRefusal('Refusal text for terminal-error-code assertion.');
    if (seed.status === 404) return;

    const result = await runE2eAndRead();
    if (result === null) return;
    const code = (result.terminal as { error?: { code?: string } }).error?.code;
    expect(
      code,
      driver.describe(
        'RFCS/0033-envelope-completion-contract.md §F',
        'refusal-driven failure MUST surface as RunSnapshot.error.code = envelope_refused_by_provider',
      ),
    ).toBe('envelope_refused_by_provider');
  });

  it('RunSnapshot.error.message MUST NOT echo the providers refusal text (SECURITY invariant envelope-refusal-no-prompt-leak)', async () => {
    if (!isFixtureAdvertised(E2E_FIXTURE)) return;
    // A distinctive refusal text so the message-no-echo assertion has
    // a unique substring to scan for. Production refusal texts may
    // contain prompt content; the host MUST keep it off the error
    // message surface (event log only, scrubbed via SR-1).
    const REFUSAL_TEXT = 'REFUSAL-CANARY-A8F3-do-not-echo-this-substring-into-RunSnapshot.error.message';
    const seed = await programMockRefusal(REFUSAL_TEXT);
    if (seed.status === 404) return;

    const result = await runE2eAndRead();
    if (result === null) return;
    const message = (result.terminal as { error?: { message?: string } }).error?.message ?? '';
    expect(
      message.includes(REFUSAL_TEXT),
      driver.describe(
        'SECURITY/invariants.yaml §envelope-refusal-no-prompt-leak',
        'RunSnapshot.error.message MUST NOT echo refusalText — the safety-filter text may contain prompt content; spec-compliant emission carries it only on the envelope.refusal event payload (subject to SR-1 redaction at the eventLog.append boundary)',
      ),
    ).toBe(false);
  });
});
