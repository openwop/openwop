/**
 * Event-ordering scenarios per `spec/v1/observability.md` and
 * `spec/v1/stream-modes.md`.
 *
 * Polling and streaming MUST yield events in the same monotonic order
 * for a given run. Sequence numbers (or seq, depending on host event
 * shape) are stable across reads; multiple polls return events in
 * non-decreasing order.
 *
 * Profile gating: `openwop-stream-poll`. Hosts that don't expose
 * `/v1/runs/{runId}/events/poll` skip-equivalent.
 *
 * @see spec/v1/observability.md
 * @see spec/v1/stream-modes.md
 * @see spec/v1/idempotency.md (companion event-shape work)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

interface RawEvent {
  // Event shape may use `seq` or `sequence` depending on host's event-
  // schema generation. Suite is permissive here; the canonical shape
  // is `sequence` per run-event.schema.json. Either is acceptable
  // until version-negotiation.test.ts converges hosts.
  seq?: number;
  sequence?: number;
  type?: string;
  [key: string]: unknown;
}

function getSeq(event: RawEvent): number | null {
  if (typeof event.sequence === 'number') return event.sequence;
  if (typeof event.seq === 'number') return event.seq;
  return null;
}

describe.skipIf(SKIP_NO_NOOP)('event-ordering: polling returns events in monotonic order', () => {
  it('events from a single poll have non-decreasing sequence numbers', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (seam, prior step, or fixture unavailable)');

    const body = res.json as { events?: RawEvent[] } | undefined;
    if (!body?.events) return softSkip('blocked', 'precondition not met — `!body?.events` returned early (seam, prior step, or fixture unavailable)');
    if (body.events.length < 2) return softSkip('blocked', 'precondition not met — `body.events.length < 2` returned early (single-event runs have no ordering to verify) (seam, prior step, or fixture unavailable)'); // single-event runs have no ordering to verify

    const seqs = body.events.map(getSeq);
    for (let i = 1; i < seqs.length; i++) {
      const curr = seqs[i];
      const prev = seqs[i - 1];
      if (curr === null || prev === null) continue; // host without seq fields
      expect(curr, req('openwop.it.eventOrdering.events-from-a-single-poll-have-non-decreasing-sequence-numbers', 
        'observability.md §"Event ordering"',
        `event[${i}].sequence (${curr}) MUST be >= event[${i - 1}].sequence (${prev})`,
      )).toBeGreaterThanOrEqual(prev);
    }
  });

  it('repeated polls of a terminal run yield identical event sequences', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const a = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    const b = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (a.status !== 200 || b.status !== 200) return softSkip('blocked', 'precondition not met — `a.status !== 200 || b.status !== 200` returned early (seam, prior step, or fixture unavailable)');

    const aBody = a.json as { events?: RawEvent[] } | undefined;
    const bBody = b.json as { events?: RawEvent[] } | undefined;
    if (!aBody?.events || !bBody?.events) return softSkip('blocked', 'precondition not met — `!aBody?.events || !bBody?.events` returned early (seam, prior step, or fixture unavailable)');

    expect(aBody.events.length, req('openwop.it.eventOrdering.repeated-polls-of-a-terminal-run-yield-identical-event-sequences', 
      'observability.md',
      'repeated polls of terminal run MUST return same number of events',
    )).toBe(bBody.events.length);

    for (let i = 0; i < aBody.events.length; i++) {
      const aSeq = getSeq(aBody.events[i]!);
      const bSeq = getSeq(bBody.events[i]!);
      if (aSeq === null || bSeq === null) continue;
      expect(aSeq, req('openwop.it.eventOrdering.repeated-polls-of-a-terminal-run-yield-identical-event-sequences', 
        'observability.md',
        `event[${i}] sequence MUST be stable across repeated polls`,
      )).toBe(bSeq);
    }
  });
});

describe.skipIf(SKIP_NO_NOOP)('event-ordering: terminal run has at most one terminal event', () => {
  it('event stream contains exactly one of run.completed / run.failed / run.cancelled', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (seam, prior step, or fixture unavailable)');

    const body = res.json as { events?: RawEvent[] } | undefined;
    if (!body?.events) return softSkip('blocked', 'precondition not met — `!body?.events` returned early (seam, prior step, or fixture unavailable)');

    const TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);
    const terminalCount = body.events.filter((e) => typeof e.type === 'string' && TERMINAL_TYPES.has(e.type)).length;

    expect(terminalCount, req('openwop.it.eventOrdering.event-stream-contains-exactly-one-of-run-completed-run-failed-run-cancelled', 
      'observability.md §"Run lifecycle events"',
      'a run MUST emit exactly one terminal event (run.completed / run.failed / run.cancelled)',
    )).toBe(1);
  });

  it('the terminal event is the LAST event in the stream', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (seam, prior step, or fixture unavailable)');

    const body = res.json as { events?: RawEvent[] } | undefined;
    if (!body?.events || body.events.length === 0) return softSkip('blocked', 'precondition not met — `!body?.events || body.events.length === 0` returned early (seam, prior step, or fixture unavailable)');

    const TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);
    const lastEvent = body.events[body.events.length - 1]!;
    expect(
      typeof lastEvent.type === 'string' && TERMINAL_TYPES.has(lastEvent.type),
      req('openwop.it.eventOrdering.the-terminal-event-is-the-last-event-in-the-stream', 
        'observability.md §"Run lifecycle events"',
        'terminal event MUST be the last event in the stream — no events after a terminal type',
      ),
    ).toBe(true);
  });
});
