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
import { readErrorCode } from '../lib/error-envelope.js';
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
      driver.describe(
        'SECURITY/invariants.yaml §envelope-recovery-no-content-leak',
        'envelope.recovery.applied payload MUST NOT carry pre-recovery output substrings; only the canonical {nodeId, path, byteOffset?} keys per RFC 0032 §B.6 + §G — the recovered content rides on downstream RunEventDoc, not on the recovery event',
      ),
    ).toBe(400);
    expect(readErrorCode(r.body)).toBe('envelope_recovery_content_leak');
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
    expect(
      r.status,
      driver.describe(
        'schemas/run-event-payloads.schema.json §envelopeRecoveryApplied',
        'envelope.recovery.applied has additionalProperties: false on the payload — any extra field MUST be rejected to prevent regression carriers for pre-recovery output (defense-in-depth on top of envelope-recovery-no-content-leak)',
      ),
    ).toBe(400);
    expect(readErrorCode(r.body)).toBe('envelope_recovery_content_leak');
  });
});

// Live end-to-end through dispatchStructured()'s lenient-parse fallback.
// Drives the mock provider with a markdown-fenced JSON response on the
// FIRST attempt; the host's `tryLenientParse()` strips the fence,
// returns the parsed payload, and emits `envelope.recovery.applied`
// without consuming a retry slot per RFC 0032 §B.6 + RFC 0033 §D.
//
// Reuses the existing `conformance-envelope-recovery-applied`
// fixture + mock-program seam established by the keystone work
// (`f5148cf`, `5817523`). Fixture- + capability- + seam-gated:
// soft-skip when any layer is absent.

import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const RECOVERY_FIXTURE = 'conformance-envelope-recovery-applied';
const RECOVERY_NODE_ID = 'structured-call';

interface ProgrammedRunEvent {
  type: string;
  payload?: Record<string, unknown>;
  nodeId?: string;
  sequence: number;
}

async function programRecovery(program: Array<Record<string, unknown>>): Promise<{ status: number }> {
  const res = await driver.post('/v1/host/sample/test/mock-ai/program', { nodeId: RECOVERY_NODE_ID, program });
  return { status: res.status };
}

async function runAndReadEvents(): Promise<ProgrammedRunEvent[] | null> {
  const create = await driver.post('/v1/runs', { workflowId: RECOVERY_FIXTURE });
  if (create.status !== 201) return null;
  const runId = (create.json as { runId: string }).runId;
  await pollUntilTerminal(runId, { timeoutMs: 10_000 });
  const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (eventsRes.status !== 200) return null;
  return ((eventsRes.json as { events?: ProgrammedRunEvent[] } | undefined)?.events ?? []) as ProgrammedRunEvent[];
}

describe.skipIf(HTTP_SKIP)('envelope-recovery-applied: end-to-end through the envelope-validation pipeline', () => {
  it('when mock LLM emits envelope wrapped in markdown fence, exactly one `envelope.recovery.applied` event fires with `path: "markdown-fence"`', async () => {
    if (!isFixtureAdvertised(RECOVERY_FIXTURE)) return;
    const seed = await programRecovery([
      // Markdown-fenced JSON — dispatchStructured's strict parse fails,
      // tryLenientParse() strips the fence + succeeds via the
      // 'markdown-fence' path.
      { content: '```json\n{"result":"ok"}\n```' },
    ]);
    if (seed.status === 404) return;
    expect(seed.status).toBe(200);

    const events = await runAndReadEvents();
    if (events === null) return;
    const recoveries = events.filter((e) => e.type === 'envelope.recovery.applied');
    expect(
      recoveries.length,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.6',
        'exactly one envelope.recovery.applied event MUST fire when lenient parsing strips a markdown fence',
      ),
    ).toBe(1);
    expect(
      recoveries[0]?.payload?.path,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.6',
        'path MUST identify the recovery strategy that engaged (markdown-fence here)',
      ),
    ).toBe('markdown-fence');
  });

  it('recovery does NOT consume a retry attempt — `envelope.retry.attempted` does NOT fire as a consequence of recovery (RFC 0033 §D)', async () => {
    if (!isFixtureAdvertised(RECOVERY_FIXTURE)) return;
    const seed = await programRecovery([
      { content: '```json\n{"result":"ok"}\n```' },
    ]);
    if (seed.status === 404) return;

    const events = await runAndReadEvents();
    if (events === null) return;
    const retries = events.filter((e) => e.type === 'envelope.retry.attempted');
    expect(
      retries.length,
      driver.describe(
        'RFCS/0033-envelope-completion-contract.md §D',
        'recovery (parse fix-up) MUST NOT count against the retry budget — no envelope.retry.attempted may fire',
      ),
    ).toBe(0);
  });

  it('recovered envelope is subsequently accepted normally; downstream RunEventDoc carries the recovered content', async () => {
    if (!isFixtureAdvertised(RECOVERY_FIXTURE)) return;
    const seed = await programRecovery([
      { content: '```json\n{"result":"recovered-ok"}\n```' },
    ]);
    if (seed.status === 404) return;

    const events = await runAndReadEvents();
    if (events === null) return;
    const nodeCompleted = events.find((e) => e.type === 'node.completed' && e.nodeId === RECOVERY_NODE_ID);
    expect(
      nodeCompleted,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.6',
        'recovered envelope MUST reach node.completed — recovery does not block downstream acceptance',
      ),
    ).toBeDefined();
    // The dispatching node's output carries the recovered structured
    // data — serialized for substring assertion since the exact shape
    // depends on how the fixture node wraps the dispatch result.
    const completedPayload = JSON.stringify(nodeCompleted?.payload ?? {});
    expect(
      completedPayload.includes('recovered-ok'),
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.6',
        'recovered structured data MUST flow to the downstream RunEventDoc unchanged',
      ),
    ).toBe(true);
  });
});
