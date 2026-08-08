/**
 * RFC 0140 — replay side-effect suppression.
 *
 * A `mode:"replay"` fork re-executes a workflow. Without a constraint, that
 * re-execution re-performs the workflow's external effects: it sends the email
 * again, charges the card again, posts the webhook again. `idempotency.md`
 * Layer 2 cannot prevent it — its key includes `runId`, and a fork mints a new
 * one, so a fork's key space is disjoint from its source's by construction.
 *
 * A host advertising `replay.sideEffectSuppression: "recorded-outcome"`
 * promises that a side-effecting node does NOT execute during a replay:
 * it either reproduces the source run's recorded terminal outcome for the same
 * `(nodeId, attempt)`, or fails the node CLOSED with `replay_source_missing`.
 *
 * ## Why the fail-closed path is the load-bearing assertion
 *
 * The RFC's own §Conformance originally reasoned that an event-log assertion
 * "cannot distinguish suppressed from fired-and-recorded-identically", and
 * therefore demanded an out-of-band effect counter. That is true of the HAPPY
 * path — a node replayed from its recorded outcome looks, in the log, exactly
 * like a node that re-fired and happened to record the same thing.
 *
 * It is NOT true of the fail-closed path, and that asymmetry is what makes this
 * scenario runnable against any host with no operator instrumentation:
 *
 *   - A suppressing host, reaching a side-effecting node with NO recorded
 *     source outcome, MUST emit `node.failed` / `replay_source_missing`.
 *   - A non-suppressing host executes the node. Whatever happens then, it is
 *     not that: a successful effect yields `node.completed`, and a failed one
 *     yields some other error code.
 *
 * So `replay_source_missing` on a node the source never completed is
 * unforgeable positive evidence of suppression. The scenario is built on it.
 *
 * ## Construction
 *
 * `conformance-replay-side-effect` is `core.delay` → a side-effecting node. We
 * start it with a long delay, cancel mid-flight so the effect node never
 * records a terminal outcome, then fork `mode:"replay"`. Requirement 3 of
 * `replay.md` §"Side-effect suppression in replay" then applies to that node.
 *
 * @see spec/v1/replay.md §"Side-effect suppression in replay"
 * @see spec/v1/idempotency.md §"Layer 2" (why it cannot cover a fork)
 * @see RFCS/0140-replay-side-effect-suppression.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-replay-side-effect';
const EFFECT_NODE = 'effect';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

interface ReplayCapability {
  readonly supported?: boolean;
  readonly modes?: readonly string[];
  readonly sideEffectSuppression?: string;
}

interface RawEvent {
  readonly type?: string;
  readonly nodeId?: string | null;
  readonly payload?: { readonly error?: { readonly code?: string } };
  readonly data?: { readonly error?: { readonly code?: string } };
}

/**
 * Capability families are DOCUMENT-ROOT properties (RFC 0073); a top-level
 * `capabilities` wrapper is deprecated and deliberately not consulted here.
 * Matches `lib/profiles.ts:isReplayFork`.
 */
async function fetchReplay(): Promise<ReplayCapability | null> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return null;
  return (res.json as { replay?: ReplayCapability })?.replay ?? null;
}

async function readEvents(runId: string): Promise<readonly RawEvent[]> {
  const res = await driver.get(
    `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
  );
  if (res.status !== 200) throw new Error(`Failed to read events for ${runId}: ${res.status}`);
  return (res.json as { events?: RawEvent[] })?.events ?? [];
}

function errorCode(e: RawEvent): string | undefined {
  return e.payload?.error?.code ?? e.data?.error?.code;
}

describe('replay-side-effect-suppression: capability shape (RFC 0140 §A)', () => {
  it('sideEffectSuppression, when present, is one of the two defined values', async () => {
    const replay = await fetchReplay();
    if (replay?.sideEffectSuppression === undefined) return; // absent ⇒ "none"; nothing to check
    expect(
      replay.sideEffectSuppression,
      driver.describe(
        'capabilities.schema.json §replay.sideEffectSuppression',
        'sideEffectSuppression MUST be "recorded-outcome" or "none" when advertised',
      ),
    ).toMatch(/^(recorded-outcome|none)$/);
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('replay-side-effect-suppression: a replay does not re-fire effects', () => {
  it('fails a side-effecting node CLOSED with replay_source_missing when the source never recorded it', async (ctx) => {
    const replay = await fetchReplay();

    if (replay?.sideEffectSuppression !== 'recorded-outcome') {
      ctx.skip(); // host makes no such guarantee — RFC 0140 imposes nothing
      return;
    }
    if (!replay.modes?.includes('replay')) {
      ctx.skip(); // suppression is scoped to replay mode
      return;
    }

    // 1. Start the run with a delay long enough to cancel mid-flight, so the
    //    side-effecting node downstream never reaches a terminal outcome.
    //
    //    Kept SHORT on purpose: a `replay` fork re-executes from seq 0, so it
    //    re-runs this delay too (a delay is not side-effecting). A 30s delay
    //    here would make the fork outlive any sane poll budget — measured, not
    //    theorised: the first version of this scenario used 30s and timed out
    //    at step 3 with the fork still `running`.
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 5_000 },
    });
    expect(create.status, `Failed to start ${WORKFLOW_ID}`).toBe(201);
    const sourceRunId = (create.json as { runId: string }).runId;

    const cancel = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}/cancel`, {});
    expect(
      [200, 202, 204].includes(cancel.status),
      `cancel returned ${cancel.status}`,
    ).toBe(true);
    await pollUntilTerminal(sourceRunId, { timeoutMs: 15_000 });

    // Precondition, asserted rather than assumed: if the source somehow DID
    // complete the effect node, the replay would legitimately serve its
    // recorded outcome and this scenario would prove nothing.
    const sourceEvents = await readEvents(sourceRunId);
    expect(
      sourceEvents.some((e) => e.type === 'node.completed' && e.nodeId === EFFECT_NODE),
      'precondition: the cancelled source run must NOT have completed the effect node',
    ).toBe(false);

    // 2. Fork it in replay mode.
    const fork = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      mode: 'replay',
    });
    if (fork.status === 501) {
      ctx.skip(); // advertised but not implemented for this range — suite convention
      return;
    }
    expect(fork.status, 'fork should be accepted').toBe(201);
    const forkRunId = (fork.json as { runId: string }).runId;
    await pollUntilTerminal(forkRunId, { timeoutMs: 45_000 }); // re-runs the 5s delay before reaching `effect`

    // 3. THE assertion. A non-suppressing host executes the node; a suppressing
    //    host cannot, and has no recorded outcome to serve, so it must fail
    //    closed with this exact code.
    const forkEvents = await readEvents(forkRunId);
    const effectEvents = forkEvents.filter((e) => e.nodeId === EFFECT_NODE);

    expect(
      effectEvents.some((e) => e.type === 'node.completed'),
      driver.describe(
        'replay.md §"Side-effect suppression in replay" requirement 1',
        'the side-effecting node MUST NOT complete during a replay — completing it means the effect was performed',
      ),
    ).toBe(false);

    expect(
      effectEvents.some((e) => e.type === 'node.failed' && errorCode(e) === 'replay_source_missing'),
      driver.describe(
        'replay.md §"Side-effect suppression in replay" requirement 3',
        'a side-effecting node with no recorded source outcome MUST fail closed with replay_source_missing',
      ),
    ).toBe(true);
  });
});
