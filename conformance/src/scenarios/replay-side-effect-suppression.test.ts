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
import { recordRequirement } from '../lib/requirement-ledger.js';
import { requirementIdForScenario } from '../lib/requirement-registry.js';
import { driver } from '../lib/driver.js';
import { forkDeclined } from '../lib/fork-availability.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
    if (replay?.sideEffectSuppression === undefined) return softSkip('blocked', 'precondition not met — `replay?.sideEffectSuppression === undefined` returned early (absent ⇒ "none"; nothing to check) (seam, prior step, or fixture unavailable)'); // absent ⇒ "none"; nothing to check
    expect(
      replay.sideEffectSuppression,
      req('openwop.it.replay-side-effect-suppression.sideeffectsuppression-when-present-is-one-of-the-two-defined-values', 
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
      // `replay.md` §"Side-effect suppression" (corrected 2026-08-08): caveat 1 —
      // a replay MUST NOT call the external system twice — is UNCONDITIONAL and
      // `none` is not permission to re-fire; it only means no probeable mechanism
      // is declared. So this is not `inapplicable`: the obligation applies and is
      // unwitnessable here. Record the floor row `blocked` (RFC 0148 §A) so a
      // host advertising `none` cannot certify `openwop-replay-fork` on the
      // strength of determinism alone (H20 — re-advertising `recorded-outcome`
      // is what makes this leg run).
      try {
        recordRequirement(
          requirementIdForScenario('replay-side-effect-suppression.test.ts'),
          'blocked',
          `host advertises replay.sideEffectSuppression ${JSON.stringify(replay?.sideEffectSuppression ?? 'none')} — caveat 1 (a replay MUST NOT re-fire external effects) is unconditional but no declared mechanism is probeable; unwitnessed, not inapplicable`,
        );
      } catch {
        /* already recorded */
      }
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `replay?.sideEffectSuppression !== \'recorded-outcome\'` returned early (seam, prior step, or fixture unavailable)');
    }
    if (!replay.modes?.includes('replay')) {
      ctx.skip(); // suppression is scoped to replay mode
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!replay.modes?.includes(\'replay\')` returned early');
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
    expect(create.status, req('openwop.it.replay-side-effect-suppression.fails-a-side-effecting-node-closed-with-replay-source-missing-when-the-source-ne', 'replay.md §"Side-effect suppression in replay" requirement 1', `Failed to start ${WORKFLOW_ID}`)).toBe(201);
    const sourceRunId = (create.json as { runId: string }).runId;

    const cancel = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}/cancel`, {});
    expect(
      [200, 202, 204].includes(cancel.status),
      req('openwop.it.replay-side-effect-suppression.fails-a-side-effecting-node-closed-with-replay-source-missing-when-the-source-ne', 'replay.md §"Side-effect suppression in replay" requirement 1', `cancel returned ${cancel.status}`),
    ).toBe(true);
    await pollUntilTerminal(sourceRunId, { timeoutMs: 15_000 });

    // Precondition, asserted rather than assumed: if the source somehow DID
    // complete the effect node, the replay would legitimately serve its
    // recorded outcome and this scenario would prove nothing.
    const sourceEvents = await readEvents(sourceRunId);
    expect(
      sourceEvents.some((e) => e.type === 'node.completed' && e.nodeId === EFFECT_NODE),
      req('openwop.it.replay-side-effect-suppression.fails-a-side-effecting-node-closed-with-replay-source-missing-when-the-source-ne', 'replay.md §"Side-effect suppression in replay" requirement 1', 'precondition: the cancelled source run must NOT have completed the effect node'),
    ).toBe(false);

    // 2. Fork it in replay mode.
    const fork = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      mode: 'replay',
    });
    if (forkDeclined(fork.status, 'side-effect-suppression replay fork')) {
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `forkDeclined(fork.status, \'side-effect-suppression replay fork\')` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(fork.status, req('openwop.it.replay-side-effect-suppression.fails-a-side-effecting-node-closed-with-replay-source-missing-when-the-source-ne', 'replay.md §"Side-effect suppression in replay" requirement 1', 'fork should be accepted')).toBe(201);
    const forkRunId = (fork.json as { runId: string }).runId;
    await pollUntilTerminal(forkRunId, { timeoutMs: 45_000 }); // re-runs the 5s delay before reaching `effect`

    // 3. THE assertion. A non-suppressing host executes the node; a suppressing
    //    host cannot, and has no recorded outcome to serve, so it must fail
    //    closed with this exact code.
    const forkEvents = await readEvents(forkRunId);
    const effectEvents = forkEvents.filter((e) => e.nodeId === EFFECT_NODE);

    expect(
      effectEvents.some((e) => e.type === 'node.completed'),
      req('openwop.it.replay-side-effect-suppression.fails-a-side-effecting-node-closed-with-replay-source-missing-when-the-source-ne', 
        'replay.md §"Side-effect suppression in replay" requirement 1',
        'the side-effecting node MUST NOT complete during a replay — completing it means the effect was performed',
      ),
    ).toBe(false);

    expect(
      effectEvents.some((e) => e.type === 'node.failed' && errorCode(e) === 'replay_source_missing'),
      req('openwop.it.replay-side-effect-suppression.fails-a-side-effecting-node-closed-with-replay-source-missing-when-the-source-ne', 
        'replay.md §"Side-effect suppression in replay" requirement 3',
        'a side-effecting node with no recorded source outcome MUST fail closed with replay_source_missing',
      ),
    ).toBe(true);
  });
});

