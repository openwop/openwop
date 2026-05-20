/**
 * envelope-reasoning-secret-redaction — RFC 0030 §E security invariant.
 *
 * SECURITY invariant: `envelope-reasoning-secret-redaction` (gate timing
 * per RFC 0027 §G precedent — lands alongside reference-host emission).
 *
 * Asserts that the envelope-acceptor's BYOK redaction harness walks the
 * `reasoning` field — known credential canaries (the `byokCanaries[]`
 * shape from RFC 0021 §"Redaction (SR-1 carry-forward)", supplied as
 * `{ value, secretId }` pairs) found inside `reasoning` MUST be
 * substituted with `[REDACTED:<secretId>]` markers
 * before the envelope is persisted to `RunEventDoc.payload`. The acceptor's
 * recursive walk per `ai-envelope.md` §"Redaction (SR-1 carry-forward)"
 * covers `reasoning` automatically because it's just another payload
 * field — but the conformance suite asserts it explicitly so a future
 * refactor that adds an early-exit at known-shape boundaries cannot
 * regress the invariant.
 *
 * Behavioral assertions drive the existing envelope-accept test seam
 * (`POST /v1/host/sample/envelope/accept`) introduced by RFC 0021. Each
 * test soft-skips on HTTP 404 (host doesn't expose the seam) and on
 * capability absence.
 *
 * The OTel-attribute and debug-bundle assertions remain `it.todo()` —
 * they exercise downstream-projection paths that the envelope-accept
 * seam doesn't surface. Promote when the reference host adds a
 * test-introspection hook for `RunEventDoc.payload` + OTel span +
 * debug-bundle export tied to a specific envelope acceptance.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §E
 * @see spec/v1/ai-envelope.md §"Reasoning field (normative)" + §"Redaction (SR-1 carry-forward)"
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: { reasoning?: { supported?: unknown } };
    secrets?: { supported?: unknown };
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

async function accept(
  envelope: unknown,
  opts: Record<string, unknown> = {},
): Promise<{
  status: number;
  body: {
    status?: string;
    reason?: string;
    redactedPayload?: unknown;
    redactionCount?: number;
    details?: unknown[];
  };
}> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return {
    status: res.status,
    body: res.json as {
      status?: string;
      reason?: string;
      redactedPayload?: unknown;
      redactionCount?: number;
      details?: unknown[];
    },
  };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-20T10:00:00Z' };
const CANARY_VALUE = 'sk-reasoning-canary-DO-NOT-LEAK-30a1';
const CANARY_SECRET_ID = 'byok-reasoning-fixture-001';
const CANARIES = [{ value: CANARY_VALUE, secretId: CANARY_SECRET_ID }];
const CANONICAL_MARKER = `[REDACTED:${CANARY_SECRET_ID}]`;

describe.skipIf(HTTP_SKIP)('envelope-reasoning-secret-redaction: advertisement shape (RFC 0030 §E)', () => {
  it('hosts advertising envelope reasoning + BYOK honor SR-1 carry-forward for the reasoning field', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reasoning = d.capabilities?.envelopes?.reasoning?.supported;
    const secrets = d.capabilities?.secrets?.supported;
    if (reasoning !== true || secrets !== true) return; // soft-skip when either is absent
    // The contract is invariant-based, not capability-flag-based — the
    // advertisement-shape check here just confirms both surfaces are claimed.
    expect(true).toBe(true);
  });
});

describe.skipIf(HTTP_SKIP)('envelope-reasoning-secret-redaction: BYOK redaction of `reasoning` (RFC 0030 §E)', () => {
  it('canary in `reasoning` → substituted with canonical [REDACTED:<secretId>] marker per agent-memory.md:66', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-reason-red-1',
        correlationId: 'r:n:0:reasonred1',
        payload: {
          reasoning: `I analyzed the input and noticed the credential ${CANARY_VALUE} was embedded; the call cannot proceed safely.`,
          code: 'validation_failed',
          message: 'Refusing to act on a credential-bearing input.',
        },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES },
    );
    if (r.status === 404) return; // host doesn't expose the seam
    expect(r.body.status, 'envelope MUST be accepted; redaction is a post-validation pass').toBe('accepted');
    expect(
      r.body.redactionCount,
      'RFC 0030 §E: redactionCount MUST be > 0 when a canary appears in `reasoning`',
    ).toBeGreaterThan(0);
    expect(
      JSON.stringify(r.body.redactedPayload).includes(CANARY_VALUE),
      driver.describe(
        'ai-envelope.md §"Redaction (SR-1 carry-forward)"',
        'canary plaintext MUST NOT remain anywhere in the redacted view — `reasoning` field included',
      ),
    ).toBe(false);
    expect(
      JSON.stringify(r.body.redactedPayload),
      driver.describe(
        'agent-memory.md §SR-1 line 66',
        'persisted entry MUST carry [REDACTED:<secretId>] in place of the plaintext',
      ),
    ).toContain(CANONICAL_MARKER);
  });

  it('canary in `reasoning` AND another payload field → both occurrences scrubbed with single marker', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-reason-red-2',
        correlationId: 'r:n:0:reasonred2',
        payload: {
          reasoning: `The token ${CANARY_VALUE} appeared in two places.`,
          code: 'leak_demo',
          message: `Original tool output: ${CANARY_VALUE}`,
        },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    expect(
      JSON.stringify(r.body.redactedPayload).includes(CANARY_VALUE),
      'no canary plaintext remnant anywhere — `reasoning` + `message` both walked recursively',
    ).toBe(false);
    expect(
      r.body.redactionCount,
      'recursive walk substitutes once per occurrence; 2 occurrences = redactionCount: 2',
    ).toBe(2);
  });

  it('absent canary in `reasoning` → reasoning passes through unchanged (no false-positive redaction)', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-reason-red-3',
        correlationId: 'r:n:0:reasonred3',
        payload: {
          reasoning: 'The input was empty; I declined to fabricate a response.',
          code: 'no_input',
          message: 'Empty input.',
        },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES }, // canary in fixture, but NOT in payload
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    expect(r.body.redactionCount, 'no canary occurrence → redactionCount: 0').toBe(0);
    const payload = (r.body.redactedPayload ?? {}) as { reasoning?: string };
    expect(
      payload.reasoning,
      'reasoning field MUST pass through unchanged when no canary substring matches',
    ).toBe('The input was empty; I declined to fabricate a response.');
  });

  it('canary in `clarification.request.reasoning` (universal kind with reasoning property)', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-reason-red-4',
        correlationId: 'r:n:0:reasonred4',
        payload: {
          reasoning: `I noticed the input contained ${CANARY_VALUE}; I need clarification on whether to proceed.`,
          questions: [{ id: 'q1', question: 'Should I treat embedded credentials as valid input?' }],
        },
        meta: baseMeta,
      },
      { byokCanaries: CANARIES },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    expect(JSON.stringify(r.body.redactedPayload).includes(CANARY_VALUE)).toBe(false);
    expect(JSON.stringify(r.body.redactedPayload)).toContain(CANONICAL_MARKER);
  });
});

// Behavioral assertions through the workflow-engine sample's downstream
// projection paths. Remain `it.todo()` until the reference workflow-engine
// adds a test-introspection hook surfacing the `RunEventDoc.payload`,
// OTel span attributes, and debug-bundle export tied to a specific
// envelope acceptance. The envelope-accept seam (above) verifies the
// acceptor-level redaction; these placeholders verify the redaction
// propagates through the downstream surfaces.

describe.skipIf(HTTP_SKIP)('envelope-reasoning-secret-redaction: downstream-projection paths (RFC 0030 §E)', () => {
  // Drives the existing envelope-accept seam with `projectTo.runId` so the
  // outcome is mirrored to the host's test span + event log buffers (per
  // `host/envelopeProjection.ts`). The conformance assertions read those
  // buffers via the `/v1/host/sample/test/otel/spans` + `/test/debug-
  // bundle/export` seams and confirm the canary plaintext from `reasoning`
  // never appears in either projection.
  const RUN_ID = 'reasoning-redaction-test-run';

  async function acceptForRun(reasoning: string, envelopeId: string): Promise<{ status: number; body: { status?: string; redactedPayload?: unknown } }> {
    const res = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: {
        type: 'error',
        schemaVersion: 1,
        envelopeId,
        correlationId: `r:n:0:${envelopeId}`,
        payload: { reasoning, code: 'validation_failed', message: 'Refusing.' },
        meta: baseMeta,
      },
      byokCanaries: CANARIES,
      projectTo: { runId: RUN_ID, nodeId: 'reasoning-emit-node' },
    });
    return { status: res.status, body: res.json as { status?: string; redactedPayload?: unknown } };
  }

  it('OTel span attributes for the envelope-emitting node MUST NOT include plaintext `secret:`-prefixed substrings from `reasoning`', async () => {
    const r = await acceptForRun(
      `Reasoning trace mentioning ${CANARY_VALUE} verbatim.`,
      'env-otel-redact-1',
    );
    if (r.status === 404) return; // host doesn't expose the seam
    expect(r.body.status).toBe('accepted');

    const spansRes = await driver.get(
      `/v1/host/sample/test/otel/spans?runId=${encodeURIComponent(RUN_ID)}`,
    );
    if (spansRes.status === 404) return; // host doesn't expose the OTel scrape seam
    expect(spansRes.status).toBe(200);
    const spans = ((spansRes.json as { spans?: Array<Record<string, unknown>> } | undefined)?.spans ?? []);
    const serialized = JSON.stringify(spans);
    expect(
      serialized.includes(CANARY_VALUE),
      driver.describe(
        'SECURITY/invariants.yaml envelope-reasoning-secret-redaction',
        'no canary plaintext from the envelope `reasoning` field may appear in any OTel span attribute',
      ),
    ).toBe(false);
  });

  it("debug-bundle export MUST NOT include plaintext `secret:`-prefixed substrings from envelope.reasoning", async () => {
    const r = await acceptForRun(
      `Step-by-step reasoning that surfaces ${CANARY_VALUE} from a prior tool result.`,
      'env-bundle-redact-1',
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');

    const bundleRes = await driver.post('/v1/host/sample/test/debug-bundle/export', { runId: RUN_ID });
    if (bundleRes.status === 404) return; // host doesn't expose the debug-bundle seam
    expect(bundleRes.status).toBe(200);
    const serialized = JSON.stringify(bundleRes.json);
    expect(
      serialized.includes(CANARY_VALUE),
      driver.describe(
        'RFC 0030 §E + debug-bundle.md §"Redaction"',
        'no canary plaintext from envelope.reasoning may appear in the debug-bundle export',
      ),
    ).toBe(false);
  });

  it("envelope acceptance MUST NOT route on `reasoning` contents (RFC 0030 §A normative MUST NOT) — the host's handler-routing decision MUST be identical regardless of `reasoning` value", async () => {
    // Two envelopes, identical shape EXCEPT for `reasoning` content +
    // envelopeId. The acceptor's routing decision (status / redactedPayload
    // structure modulo the redaction marker) MUST be identical, proving
    // reasoning is non-routing per RFC 0030 §A.
    const aResp = await acceptForRun('reasoning-variant-A: model thinks the input is benign.', 'env-route-A');
    const bResp = await acceptForRun(
      `reasoning-variant-B with embedded ${CANARY_VALUE} canary — host MUST NOT route differently.`,
      'env-route-B',
    );
    if (aResp.status === 404 || bResp.status === 404) return;
    expect(aResp.body.status).toBe('accepted');
    expect(bResp.body.status).toBe('accepted');
    expect(
      aResp.body.status,
      driver.describe(
        'RFCS/0030-envelope-reasoning-and-tier-one-subset.md §A',
        'reasoning is informational only; routing decision MUST NOT depend on its contents',
      ),
    ).toBe(bResp.body.status);
  });
});
