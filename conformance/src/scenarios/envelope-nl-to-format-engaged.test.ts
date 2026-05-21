/**
 * envelope-nl-to-format-engaged — RFC 0032 §B.5 runtime behavior (MAY tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`
 * AND `events[]` includes `envelope.nlToFormat.engaged`. Soft-skip cleanly
 * on hosts that don't implement NL-to-Format fallback — NL-to-Format is one
 * of many possible recovery strategies; hosts that don't advertise it don't
 * need to emit.
 *
 * Asserts:
 *   1. When retry exhaustion triggers the NL-to-Format fallback (per Tam et al.
 *      mitigation: free-form reasoning in the first call → schema coercion
 *      in the second call), exactly one `envelope.nlToFormat.engaged` event
 *      fires.
 *   2. `originalEnvelopeType` carries the envelope kind the original attempt
 *      was trying to emit.
 *   3. `fallbackCalls >= 1` (informational — how many secondary LLM calls
 *      the host issued to reformat).
 *   4. The eventual envelope acceptance (when fallback succeeds) records
 *      normally via downstream RunEventDoc.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.5
 * @see Tam et al., "Let Me Speak Freely?" — https://arxiv.org/pdf/2408.02442
 * @see schemas/run-event-payloads.schema.json §envelopeNlToFormatEngaged
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const FIXTURE = 'conformance-envelope-nl-to-format-engaged';
const NODE_ID = 'structured-call';

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

async function runAndReadEvents(): Promise<RunEvent[] | null> {
  const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
  if (create.status !== 201) return null;
  const runId = (create.json as { runId: string }).runId;
  await pollUntilTerminal(runId, { timeoutMs: 10_000 });
  const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (eventsRes.status !== 200) return null;
  return ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []) as RunEvent[];
}

// Three NL responses to exhaust the retry budget; the fourth is the
// coerced response the NL-to-Format fallback secondary call returns —
// valid JSON matching the schema. The mock returns whatever the test
// programmed for the Nth call; the host's fallback issues a 4th call
// after retry exhaustion.
const NL_THEN_COERCED_PROGRAM = [
  { content: 'Sure, here is the result: the answer is OK.' },
  { content: 'Of course! The result you wanted is okay.' },
  { content: 'I think the result should be ok-ish.' },
  { content: '{"result":"coerced-ok"}' },
];

describe.skipIf(HTTP_SKIP)('envelope-nl-to-format-engaged: runtime behavior (RFC 0032 §B.5 MAY)', () => {
  it('when retry exhaustion triggers the NL-to-Format fallback, exactly one `envelope.nlToFormat.engaged` event fires', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock(NL_THEN_COERCED_PROGRAM);
    if (seed.status === 404) return;
    expect(seed.status).toBe(200);

    const events = await runAndReadEvents();
    if (events === null) return;
    const engagements = events.filter((e) => e.type === 'envelope.nlToFormat.engaged');
    expect(
      engagements.length,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.5',
        'exactly one envelope.nlToFormat.engaged event MUST fire when the host detects NL-shape responses after retry exhaustion',
      ),
    ).toBe(1);
  });

  it('`originalEnvelopeType` carries the envelope kind the original attempt targeted', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock(NL_THEN_COERCED_PROGRAM);
    if (seed.status === 404) return;

    const events = await runAndReadEvents();
    if (events === null) return;
    const engagement = events.find((e) => e.type === 'envelope.nlToFormat.engaged');
    expect(engagement).toBeDefined();
    expect(
      typeof engagement!.payload?.originalEnvelopeType,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.5',
        'originalEnvelopeType MUST be present and string-typed — derived from the response-schema or wrapping metadata',
      ),
    ).toBe('string');
    expect((engagement!.payload?.originalEnvelopeType as string).length).toBeGreaterThan(0);
  });

  it('`fallbackCalls >= 1` reports the number of secondary LLM calls used to reformat free-form output into the envelope schema', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock(NL_THEN_COERCED_PROGRAM);
    if (seed.status === 404) return;

    const events = await runAndReadEvents();
    if (events === null) return;
    const engagement = events.find((e) => e.type === 'envelope.nlToFormat.engaged');
    expect(engagement).toBeDefined();
    const fallbackCalls = engagement!.payload?.fallbackCalls;
    expect(typeof fallbackCalls).toBe('number');
    expect(
      fallbackCalls as number,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.5',
        'fallbackCalls MUST be >= 1 — the fallback fired at least one secondary call to reformat the free-form output',
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('the eventual envelope acceptance (when fallback succeeds) records normally via downstream RunEventDoc', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    const seed = await programMock(NL_THEN_COERCED_PROGRAM);
    if (seed.status === 404) return;

    const events = await runAndReadEvents();
    if (events === null) return;
    const nodeCompleted = events.find((e) => e.type === 'node.completed' && e.nodeId === NODE_ID);
    expect(
      nodeCompleted,
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.5',
        'NL-to-Format fallback success MUST reach node.completed — the coerced envelope flows downstream like any other accepted envelope',
      ),
    ).toBeDefined();
    const completedPayload = JSON.stringify(nodeCompleted?.payload ?? {});
    expect(
      completedPayload.includes('coerced-ok'),
      driver.describe(
        'RFCS/0032-envelope-reliability-events.md §B.5',
        'the coerced structured data from the secondary call MUST flow to the downstream RunEventDoc',
      ),
    ).toBe(true);
  });
});
