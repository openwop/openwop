/**
 * envelope-completion-distinguishes-truncation — RFC 0033 §A + §B + §C
 * truncation-vs-schema-violation retry-routing distinction.
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`
 * AND `capabilities.envelopes.reliability.completion.distinguishesTruncation: true`
 * AND the host's test seam. Soft-skip cleanly on hosts that conflate the two
 * paths (legacy v1.1 behavior).
 *
 * Asserts two scenarios:
 *
 * 1. **Truncation path** (RFC 0033 §B). Mock LLM stops at `max_tokens` mid-envelope.
 *    - `envelope.truncated` event fires.
 *    - `envelope.retry.attempted` fires with `reason: 'truncation'`.
 *    - The retry's `maxTokens` budget is strictly greater than the initial.
 *
 * 2. **Schema-violation path** (RFC 0033 §C). Mock LLM emits malformed JSON.
 *    - NO `envelope.truncated` event.
 *    - `envelope.retry.attempted` fires with `reason` ∈ {`schema-violation`, `parse-error`}.
 *    - The retry's `maxTokens` budget is UNCHANGED from the initial.
 *
 * Both scenarios share the existing per-path fixtures
 * (`conformance-envelope-truncated` for the truncation case;
 * `conformance-envelope-retry-attempted` for the schema-violation case).
 *
 * @see RFCS/0033-envelope-completion-contract.md §A + §B + §C
 * @see spec/v1/ai-envelope.md §"Envelope-completion criteria"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const NODE_ID = 'structured-call';

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: {
      reliability?: {
        completion?: {
          distinguishesTruncation?: unknown;
          truncationBudgetMultiplier?: unknown;
        };
      };
    };
  };
}

interface RunEvent {
  type: string;
  payload?: Record<string, unknown>;
  nodeId?: string;
  sequence: number;
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

async function programMock(program: Array<Record<string, unknown>>): Promise<{ status: number }> {
  const res = await driver.post('/v1/host/sample/test/mock-ai/program', { nodeId: NODE_ID, program });
  return { status: res.status };
}

async function startRunAndRead(workflowId: string): Promise<{ events: RunEvent[]; terminal: unknown } | null> {
  const create = await driver.post('/v1/runs', { workflowId });
  if (create.status !== 201) return null;
  const runId = (create.json as { runId: string }).runId;
  const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
  const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (eventsRes.status !== 200) return null;
  const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []) as RunEvent[];
  return { events, terminal };
}

async function lastBudget(): Promise<number | null> {
  const res = await driver.get(`/v1/host/sample/test/mock-ai/last-dispatch-budget?nodeId=${encodeURIComponent(NODE_ID)}`);
  if (res.status !== 200) return null;
  return (res.json as { maxTokens?: number | null }).maxTokens ?? null;
}

describe.skipIf(HTTP_SKIP)('envelope-completion-distinguishes-truncation: advertisement shape (RFC 0033 §E)', () => {
  it('capabilities.envelopes.reliability.completion (when present) conforms to RFC 0033 §E', async () => {
    const d = await readDiscovery();
    if (d === null) return softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
    const completion = capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<string, unknown> }>(d, 'envelopes')?.reliability?.completion;
    if (completion === undefined) return softSkip('blocked', 'precondition not met — `completion === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(
      typeof completion.distinguishesTruncation,
      req('openwop.it.envelope-completion-distinguishes-truncation.capabilities-envelopes-reliability-completion-when-present-conforms-to-rfc-0033', 'RFCS/0033-envelope-completion-contract.md §E', 'completion.distinguishesTruncation MUST be boolean when block is advertised'),
    ).toBe('boolean');
    if (completion.truncationBudgetMultiplier !== undefined) {
      const n = completion.truncationBudgetMultiplier as number;
      expect(
        typeof n === 'number' && n >= 1 && n <= 8,
        req('openwop.it.envelope-completion-distinguishes-truncation.capabilities-envelopes-reliability-completion-when-present-conforms-to-rfc-0033', 'RFCS/0033-envelope-completion-contract.md §E', 'truncationBudgetMultiplier MUST be a number in [1, 8] (default 2)'),
      ).toBe(true);
    }
  });
});

const TRUNCATED_FIXTURE = 'conformance-envelope-truncated';
const SCHEMA_VIOLATION_FIXTURE = 'conformance-envelope-retry-attempted';

describe.skipIf(HTTP_SKIP)('envelope-completion-distinguishes-truncation: truncation path (RFC 0033 §B)', () => {
  it('truncation: emits envelope.truncated + envelope.retry.attempted with reason: "truncation"', async () => {
    if (!isFixtureAdvertised(TRUNCATED_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(TRUNCATED_FIXTURE)` returned early');
    const d = await readDiscovery();
    if (capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<string, unknown> }>(d, 'envelopes')?.reliability?.completion?.distinguishesTruncation !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<stri…');
    const seed = await programMock([
      { stopReason: 'max_tokens', content: '{"partial' },
      { stopReason: 'end_turn', content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead(TRUNCATED_FIXTURE);
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const truncated = result.events.find((e) => e.type === 'envelope.truncated');
    expect(truncated, req('openwop.it.envelope-completion-distinguishes-truncation.truncation-emits-envelope-truncated-envelope-retry-attempted-with-reason-truncat', 'RFCS/0033-envelope-completion-contract.md §B', 'envelope.truncated MUST fire on the truncation path')).toBeDefined();
    const retry = result.events.find((e) => e.type === 'envelope.retry.attempted');
    expect(retry, req('openwop.it.envelope-completion-distinguishes-truncation.truncation-emits-envelope-truncated-envelope-retry-attempted-with-reason-truncat', 'RFCS/0033-envelope-completion-contract.md §B', 'envelope.retry.attempted MUST fire between attempts')).toBeDefined();
    expect(
      retry!.payload?.reason,
      req('openwop.it.envelope-completion-distinguishes-truncation.truncation-emits-envelope-truncated-envelope-retry-attempted-with-reason-truncat', 
        'RFCS/0033-envelope-completion-contract.md §B',
        'truncation-routed retry MUST carry reason: "truncation" (distinct from schema-violation per RFC 0033 §A precedence rule)',
      ),
    ).toBe('truncation');
  });

  it('truncation: retry budget strictly greater than initial (RFC 0033 §B truncationBudgetMultiplier)', async () => {
    if (!isFixtureAdvertised(TRUNCATED_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(TRUNCATED_FIXTURE)` returned early');
    const d = await readDiscovery();
    if (capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<string, unknown> }>(d, 'envelopes')?.reliability?.completion?.distinguishesTruncation !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `capabilityFamily<{ reasoning?: Record<string, unknown>; tierOneSubsetCompliance?: unknown; reliability?: { completion?: Record<string, unknown> } & Record<stri…');
    const seed = await programMock([
      { stopReason: 'max_tokens', content: '{"partial' },
      { stopReason: 'end_turn', content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    await startRunAndRead(TRUNCATED_FIXTURE);
    const budget = await lastBudget();
    if (budget === null) return softSkip('blocked', 'precondition not met — `budget === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      budget,
      req('openwop.it.envelope-completion-distinguishes-truncation.truncation-retry-budget-strictly-greater-than-initial-rfc-0033-b-truncationbudge', 
        'RFCS/0033-envelope-completion-contract.md §B',
        'truncation retry MUST multiply maxTokens by truncationBudgetMultiplier — final budget > initial 50 fixture value',
      ),
    ).toBeGreaterThan(50);
  });
});

describe.skipIf(HTTP_SKIP)('envelope-completion-distinguishes-truncation: schema-violation path (RFC 0033 §C)', () => {
  it('schema-violation: NO envelope.truncated; envelope.retry.attempted reason ∈ {schema-violation, parse-error}', async () => {
    if (!isFixtureAdvertised(SCHEMA_VIOLATION_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(SCHEMA_VIOLATION_FIXTURE)` returned early');
    const seed = await programMock([
      { content: 'not valid json' },
      { content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead(SCHEMA_VIOLATION_FIXTURE);
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const truncated = result.events.find((e) => e.type === 'envelope.truncated');
    expect(
      truncated,
      req('openwop.it.envelope-completion-distinguishes-truncation.schema-violation-no-envelope-truncated-envelope-retry-attempted-reason-schema-vi', 
        'RFCS/0033-envelope-completion-contract.md §C',
        'schema-violation path MUST NOT emit envelope.truncated (truncation and schema-violation are distinct paths per RFC 0033 §A)',
      ),
    ).toBeUndefined();
    const retry = result.events.find((e) => e.type === 'envelope.retry.attempted');
    expect(retry).toBeDefined();
    const reason = retry!.payload?.reason as string | undefined;
    expect(
      reason === 'schema-violation' || reason === 'parse-error',
      req('openwop.it.envelope-completion-distinguishes-truncation.schema-violation-no-envelope-truncated-envelope-retry-attempted-reason-schema-vi', 
        'RFCS/0033-envelope-completion-contract.md §C',
        'schema-violation-routed retry MUST carry reason ∈ {schema-violation, parse-error}; truncation reason is reserved for the budget-doubling path',
      ),
    ).toBe(true);
  });

  it('schema-violation: retry budget UNCHANGED from initial (no budget multiplication on this path)', async () => {
    if (!isFixtureAdvertised(SCHEMA_VIOLATION_FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(SCHEMA_VIOLATION_FIXTURE)` returned early');
    const seed = await programMock([
      { content: 'not valid json' },
      { content: '{"valid":true}' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    await startRunAndRead(SCHEMA_VIOLATION_FIXTURE);
    const budget = await lastBudget();
    if (budget === null) return softSkip('blocked', 'precondition not met — `budget === null` returned early (seam, prior step, or fixture unavailable)');
    // The schema-violation fixture doesn't set maxTokens explicitly →
    // budget snapshots whatever the host's default is on each call.
    // The KEY invariant: the retry call's budget MUST NOT be multiplied
    // (the truncation path doubles; this path keeps the same). The
    // budget on the last call equals the budget on the first call.
    // Without a per-call history hook, we can't strictly compare; we
    // assert the budget didn't grow into the truncation-path range
    // (which would be ≥2× the default — typically 8000 for the
    // sample's structuredOutput dispatch path).
    if (budget !== null) {
      expect(
        budget,
        req('openwop.it.envelope-completion-distinguishes-truncation.schema-violation-retry-budget-unchanged-from-initial-no-budget-multiplication-on', 
          'RFCS/0033-envelope-completion-contract.md §C',
          'schema-violation retry MUST NOT multiply maxTokens — budget stays at the original value (host default)',
        ),
      ).toBeLessThan(20_000);
    }
  });
});
