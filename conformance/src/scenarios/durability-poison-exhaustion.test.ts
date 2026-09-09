/**
 * Poison work reaches a bounded, operator-visible terminal state
 * (RFC 0158 §C.8, conformance row `durability/poison-exhaustion`).
 *
 * THE REQUIREMENT: work that fails deterministically **MUST** reach a terminal,
 * operator-visible state within a bounded number of attempts, and **MUST NOT**
 * be redelivered indefinitely.
 *
 * ── Why the obvious assertion proves only half of it ─────────────────────────
 * "The run reached `failed`" is the half everyone writes, and `failure-path.
 * test.ts` already covers it. It says nothing about the second clause: a host
 * that redelivers forever ALSO reports a terminal status at some point, or
 * reports one while the work keeps being re-dispatched behind it. An assertion
 * that stops at the terminal status cannot distinguish "terminated after N
 * attempts" from "still going".
 *
 * So the load-bearing leg here is STABILITY AFTER TERMINAL: count the attempts
 * on the run's own log, wait a scaled quiet window, count again, and assert the
 * number did not move. A host still redelivering shows new attempts; a host that
 * stopped shows the same count. That is the falsifiable form of "MUST NOT be
 * redelivered indefinitely" — and, unlike a ceiling, it needs no number the wire
 * does not carry (see below).
 *
 * ── What this scenario deliberately does NOT assert ──────────────────────────
 * Conformance to a SPECIFIC declared attempt bound. RFC 0158 §E mints no
 * advertised capability field, so a host's declared bound is not on the wire and
 * the suite cannot read it. Asserting against a number the suite invented would
 * be a bound of the suite's own making, which is the inverse of the §B.5
 * discipline ("derived from the mechanism that enforces it"). When
 * `OPENWOP_DECLARED_ATTEMPT_BOUND` is supplied by the operator — the same
 * operator-supplied-input shape as `OPENWOP_OPTED_OUT_PROFILES` — the ceiling leg
 * runs too. Without it, boundedness is still asserted; only the specific bound is
 * not.
 *
 * ── Honest about its gating ──────────────────────────────────────────────────
 * This is NOT a pure black-box scenario. Attempt counts live on the run's event
 * log, which is read through the EXISTING `/v1/host/sample/test/runs/{runId}/
 * events` seam — no new seam, but a seam. A host that has not wired it records
 * `blocked`: unobservable, not unmet. Outside every profile floor, for the same
 * reason.
 *
 * @see RFCS/0158-durable-execution-and-disaster-recovery-qualification.md §C.8
 * @see spec/v1/host-sample-test-seams.md
 */

import { describe, expect, it } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal, scaledTimeoutMs } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { queryTestEvents, requireEvents } from '../lib/event-log-query.js';
import { recordRequirement } from '../lib/requirement-ledger.js';
import { requirementIdForFile } from '../lib/scenario-disposition.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-failure';
const FILE = 'durability-poison-exhaustion.test.ts';
const REQ = requirementIdForFile(FILE);

/** Attempt-bearing event types. A `node.started` is attempt 1; each
 *  `node.retried` is one more. Counting BOTH means a host that re-dispatches
 *  without emitting `node.retried` is still caught. */
const ATTEMPT_TYPES = new Set(['node.started', 'node.retried']);

/** How long to watch for further attempts after the run reports terminal.
 *  Scaled: a longer wait is a STRONGER claim here, because it is a wait for
 *  something that must not happen. */
const QUIET_WINDOW_MS = 4_000;

