/**
 * envelope-retry-attempted — RFC 0032 §B.1 runtime behavior.
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true` AND
 * `events[]` includes `envelope.retry.attempted` AND the host's test seam
 * `POST /v1/host/sample/test/simulate-envelope-retry`.
 *
 * Asserts:
 *   1. When the mock LLM emits an invalid envelope on attempt 1 then a valid
 *      one on attempt 2, exactly one `envelope.retry.attempted` event fires
 *      before the second attempt.
 *   2. `attempt: 2`, `reason: "schema-violation"` (or `truncation` /
 *      `type-drift` / `type-mismatch` / `refusal` / `parse-error` / `unknown`
 *      / `x-host-<host>-*`).
 *   3. First attempt does NOT emit `envelope.retry.attempted` (per RFC 0032
 *      §B.1 normative text — only retries past the first emit).
 *   4. Eventual success is recorded normally (envelope acceptance + downstream
 *      RunEventDoc).
 *
 * Live behavioral via the reference workflow-engine's
 * `executor/envelopeReliability.ts` emission path + the
 * `POST /v1/host/sample/test/mock-ai/program` seam. Fixture- + capability-
 * gated; soft-skip cleanly when the host doesn't expose the seam or doesn't
 * advertise `capabilities.envelopes.reliability.events[]` containing
 * `envelope.retry.attempted`.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.1
 * @see schemas/run-event-payloads.schema.json §envelopeRetryAttempted
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
        maxRetryAttempts?: unknown;
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

describe.skipIf(HTTP_SKIP)('envelope-retry-attempted: advertisement shape (RFC 0032 §C)', () => {
  it('capabilities.envelopes.reliability (when present) conforms to RFC 0032 §C', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reliability = d.capabilities?.envelopes?.reliability;
    if (reliability === undefined) return;
    expect(typeof reliability.supported, 'reliability.supported MUST be boolean').toBe('boolean');
    if (reliability.events !== undefined) {
      expect(Array.isArray(reliability.events), 'reliability.events MUST be an array').toBe(true);
      const RFC_0032_EVENTS = [
        'envelope.retry.attempted',
        'envelope.retry.exhausted',
        'envelope.refusal',
        'envelope.truncated',
        'envelope.nlToFormat.engaged',
        'envelope.recovery.applied',
      ];
      for (const e of reliability.events as unknown[]) {
        expect(RFC_0032_EVENTS, `event "${String(e)}" MUST be one of the six RFC 0032 names`).toContain(String(e));
      }
      // When supported: true, MUST include the two MUST-tier events (per
      // RFC 0032 §C). Hosts that have wired end-to-end emission from
      // dispatchStructured (per RFC 0032 §B + §C — the reference host's
      // OPENWOP_ENVELOPE_RELIABILITY_END_TO_END=true path) ALSO populate
      // envelope.retry.attempted + envelope.truncated. Hosts running the
      // legacy undifferentiated retry loop advertise `events: []` —
      // soft-skip this stricter check rather than fail on the legacy
      // posture (the MUST-tier events still appear via the seam).
      if (reliability.supported === true && Array.isArray(reliability.events) && (reliability.events as unknown[]).length > 0) {
        const evts = reliability.events as string[];
        expect(
          evts.includes('envelope.retry.exhausted'),
          'RFC 0032 §C: hosts that advertise `supported: true` with non-empty `events[]` MUST include `envelope.retry.exhausted`',
        ).toBe(true);
        expect(
          evts.includes('envelope.refusal'),
          'RFC 0032 §C: hosts that advertise `supported: true` with non-empty `events[]` MUST include `envelope.refusal`',
        ).toBe(true);
      }
    }
    if (reliability.maxRetryAttempts !== undefined) {
      const n = reliability.maxRetryAttempts as number;
      expect(typeof n === 'number' && n >= 1 && n <= 16, 'maxRetryAttempts MUST be integer in [1, 16]').toBe(true);
    }
  });
});

// Live runtime behavior — drives the conformance fixture
// `conformance-envelope-retry-attempted` against the sample's
// conformance-only `mock` provider. Test pre-seeds a 2-entry program
// via `POST /v1/host/sample/test/mock-ai/program`: attempt 1 returns
// invalid JSON, attempt 2 returns a valid envelope. The host's
// `dispatchStructured` retry loop emits exactly one
// `envelope.retry.attempted` event between the two attempts (RFC 0032
// §B.1). Fixture- + capability-gated: soft-skip when either is absent
// OR when the host doesn't expose the mock-ai program seam.

import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-envelope-retry-attempted';
const NODE_ID = 'structured-call';

const RFC_0032_REASONS = new Set([
  'schema-violation',
  'truncation',
  'type-drift',
  'type-mismatch',
  'refusal',
  'parse-error',
  'unknown',
]);
const HOST_REASON_EXT_RE = /^x-host-[a-z0-9][a-z0-9-]*-[a-z0-9][a-z0-9-]*$/;

interface RunEvent {
  type: string;
  payload?: Record<string, unknown>;
  nodeId?: string;
  sequence: number;
}

async function programMock(program: Array<Record<string, unknown>>): Promise<{ status: number }> {
  const res = await driver.post('/v1/host/sample/test/mock-ai/program', { nodeId: NODE_ID, program });
  return { status: res.status };
}

async function startRunAndRead(): Promise<RunEvent[] | null> {
  const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
  if (create.status !== 201) return null;
  const runId = (create.json as { runId: string }).runId;
  await pollUntilTerminal(runId, { timeoutMs: 10_000 });
  const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (eventsRes.status !== 200) return null;
  return ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []) as RunEvent[];
}

describe.skipIf(HTTP_SKIP)('envelope-retry-attempted: runtime behavior (RFC 0032 §B.1)', () => {
  it('when mock LLM emits invalid envelope on attempt 1 then valid on attempt 2, exactly one `envelope.retry.attempted` event fires before the second attempt', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock([
      { content: 'not valid json — provoke parse-error retry' },
      { content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return; // host doesn't expose the seam
    expect(seed.status).toBe(200);

    const events = await startRunAndRead();
    if (events === null) return;
    const retries = events.filter((e) => e.type === 'envelope.retry.attempted');
    expect(
      retries.length,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.1',
        'exactly one envelope.retry.attempted event MUST fire between attempts 1 and 2',
      ),
    ).toBe(1);
  });

  it('event payload carries `attempt: 2` (1-indexed; first attempt does not emit)', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock([{ content: 'invalid' }, { content: '{"valid":true}' }]);
    if (seed.status === 404) return;

    const events = await startRunAndRead();
    if (events === null) return;
    const retry = events.find((e) => e.type === 'envelope.retry.attempted');
    expect(retry, 'envelope.retry.attempted MUST appear in the event log').toBeDefined();
    expect(
      retry!.payload?.attempt,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.1',
        'attempt field MUST be 2 (1-indexed; first attempt does not emit)',
      ),
    ).toBe(2);
  });

  it('`reason` is one of the spec-reserved closed-enum values OR matches the `x-host-<host>-<key>` extension pattern', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock([{ content: 'invalid' }, { content: '{"valid":true}' }]);
    if (seed.status === 404) return;

    const events = await startRunAndRead();
    if (events === null) return;
    const retry = events.find((e) => e.type === 'envelope.retry.attempted');
    expect(retry).toBeDefined();
    const reason = retry!.payload?.reason;
    expect(typeof reason).toBe('string');
    expect(
      RFC_0032_REASONS.has(reason as string) || HOST_REASON_EXT_RE.test(reason as string),
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.1',
        'reason MUST be in the spec-reserved set OR match x-host-<host>-<key>',
      ),
    ).toBe(true);
  });

  it('eventual success records normally via envelope acceptance + downstream RunEventDoc', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock([{ content: 'invalid' }, { content: '{"valid":true}' }]);
    if (seed.status === 404) return;

    const events = await startRunAndRead();
    if (events === null) return;
    const nodeCompleted = events.find((e) => e.type === 'node.completed' && e.nodeId === NODE_ID);
    const runCompleted = events.find((e) => e.type === 'run.completed');
    expect(
      nodeCompleted,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.1',
        'eventual success MUST produce a node.completed for the dispatching node',
      ),
    ).toBeDefined();
    expect(runCompleted).toBeDefined();
  });

  it('`previousError` (when populated) MUST NOT contain prompt or response substring excerpts — limit to validator output', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const PROMPT_CANARY = 'PROMPT-CANARY-RETRY-ATTEMPTED-DO-NOT-LEAK-' + Math.random().toString(36).slice(2, 10);
    const RESPONSE_CANARY = 'RESPONSE-CANARY-' + PROMPT_CANARY;
    const seed = await programMock([
      { content: `not valid json mentioning ${RESPONSE_CANARY}` },
      { content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return;

    const events = await startRunAndRead();
    if (events === null) return;
    const retry = events.find((e) => e.type === 'envelope.retry.attempted');
    if (!retry) return;
    const previousError = retry.payload?.previousError;
    if (previousError === undefined || previousError === null) return; // field is optional
    const serialized = typeof previousError === 'string' ? previousError : JSON.stringify(previousError);
    expect(
      serialized.includes(RESPONSE_CANARY),
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §G',
        'previousError MUST NOT echo provider response substrings — validator output only',
      ),
    ).toBe(false);
  });
});
