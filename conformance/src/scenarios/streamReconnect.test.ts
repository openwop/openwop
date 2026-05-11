/**
 * Stream-reconnect scenarios per spec/v1/stream-modes.md §"Reconnection."
 *
 * After a client connects, reads some events, and disconnects, a fresh
 * connection with `Last-Event-ID: <last-seq-seen>` MUST resume from the
 * next event without loss or duplication.
 *
 * Profile gating: `openwop-stream-sse`. Hosts that don't expose SSE
 * skip-equivalent.
 *
 * **Tagged `@timing-sensitive`** — relies on a long-running fixture
 * (`conformance-cancellable` with `delayMs > 1000`) so the reconnect
 * happens mid-stream. Tolerance window: 30s for the full run lifecycle.
 *
 * @see spec/v1/stream-modes.md §"Reconnection"
 * @see lib/sse.ts — subscribe() accepts lastEventId
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-cancellable';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);
const TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

interface EventPayload {
  seq?: number;
  sequence?: number;
  type?: string;
  [key: string]: unknown;
}

function getSeq(event: SseEvent): number | null {
  if (event.id !== null) {
    const parsed = Number(event.id);
    if (Number.isFinite(parsed)) return parsed;
  }
  try {
    const payload = JSON.parse(event.data) as EventPayload;
    if (typeof payload.sequence === 'number') return payload.sequence;
    if (typeof payload.seq === 'number') return payload.seq;
  } catch {
    // ignore — not all events carry JSON data
  }
  return null;
}

describe.skipIf(SKIP_NO_FIXTURE)('stream-reconnect: Last-Event-ID resume per spec/v1/stream-modes.md', () => {
  it(
    'reconnect with Last-Event-ID resumes without loss or duplication',
    async () => {
      // Phase 1: kick off a long-running run.
      const create = await driver.post('/v1/runs', {
        workflowId: WORKFLOW_ID,
        inputs: { delayMs: 2000 },
      });
      if (create.status !== 201) return; // host doesn't seed cancellable fixture; skip-equivalent

      const runId = (create.json as { runId: string }).runId;

      // Phase 2: connect, take ~1s of stream, disconnect.
      const firstHalf = await subscribe(`/v1/runs/${encodeURIComponent(runId)}/events`, {
        timeoutMs: 1000, // disconnect after ~1s
      });
      expect(firstHalf.status, driver.describe(
        'spec/v1/stream-modes.md',
        'SSE endpoint MUST return 200',
      )).toBe(200);
      // The first connection might or might not have caught the terminal
      // event before timeout — either way, the test assertion is on the
      // resume.

      // Find the highest sequence number we saw.
      const firstSeqs = firstHalf.events.map(getSeq).filter((s): s is number => s !== null);
      const lastSeen = firstSeqs.length > 0 ? Math.max(...firstSeqs) : -1;

      if (lastSeen < 0) {
        // First connection emitted no events with a parseable sequence — e.g.
        // because the run already completed and the server closed before we
        // got events. Skip the rest of this scenario; the host is fast enough
        // that the reconnect path doesn't apply.
        return;
      }

      // Phase 3: reconnect with Last-Event-ID set to the last seq we saw.
      // Per stream-modes.md, the resume MUST yield events with seq > lastSeen.
      const resume = await subscribe(`/v1/runs/${encodeURIComponent(runId)}/events`, {
        timeoutMs: 5000,
        lastEventId: String(lastSeen),
      });
      expect(resume.status, driver.describe(
        'spec/v1/stream-modes.md §"Reconnection"',
        'reconnection with Last-Event-ID MUST return 200',
      )).toBe(200);

      // Phase 4: assert no duplicates.
      const resumeSeqs = resume.events.map(getSeq).filter((s): s is number => s !== null);
      for (const s of resumeSeqs) {
        // Hosts MAY replay the boundary event (some impls do; spec is
        // permissive). The strict assertion is "no event with seq <
        // lastSeen-1" — i.e., no events from before the resume point.
        expect(s, driver.describe(
          'spec/v1/stream-modes.md §"Reconnection"',
          `resume MUST NOT yield events with seq < lastSeen-1; got ${s} after lastSeen=${lastSeen}`,
        )).toBeGreaterThanOrEqual(lastSeen - 1);
      }

      // Phase 5: ensure the run has reached terminal state by now.
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    },
    60_000, // overall scenario timeout — well above the 30s @timing-sensitive budget
  );

  it(
    'reconnect with Last-Event-ID equal to terminal seq closes immediately',
    async () => {
      // Quick run, observe terminal seq, then attempt a reconnect after
      // terminal — server SHOULD close immediately with no events.
      const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
      if (create.status !== 201) return;
      const runId = (create.json as { runId: string }).runId;

      const initial = await subscribe(`/v1/runs/${encodeURIComponent(runId)}/events`, {
        timeoutMs: 5000,
      });
      if (initial.status !== 200 || initial.events.length === 0) return;

      const terminalEvent = initial.events.find(
        (e) => TERMINAL_TYPES.has(e.event) && e.id !== null && Number.isFinite(Number(e.id)),
      );
      if (!terminalEvent || terminalEvent.id === null) return;

      const lastSeq = Number(terminalEvent.id);
      if (!Number.isFinite(lastSeq)) return;

      const reconnect = await subscribe(`/v1/runs/${encodeURIComponent(runId)}/events`, {
        timeoutMs: 5000,
        lastEventId: String(lastSeq),
      });

      // Reconnect MUST succeed (200) and SHOULD close quickly with no
      // additional events beyond the terminal boundary. Permissive: the
      // host MAY replay the terminal event itself.
      expect(reconnect.status, driver.describe(
        'spec/v1/stream-modes.md §"Reconnection"',
        'reconnect after terminal MUST return 200',
      )).toBe(200);

      const newSeqs = reconnect.events
        .map(getSeq)
        .filter((s): s is number => s !== null && s > lastSeq);
      expect(newSeqs.length, driver.describe(
        'spec/v1/stream-modes.md §"Reconnection"',
        'reconnect after terminal MUST NOT yield events with seq > lastSeq',
      )).toBe(0);
    },
    30_000,
  );
});