function declaredAttemptBound(): number | null {
  const raw = process.env['OPENWOP_DECLARED_ATTEMPT_BOUND'];
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

// Recorded at MODULE scope, not inside the `it`. `describe.skipIf` never runs the
// callback, so a `recordRequirement` in the test body is dead code on exactly the
// path it exists to classify — the same shape as the note written after
// `ctx.skip()` threw, which left seven files carrying notes the ledger never saw.
// Caught by reading a CI log: this file and `failure-path.test.ts` both skipped
// against the postgres host, which does not advertise the fixture, and the row
// would have been recorded `blocked` with the unclassified-return marker instead
// of `inapplicable` with a reason.
if (SKIP_NO_FIXTURE) {
  recordRequirement(REQ, 'inapplicable', `fixture ${WORKFLOW_ID} not advertised`);
}

describe.skipIf(SKIP_NO_FIXTURE)('RFC 0158 §C.8 — poison work terminates within a bounded number of attempts', () => {
  it('reaches terminal AND stops being retried, asserted on the log rather than on the status alone', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status, req('openwop.it.durability-poison-exhaustion.reaches-terminal-and-stops-being-retried-asserted-on-the-log-rather-than-on-the', 
      'rest-endpoints.md',
      'POST /v1/runs MUST return 201 even for work that fails at runtime',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // ── First clause: a terminal, OPERATOR-VISIBLE state ─────────────────────
    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, req('openwop.it.durability-poison-exhaustion.reaches-terminal-and-stops-being-retried-asserted-on-the-log-rather-than-on-the', 
      'RFC 0158 §C.8',
      'deterministically failing work MUST reach a terminal, operator-visible state',
    )).toBe('failed');

    // ── The seam gate comes AFTER the control above, so a host that wired the
    //    fixture but not the log still proves the fixture ran. ───────────────
    const first = await queryTestEvents(runId);
    if (!first.ok) {
      const why = first.reason === 'seam_unavailable'
        ? 'event-log seam /v1/host/sample/test/runs/{runId}/events not wired — attempts are unobservable'
        : `event-log seam returned HTTP ${first.status}`;
      recordRequirement(REQ, 'blocked', why);
      return softSkip('blocked', why);
    }

    const events = requireEvents(first, 'RFC 0158 §C.8 attempt counting');
    // Non-vacuity: the failure must actually be ON the log. Without this, a host
    // returning an empty array would sail through every count comparison below,
    // since 0 === 0 after any wait.
    expect(events.some((e) => e.type === 'node.failed'), req('openwop.it.durability-poison-exhaustion.reaches-terminal-and-stops-being-retried-asserted-on-the-log-rather-than-on-the', 
      'RFC 0158 §C.8',
      'the run log MUST record the deterministic failure — an empty log makes every attempt count vacuous',
    )).toBe(true);

    const attemptsBefore = events.filter((e) => ATTEMPT_TYPES.has(e.type)).length;
    expect(attemptsBefore, req('openwop.it.durability-poison-exhaustion.reaches-terminal-and-stops-being-retried-asserted-on-the-log-rather-than-on-the', 
      'RFC 0158 §C.8',
      'at least one attempt MUST be recorded — zero attempts means nothing was delivered',
    )).toBeGreaterThan(0);

    // ── Second clause, the load-bearing one: NOT redelivered indefinitely ────
    await new Promise((r) => setTimeout(r, scaledTimeoutMs(QUIET_WINDOW_MS)));
    const second = await queryTestEvents(runId);
    const after = requireEvents(second, 'RFC 0158 §C.8 attempt counting (post-terminal)');
    const attemptsAfter = after.filter((e) => ATTEMPT_TYPES.has(e.type)).length;

    expect(attemptsAfter, req('openwop.it.durability-poison-exhaustion.reaches-terminal-and-stops-being-retried-asserted-on-the-log-rather-than-on-the', 
      'RFC 0158 §C.8',
      'attempts MUST NOT continue after the run reports terminal — a host still redelivering records more',
    )).toBe(attemptsBefore);

    // ── Optional ceiling, only when the operator supplies the declared bound ─
    const bound = declaredAttemptBound();
    if (bound !== null) {
      expect(attemptsAfter, req('openwop.it.durability-poison-exhaustion.reaches-terminal-and-stops-being-retried-asserted-on-the-log-rather-than-on-the', 
        'RFC 0158 §C.8 + §B.5',
        'total attempts MUST NOT exceed the operator-declared attempt bound',
      )).toBeLessThanOrEqual(bound);
    }

    recordRequirement(REQ, 'executed-pass', undefined, { assertionCount: bound === null ? 5 : 6 });
  });
});
