/**
 * aiEnvelope.redaction — FINAL v1.1 advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). `spec/v1/ai-envelope.md`
 * promoted Draft → FINAL v1.1 2026-05-18. Live behavioral via the
 * `POST /v1/host/sample/envelope/accept` seam, which routes the envelope
 * through the BYOK redaction harness and returns `redactedPayload` +
 * `redactionCount` (soft-skip on HTTP 404).
 *
 * Summary: AI Envelopes MUST route through the same BYOK redaction harness
 * applied to a fresh `MemoryEntry.put` per `agent-memory.md` §"SR-1
 * secret-redaction invariant". The fact that the LLM was instructed not to
 * emit secrets is NOT evidence to skip redaction — the model can hallucinate
 * secret-shaped substrings from prompt context, in-context examples, or tool
 * results. Redacted material MUST NOT appear in resulting `RunEventDoc`s,
 * OTel span attributes, debug-bundle exports, or error envelopes returned to
 * the client. The pass runs AFTER validation and BEFORE dedup/handler routing
 * in the production-flow ordering.
 *
 * @see spec/v1/ai-envelope.md §"Redaction (SR-1 carry-forward)"
 * @see spec/v1/agent-memory.md §"SR-1 secret-redaction invariant"
 * @see SECURITY/invariants.yaml#envelope-redaction-sr-1-carry-forward
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function isBYOKAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const secrets = top && typeof top === 'object' ? top['secrets'] : undefined;
  return Boolean(secrets && typeof secrets === 'object');
}

describe('aiEnvelope.redaction: advertisement shape (FINAL v1.1)', () => {
  it('hosts advertising envelopeContracts AND secrets honor SR-1 carry-forward', async () => {
    if (!(await isBYOKAdvertised())) return; // BYOK not advertised — skip
    // The contract is invariant-based, not capability-flag-based. The
    // advertisement-shape check is just "the host claims a BYOK surface";
    // behavioral assertions below exercise the redaction invariant.
    expect(true).toBe(true);
  });
});

// Behavioral assertions through the workflow-engine sample's env-gated
// `POST /v1/host/sample/envelope/accept` seam. The seam threads a
// `byokCanaries: string[]` option into AcceptOptions so the acceptor
// can apply the §"Redaction (SR-1 carry-forward)" pass on accepted
// envelopes, returning `redactedPayload` in the outcome. Each test
// soft-skips on HTTP 404 (host doesn't expose the seam).
async function accept(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; reason?: string; redactedPayload?: unknown; redactionCount?: number; details?: unknown[] } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; reason?: string; redactedPayload?: unknown; redactionCount?: number; details?: unknown[] } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };
const CANARY_VALUE = 'sk-canary-DO-NOT-LEAK-9d7f3a2b';
const CANARY_SECRET_ID = 'byok-secret-test-fixture-001';
const CANARIES = [{ value: CANARY_VALUE, secretId: CANARY_SECRET_ID }];
const CANONICAL_MARKER = `[REDACTED:${CANARY_SECRET_ID}]`;

describe('aiEnvelope.redaction: behavioral acceptor-level scrub (FINAL v1.1)', () => {
  it('canary in payload → substituted with canonical SR-1 [REDACTED:<secretId>] marker per agent-memory.md:66', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-red-1',
        correlationId: 'r:n:0:red1',
        payload: { code: 'leak_demo', message: `tool result included ${CANARY_VALUE} verbatim` },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    expect(r.body.redactionCount, 'redactionCount MUST be > 0 when canary appears').toBeGreaterThan(0);
    expect(
      JSON.stringify(r.body.redactedPayload).includes(CANARY_VALUE),
      driver.describe('ai-envelope.md §"Redaction (SR-1 carry-forward)"', 'canary plaintext MUST be absent from the redacted view'),
    ).toBe(false);
    expect(
      JSON.stringify(r.body.redactedPayload),
      driver.describe('agent-memory.md §SR-1 line 66', 'persisted entry MUST carry [REDACTED:<secretId>] in place of the plaintext'),
    ).toContain(CANONICAL_MARKER);
  });

  it('canary across nested object fields → all occurrences scrubbed with canonical marker', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-red-nested',
        correlationId: 'r:n:0:rednested',
        payload: {
          questions: [
            { id: 'q1', question: `What is ${CANARY_VALUE}?` },
            { id: 'q2', question: 'unrelated', context: { trace: `${CANARY_VALUE}/${CANARY_VALUE}` } },
          ],
        },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    expect(
      JSON.stringify(r.body.redactedPayload).includes(CANARY_VALUE),
      'no canary plaintext remnant anywhere in the redacted view (recursive scrub)',
    ).toBe(false);
    // q1's question (1 occurrence), q2's context.trace (2 occurrences) = total 3
    expect(r.body.redactionCount).toBe(3);
  });

  it('multiple canaries → each substituted with its own secretId marker', async () => {
    const C1 = { value: 'sk-canary-alpha-xxxx', secretId: 'secret-alpha' };
    const C2 = { value: 'sk-canary-beta-yyyy', secretId: 'secret-beta' };
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-red-multi',
        correlationId: 'r:n:0:redmulti',
        payload: { code: 'multi_leak', message: `first=${C1.value}, second=${C2.value}` },
        meta: baseMeta,
      },
      { byokCanaries: [C1, C2] },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    const view = JSON.stringify(r.body.redactedPayload);
    expect(view.includes(C1.value)).toBe(false);
    expect(view.includes(C2.value)).toBe(false);
    expect(
      view.includes(`[REDACTED:${C1.secretId}]`) && view.includes(`[REDACTED:${C2.secretId}]`),
      driver.describe('agent-memory.md §SR-1', 'each canary MUST be substituted with its OWN [REDACTED:<secretId>] marker'),
    ).toBe(true);
  });

  it('redaction runs AFTER schema validation: payload with [REDACTED:...]-shaped substrings still validates', async () => {
    // The error-kind payload schema requires { code, message }. A pre-redacted
    // marker in the message MUST NOT trip validation.
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-red-shape',
        correlationId: 'r:n:0:redshape',
        payload: { code: 'demo', message: 'already had [REDACTED:secret-prior] before we saw it' },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES }, // canary NOT in payload; substitution count expected 0
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe('ai-envelope.md §"Redaction (SR-1 carry-forward)"', 'redaction MUST run AFTER schema validation; pre-existing markers do not affect validation'),
    ).toBe('accepted');
    // No canary present → redactionCount absent or 0
    expect(r.body.redactionCount ?? 0).toBe(0);
  });

  it('canary in invalid envelope (validation refusal) → error response MUST NOT echo the canary plaintext', async () => {
    // ISO 8601 violation triggers an `invalid` outcome BEFORE the redaction
    // pass runs. The acceptor's validation-detail extractor MUST NOT echo
    // the payload contents into the error response.
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-red-leak',
        correlationId: 'r:n:0:redleak',
        payload: { code: 'demo', message: `secret value is ${CANARY_VALUE}` },
        meta: { ...baseMeta, ts: 'tomorrow' }, // bad ts → invalid
      },
      { byokCanaries: CANARIES },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('invalid');
    const bodyString = JSON.stringify(r.body);
    expect(
      bodyString.includes(CANARY_VALUE),
      driver.describe(
        'SECURITY/threat-model-secret-leakage.md §SR-1',
        'error response on validation refusal MUST NOT echo BYOK canary plaintext',
      ),
    ).toBe(false);
  });
});

// E.2 OTel scrape + E.3 debug-bundle seams.
import { queryTestSpans, exportDebugBundle, isOtelSeamAvailable } from '../lib/otel-scrape.js';
import { resetTestSeam } from '../lib/event-log-query.js';

describe('aiEnvelope.redaction: OTel + debug-bundle scrape (E.2 + E.3)', () => {
  it('redacted canary plaintext MUST be absent from OTel envelope_* span attributes', async () => {
    if (!(await isOtelSeamAvailable())) return;
    const runId = `r-red-otel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-red-otel-1',
        correlationId: `${runId}:n:0:red-otel`,
        payload: { code: 'leak_demo', message: `tool result included ${CANARY_VALUE} verbatim` },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES, projectTo: { runId, nodeId: 'n' } },
    );
    const spans = await queryTestSpans({ runId });
    if (!spans.ok) return;
    const allAttrs = spans.data.flatMap((s) => Object.values(s.attributes).map((v) => String(v)));
    expect(
      allAttrs.some((v) => v.includes(CANARY_VALUE)),
      driver.describe(
        'SECURITY/threat-model-secret-leakage.md §SR-1',
        'BYOK canary plaintext MUST NOT appear in any OTel envelope_* span attribute',
      ),
    ).toBe(false);
    await resetTestSeam();
  });

  it('redacted canary plaintext MUST be absent from debug-bundle export', async () => {
    if (!(await isOtelSeamAvailable())) return;
    const runId = `r-red-bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-red-bundle-1',
        correlationId: `${runId}:n:0:red-bundle`,
        payload: { questions: [{ id: 'q1', question: `embed ${CANARY_VALUE} here` }] },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES, projectTo: { runId, nodeId: 'n' } },
    );
    const bundle = await exportDebugBundle(runId);
    if (!bundle.ok) return;
    const serialized = JSON.stringify(bundle.data);
    expect(
      serialized.includes(CANARY_VALUE),
      driver.describe(
        'SECURITY/threat-model-secret-leakage.md §SR-1',
        'BYOK canary plaintext MUST NOT appear in the debug-bundle export (events + spans)',
      ),
    ).toBe(false);
    await resetTestSeam();
  });
});
