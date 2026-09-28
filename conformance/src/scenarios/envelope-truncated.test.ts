/**
 * envelope-truncated — RFC 0032 §B.4 + RFC 0033 §B runtime behavior.
 *
 * Capability- + fixture-gated. Drives the conformance `mock` provider via
 * `POST /v1/host/sample/test/mock-ai/program` with a program that returns
 * `stopReason: 'max_tokens'` on attempt 1 then a valid envelope on attempt 2.
 * The host's `dispatchStructured` retry loop MUST: (a) emit exactly one
 * `envelope.truncated` event with `stopReason: 'max_tokens'`; (b) retry with
 * a maxTokens value strictly greater than the original budget per RFC 0033
 * §B `truncationBudgetMultiplier`; (c) NOT inject the corrective schema
 * fragment on the truncation retry (truncation is an output-size problem,
 * not a schema problem); (d) complete normally after attempt 2 succeeds.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.4
 * @see RFCS/0033-envelope-completion-contract.md §B
 * @see schemas/run-event-payloads.schema.json §envelopeTruncated
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, blockedDespiteAssertions } from '../lib/soft-skip.js';
import { holdMockNodes } from '../lib/mock-node-lock.js';
import { truncationBudgetVerdict } from '../lib/mock-ai-budgets.js';

// The mock-AI program seam is keyed by node id; files sharing a fixture's node run one at a time.
holdMockNodes('truncated-structured-call');

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const FIXTURE = 'conformance-envelope-truncated';
const NODE_ID = 'truncated-structured-call';

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

async function startRunAndRead(): Promise<{ events: RunEvent[]; terminal: unknown } | null> {
  const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
  if (create.status !== 201) return null;
  const runId = (create.json as { runId: string }).runId;
  const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
  const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (eventsRes.status !== 200) return null;
  const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []) as RunEvent[];
  return { events, terminal };
}

describe.skipIf(HTTP_SKIP)('envelope-truncated: runtime behavior (RFC 0032 §B.4 + RFC 0033 §B)', () => {
  it('when mock returns stopReason: max_tokens on attempt 1, exactly one envelope.truncated event fires with stopReason: max_tokens', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([
      { stopReason: 'max_tokens', content: '{"valid":' },
      { stopReason: 'end_turn', content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(seed.status).toBe(200);

    const result = await startRunAndRead();
    // unfailable-leg audit wave 2, 2026-09-27: after the seed assertion above a
    // plain softSkip('blocked') records a partial-witness PASS at major 1, so a
    // host whose run create / event read failed passed this leg without the
    // envelope.truncated count ever being observed.
    if (result === null) return blockedDespiteAssertions('the run create or event-log read failed after the mock was seeded — the envelope.truncated count was never observed');
    const truncated = result.events.filter((e) => e.type === 'envelope.truncated');
    expect(
      truncated.length,
      req('openwop.it.envelope-truncated.when-mock-returns-stopreason-max-tokens-on-attempt-1-exactly-one-envelope-trunca', 
        'RFCS/0032-envelope-reliability-events.md §B.4',
        'exactly one envelope.truncated event MUST fire when the provider returns finishReason corresponding to truncation',
      ),
    ).toBe(1);
    expect(truncated[0]!.payload?.stopReason).toBe('max_tokens');
  });

  it('payload includes nodeId + provider + model + partialPayloadAvailable boolean', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([
      { stopReason: 'max_tokens', content: '{"partial' },
      { stopReason: 'end_turn', content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const truncated = result.events.find((e) => e.type === 'envelope.truncated');
    expect(truncated, req('openwop.it.envelope-truncated.payload-includes-nodeid-provider-model-partialpayloadavailable-boolean', 'RFC 0032 §B.4', 'payload includes nodeId + provider + model + partialPayloadAvailable boolean')).toBeDefined();
    const payload = truncated!.payload ?? {};
    expect(payload.nodeId).toBe(NODE_ID);
    expect(payload.provider).toBe('mock');
    expect(typeof payload.model).toBe('string');
    expect(typeof payload.partialPayloadAvailable).toBe('boolean');
  });

  it('retry attempt receives a maxTokens value strictly greater than the previous attempt (RFC 0033 §B truncationBudgetMultiplier)', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([
      { stopReason: 'max_tokens', content: '{"partial' },
      { stopReason: 'end_turn', content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    // RFC 0033 §B: the retry budget SHOULD exceed the first attempt's (a MAY retry,
    // a SHOULD increase). Suite 2.42.9 compares the budgets the provider actually
    // received, and records an unmet SHOULD rather than failing it; until then this
    // leg asserted `> 50` (the fixture value) as a MUST.
    const v = await truncationBudgetVerdict(NODE_ID);
    if (v.kind === 'skip') return softSkip(v.skip, v.reason);
    if (v.kind === 'unmet') return softSkip('inapplicable', `RFC 0033 §B SHOULD not met — the retry carried maxTokens ${v.retry} after the first attempt carried ${v.first}; recorded, not failed`);
    expect(
      v.retry,
      req('openwop.it.envelope-truncated.retry-attempt-receives-a-maxtokens-value-strictly-greater-than-the-previous-atte',
        'RFCS/0033-envelope-completion-contract.md §B',
        `the truncation retry's budget SHOULD exceed the first attempt's (first ${v.first}, retry ${v.retry})`,
      ),
    ).toBeGreaterThan(v.first);
  });

  it('run terminates `completed` after the second attempt succeeds', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([
      { stopReason: 'max_tokens', content: '{"partial' },
      { stopReason: 'end_turn', content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    expect((result.terminal as { status?: string }).status, req('openwop.it.envelope-truncated.run-terminates-completed-after-the-second-attempt-succeeds', 'RFC 0032 §B.4', 'run terminates `completed` after the second attempt succeeds')).toBe('completed');
  });
});
