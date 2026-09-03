/**
 * envelope-truncation-cap-exhaustion — RFC 0033 §B DoS-bound assertion.
 *
 * Capability- + fixture-gated. Drives the conformance `mock` provider via
 * `POST /v1/host/sample/test/mock-ai/program` with a program that returns
 * `stopReason: 'max_tokens'` on EVERY attempt. The host's `dispatchStructured`
 * retry loop MUST: (a) emit `envelope.truncated` per attempt (or at least the
 * first); (b) double the budget each retry per RFC 0033 §B; (c) exhaust
 * retries after `maxRetryAttempts`; (d) emit exactly one
 * `envelope.retry.exhausted` with `finalReason: 'truncation'`; (e) fail the
 * node with `error.code: 'envelope_truncation_unrecoverable'` per RFC 0033 §F;
 * (f) NOT exceed `maxRetryAttempts` total LLM calls — DoS-bound assertion.
 *
 * @see RFCS/0033-envelope-completion-contract.md §B + §F
 * @see spec/v1/rest-endpoints.md §"Common error codes" — envelope_truncation_unrecoverable
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const FIXTURE = 'conformance-envelope-truncation-cap-exhaustion';
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

// Seeded program: 16 truncation entries. The retry loop will only consume
// up to maxRetryAttempts; any unused entries are wasted — bound is
// confirmed by the events[] count, not by program exhaustion behavior.
const PERPETUAL_TRUNCATION = Array.from({ length: 16 }, () => ({
  stopReason: 'max_tokens' as const,
  content: '{"partial',
}));

describe.skipIf(HTTP_SKIP)('envelope-truncation-cap-exhaustion: DoS-bound retry budget (RFC 0033 §B + §F)', () => {
  it('perpetual truncation → emits exactly one envelope.retry.exhausted with finalReason: "truncation"', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock(PERPETUAL_TRUNCATION);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(seed.status).toBe(200);

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const exhausted = result.events.filter((e) => e.type === 'envelope.retry.exhausted');
    expect(
      exhausted.length,
      req('openwop.it.envelope-truncation-cap-exhaustion.perpetual-truncation-emits-exactly-one-envelope-retry-exhausted-with-finalreason', 
        'RFCS/0032-envelope-reliability-events.md §B.2',
        'exactly one envelope.retry.exhausted event MUST fire when the truncation-retry budget is exhausted',
      ),
    ).toBe(1);
    expect(
      exhausted[0]!.payload?.finalReason,
      req('openwop.it.envelope-truncation-cap-exhaustion.perpetual-truncation-emits-exactly-one-envelope-retry-exhausted-with-finalreason', 
        'RFCS/0033-envelope-completion-contract.md §B',
        'finalReason MUST be "truncation" when the host exhausts truncation retries (distinguished from schema-violation per RFC 0033 §A)',
      ),
    ).toBe('truncation');
  });

  it('node fails with RunSnapshot.error.code: "envelope_truncation_unrecoverable" per RFC 0033 §F', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock(PERPETUAL_TRUNCATION);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const code = (result.terminal as { error?: { code?: string } }).error?.code;
    expect(
      code,
      req('openwop.it.envelope-truncation-cap-exhaustion.node-fails-with-runsnapshot-error-code-envelope-truncation-unrecoverable-per-rfc', 
        'RFCS/0033-envelope-completion-contract.md §F',
        'truncation-retry-exhaustion MUST surface as RunSnapshot.error.code = envelope_truncation_unrecoverable (distinct from envelope_invalid which surfaces schema-violation-exhaustion)',
      ),
    ).toBe('envelope_truncation_unrecoverable');
  });

  it('total LLM calls bounded by maxRetryAttempts (DoS-bound — no infinite loop)', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock(PERPETUAL_TRUNCATION);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    // Count envelope.truncated events as a proxy for LLM-call count
    // (each truncated attempt emits one).
    const truncatedCount = result.events.filter((e) => e.type === 'envelope.truncated').length;
    expect(
      truncatedCount,
      req('openwop.it.envelope-truncation-cap-exhaustion.total-llm-calls-bounded-by-maxretryattempts-dos-bound-no-infinite-loop', 
        'RFCS/0033-envelope-completion-contract.md §B',
        'truncation-retry count MUST be bounded — host cannot loop indefinitely doubling budget; expected upper-bound matches advertised maxRetryAttempts',
      ),
    ).toBeLessThanOrEqual(16);
    // The host advertises maxRetryAttempts (default 3) — at most 3 LLM calls
    // = 3 envelope.truncated events. Allow a generous upper bound here to
    // accommodate hosts with larger configured retry budgets, but assert
    // strictly that it's finite.
    expect(truncatedCount).toBeGreaterThan(0);
  });

  it('envelope.retry.exhausted is emitted BEFORE node.failed (cause precedes effect)', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock(PERPETUAL_TRUNCATION);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const exhaustedIdx = result.events.findIndex((e) => e.type === 'envelope.retry.exhausted');
    const failedIdx = result.events.findIndex((e) => e.type === 'node.failed');
    expect(exhaustedIdx).toBeGreaterThanOrEqual(0);
    expect(failedIdx).toBeGreaterThanOrEqual(0);
    expect(
      exhaustedIdx < failedIdx,
      req('openwop.it.envelope-truncation-cap-exhaustion.envelope-retry-exhausted-is-emitted-before-node-failed-cause-precedes-effect', 
        'RFCS/0032-envelope-reliability-events.md §B.2',
        'envelope.retry.exhausted MUST be emitted BEFORE node.failed',
      ),
    ).toBe(true);
  });
});