/**
 * `replay.md` requirement 4 — the manifest declaration is a classification FLOOR.
 *
 * A pack manifest may declare `role: "side-effect"`. Until 2026-08-14 the only
 * stated purpose of that field was that it "drives engine scheduling", so a host
 * was free to classify side-effecting nodes from a private list and never read
 * it. A tier-1 host did exactly that and a shipped `core.storage.blob-put` node
 * performed real object-store `PUT`s **during a replay**, past two independent
 * guards, because neither consulted the manifest that had declared the node
 * side-effecting all along.
 *
 * Requirement 4 makes the declaration binding: a host's own classifier is a floor
 * ABOVE it and never a substitute — more nodes may be treated as side-effecting,
 * never fewer.
 *
 * **This is a coherence gate, not a behavioral witness, and the distinction
 * matters.** Proving a host honours requirement 4 needs that host advertising
 * `recorded-outcome`, a pack node declaring the role, and an observable external
 * effect across a replay — none of which the suite can synthesize. What it CAN
 * do is ensure the declaration and the obligation cannot drift apart: if someone
 * renames the role value, or drops the requirement, this fails. RFC 0148 §A
 * resolves the behavioral half to `blocked`, not to a pass.
 */
describe.skipIf(V1_DIR === null)('replay.md req 4 — the manifest role is a classification floor', () => {
  const dir = V1_DIR as string;
  const replay = () => readFileSync(join(dir, 'replay.md'), 'utf8');
  const manifest = () =>
    readFileSync(join(dir, '..', '..', 'schemas', 'node-pack-manifest.schema.json'), 'utf8');

  it('the manifest still offers the role value the requirement binds', () => {
    // If `side-effect` is renamed or dropped from the taxonomy, requirement 4
    // binds a value nothing can declare — a rule with no reachable trigger.
    expect(
      manifest().includes('side-effect'),
      req('openwop.it.replay-side-effect-suppression.the-manifest-still-offers-the-role-value-the-requirement-binds', 'RFC 0140', 'node-pack-manifest.schema.json §role MUST still describe the `side-effect` value that ' +
        'replay.md requirement 4 makes binding. A requirement whose trigger no longer exists is ' +
        'not enforcement, it is decoration.'),
    ).toBe(true);
  });

  it('replay.md binds that declaration, naming the schema it comes from', () => {
    const doc = replay();
    expect(
      /MUST\*{0,2} be treated as side-effecting/.test(doc) && doc.includes('node-pack-manifest.schema.json'),
      req('openwop.it.replay-side-effect-suppression.replay-md-binds-that-declaration-naming-the-schema-it-comes-from', 'replay.md', 'replay.md §"Requirements when a host declares `sideEffectSuppression: \\"recorded-outcome\\"`" ' +
        'MUST bind a manifest-declared `role: "side-effect"` to the suppression obligation, and MUST ' +
        'name the schema the declaration comes from so a reader can find it.'),
    ).toBe(true);
  });

  it('a throw is named a backstop, not a discharge', () => {
    // The question a tier-1 host asked after deriving the floor: does a guarded
    // seam that THROWS discharge requirement 4, or must the replay succeed with
    // the recorded outcome? Requirements 1 and 2 are two obligations — a throw
    // satisfies "do not perform" and not "resolve the outcome" — but requirement
    // 4 did not say so, and the answer decides whether hundreds of typeIds need
    // classification or only seam coverage. An ambiguity that changes the size
    // of the work by two orders of magnitude is not a footnote.
    const doc = replay();
    expect(
      doc.includes('backstop, not a discharge'),
      req('openwop.it.replay-side-effect-suppression.a-throw-is-named-a-backstop-not-a-discharge', 'RFC 0140', 'replay.md requirement 4 MUST state that a guarded-seam throw is a backstop rather than a ' +
        'discharge. It satisfies requirement 1 (no effect) and not requirement 2 (resolve the ' +
        'recorded outcome), and a host reading the floor as "make it throw" ships a replay that ' +
        'fails where this section says it must succeed.'),
    ).toBe(true);
    expect(
      /safe and\s+non-conformant/.test(doc),
      'replay.md requirement 4 MUST name the posture a throw-only host is in — safe and ' +
        'non-conformant — because "nothing escapes" is a weaker claim than `recorded-outcome` ' +
        'makes, and a host that conflates them advertises in good faith and still lies.',
    ).toBe(true);
  });

  it('the floor direction is stated, not left to inference', () => {
    // The dangerous reading is symmetric: "my classifier disagrees, so the
    // manifest is wrong." The requirement is one-directional and says so.
    expect(
      replay().includes('MUST NOT classify fewer'),
      req('openwop.it.replay-side-effect-suppression.the-floor-direction-is-stated-not-left-to-inference', 'RFC 0140', 'replay.md requirement 4 MUST state the direction: a host classifier may treat MORE nodes as ' +
        'side-effecting and never fewer. Without the direction, a host that trusts its own list over ' +
        'the manifest can read the clause as permission to disagree.'),
    ).toBe(true);
  });
});
