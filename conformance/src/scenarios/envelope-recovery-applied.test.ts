/**
 * envelope-recovery-applied — RFC 0032 §B.6 runtime behavior (MAY tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`
 * AND `events[]` includes `envelope.recovery.applied`. Soft-skip cleanly on
 * hosts that don't implement lenient parsing.
 *
 * Also exercises SECURITY invariant `envelope-recovery-no-content-leak`:
 * the seam refuses payloads with any field outside the closed schema
 * (`{nodeId, path, byteOffset?}`) so a future regression that adds a
 * `recoveredContent` field (or any other carrier of pre-recovery output)
 * fails fast at the CI gate.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.6 + §G
 * @see SECURITY/invariants.yaml envelope-recovery-no-content-leak
 * @see schemas/run-event-payloads.schema.json §envelopeRecoveryApplied
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

async function emit(input: Record<string, unknown>): Promise<{
  status: number;
  body: { event?: { type?: string; payload?: Record<string, unknown> }; error?: { code?: string } };
}> {
  const res = await driver.post('/v1/host/sample/test/emit-envelope-reliability', input);
  return {
    status: res.status,
    body: res.json as { event?: { type?: string; payload?: Record<string, unknown> }; error?: { code?: string } },
  };
}

describe.skipIf(HTTP_SKIP)('envelope-recovery-applied: seam emission (RFC 0032 §B.6)', () => {
  it('accepts a well-formed `envelope.recovery.applied` payload with markdown-fence path', async () => {
    const r = await emit({
      runId: 'conformance-recovery-1',
      type: 'envelope.recovery.applied',
      payload: {
        nodeId: 'writer',
        path: 'markdown-fence',
        byteOffset: 42,
      },
    });
    if (r.status === 404) return;
    expect(r.status).toBe(200);
    expect(r.body.event?.type).toBe('envelope.recovery.applied');
    expect(r.body.event?.payload?.path).toBe('markdown-fence');
    expect(r.body.event?.payload?.byteOffset).toBe(42);
  });

  it('accepts each spec-reserved `path` enum value', async () => {
    for (const path of ['direct', 'jsonrepair', 'markdown-fence', 'brace-walker', 'custom']) {
      const r = await emit({
        runId: `conformance-recovery-path-${path}`,
        type: 'envelope.recovery.applied',
        payload: { nodeId: 'writer', path },
      });
      if (r.status === 404) return;
      expect(r.status, `path: ${path} MUST be accepted`).toBe(200);
      expect(r.body.event?.payload?.path).toBe(path);
    }
  });
});

describe.skipIf(HTTP_SKIP)('envelope-recovery-applied: SECURITY invariant envelope-recovery-no-content-leak', () => {
  it('rejects payloads carrying a `recoveredContent` field (pre-recovery output MUST NOT appear in the event)', async () => {
    const r = await emit({
      runId: 'conformance-recovery-leak',
      type: 'envelope.recovery.applied',
      payload: {
        nodeId: 'writer',
        path: 'markdown-fence',
        recoveredContent: 'this is the pre-recovery output that should NOT be in the event', // forbidden per §G
      },
    });
    if (r.status === 404) return;
    expect(
      r.status,
      'SECURITY invariant envelope-recovery-no-content-leak: seam MUST refuse payloads carrying pre-recovery output substrings',
    ).toBe(400);
    expect(r.body.error?.code).toBe('envelope_recovery_content_leak');
  });

  it('rejects payloads carrying any extra field outside {nodeId, path, byteOffset}', async () => {
    const r = await emit({
      runId: 'conformance-recovery-extra',
      type: 'envelope.recovery.applied',
      payload: {
        nodeId: 'writer',
        path: 'markdown-fence',
        sourceSnippet: 'arbitrary extra key', // forbidden by additionalProperties: false in the schema
      },
    });
    if (r.status === 404) return;
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('envelope_recovery_content_leak');
  });
});

describe('envelope-recovery-applied: end-to-end through the envelope-validation pipeline', () => {
  it.todo(
    'when mock LLM emits envelope wrapped in markdown fence, exactly one `envelope.recovery.applied` event fires with `path: "markdown-fence"` — promoted when the parsing path in dispatchStructured() implements lenient parsing',
  );
  it.todo(
    'recovery does NOT consume a retry attempt — `envelope.retry.attempted` does NOT fire as a consequence of recovery (RFC 0033 §D)',
  );
  it.todo(
    'recovered envelope is subsequently accepted normally; downstream RunEventDoc carries the recovered content',
  );
});
