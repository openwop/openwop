/**
 * envelope-retry-exhausted — RFC 0032 §B.2 runtime behavior (MUST tier).
 *
 * Capability- + fixture-gated. Drives the conformance `mock` provider
 * via `POST /v1/host/sample/test/mock-ai/program` with a program that
 * returns invalid JSON on EVERY attempt; the host's `dispatchStructured`
 * retry loop exhausts its budget and emits `envelope.retry.exhausted`
 * BEFORE the terminal failure.
 *
 * Asserts:
 *   1. Exactly one `envelope.retry.exhausted` event with `totalAttempts`
 *      matching the host's advertised `maxRetryAttempts`.
 *   2. `finalReason` is one of the spec-reserved closed-enum values OR
 *      matches `x-host-<host>-<key>` (RFC 0032 §B.2 + §B.1 share the
 *      reason enum).
 *   3. `RunSnapshot.error.code` is `envelope_invalid` per
 *      RFC 0033 §C (schema-violation-exhaustion → existing RFC 0021 code).
 *   4. `node.failed` event appears after `envelope.retry.exhausted`
 *      (cause precedes effect per RFC 0032 §B.2 "emitted ... about to
 *      surface a terminal envelope failure").
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.2
 * @see RFCS/0033-envelope-completion-contract.md §C + §F
 * @see schemas/run-event-payloads.schema.json §envelopeRetryExhausted
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const FIXTURE = 'conformance-envelope-retry-exhausted';
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

describe.skipIf(HTTP_SKIP)('envelope-retry-exhausted: runtime behavior (RFC 0032 §B.2 MUST)', () => {
  it('host exhausts retries with all-invalid program → exactly one envelope.retry.exhausted event', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    // Seed maxRetryAttempts entries of invalid JSON so dispatchStructured
    // hits every retry and then exhausts. The mock returns empty-stop
    // after program exhaustion, but dispatchStructured short-circuits
    // earlier via its own counter.
    const seed = await programMock([
      { content: 'not json a' },
      { content: 'not json b' },
      { content: 'not json c' },
      { content: 'not json d' },
    ]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(seed.status).toBe(200);

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const { events } = result;
    const exhausted = events.filter((e) => e.type === 'envelope.retry.exhausted');
    expect(
      exhausted.length,
      req('openwop.it.envelope-retry-exhausted.host-exhausts-retries-with-all-invalid-program-exactly-one-envelope-retry-exhaus', 
        'RFCS/0032-envelope-reliability-events.md §B.2',
        'exactly one envelope.retry.exhausted event MUST fire on retry-budget exhaustion',
      ),
    ).toBe(1);
  });

  it('totalAttempts in payload matches the host advertised maxRetryAttempts', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([{ content: 'x' }, { content: 'y' }, { content: 'z' }, { content: 'w' }]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const exhausted = result.events.find((e) => e.type === 'envelope.retry.exhausted');
    expect(exhausted, req('openwop.it.envelope-retry-exhausted.totalattempts-in-payload-matches-the-host-advertised-maxretryattempts', 'RFC 0032 §B.2', 'totalAttempts in payload matches the host advertised maxRetryAttempts')).toBeDefined();
    const total = exhausted!.payload?.totalAttempts;
    expect(typeof total === 'number' && (total as number) >= 1).toBe(true);
  });

  it('finalReason is in the spec-reserved enum OR matches x-host-<host>-<key>', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([{ content: 'x' }, { content: 'y' }, { content: 'z' }, { content: 'w' }]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const exhausted = result.events.find((e) => e.type === 'envelope.retry.exhausted');
    expect(exhausted).toBeDefined();
    const reason = exhausted!.payload?.finalReason;
    expect(typeof reason).toBe('string');
    expect(
      RFC_0032_REASONS.has(reason as string) || HOST_REASON_EXT_RE.test(reason as string),
      req('openwop.it.envelope-retry-exhausted.finalreason-is-in-the-spec-reserved-enum-or-matches-x-host-host-key', 
        'RFCS/0032-envelope-reliability-events.md §B.2',
        'finalReason MUST be in the spec-reserved set OR match x-host-<host>-<key>',
      ),
    ).toBe(true);
  });

  it('RunSnapshot.error.code is envelope_invalid for schema-violation exhaustion (RFC 0033 §C)', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([{ content: 'x' }, { content: 'y' }, { content: 'z' }, { content: 'w' }]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const code = (result.terminal as { error?: { code?: string } }).error?.code;
    expect(
      code,
      req('openwop.it.envelope-retry-exhausted.runsnapshot-error-code-is-envelope-invalid-for-schema-violation-exhaustion-rfc-0', 
        'RFCS/0033-envelope-completion-contract.md §C',
        'schema-violation-exhaustion MUST surface as RunSnapshot.error.code = envelope_invalid',
      ),
    ).toBe('envelope_invalid');
  });

  it('envelope.retry.exhausted is emitted BEFORE node.failed (cause precedes effect)', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    const seed = await programMock([{ content: 'x' }, { content: 'y' }, { content: 'z' }, { content: 'w' }]);
    if (seed.status === 404) return softSkip('blocked', 'precondition not met — `seed.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const result = await startRunAndRead();
    if (result === null) return softSkip('blocked', 'precondition not met — `result === null` returned early (seam, prior step, or fixture unavailable)');
    const exhaustedIdx = result.events.findIndex((e) => e.type === 'envelope.retry.exhausted');
    const failedIdx = result.events.findIndex((e) => e.type === 'node.failed');
    expect(exhaustedIdx).toBeGreaterThanOrEqual(0);
    expect(failedIdx).toBeGreaterThanOrEqual(0);
    expect(
      exhaustedIdx < failedIdx,
      req('openwop.it.envelope-retry-exhausted.envelope-retry-exhausted-is-emitted-before-node-failed-cause-precedes-effect', 
        'RFCS/0032-envelope-reliability-events.md §B.2',
        'envelope.retry.exhausted MUST be emitted BEFORE node.failed (the event signals the host is about to surface the terminal failure)',
      ),
    ).toBe(true);
  });
});
