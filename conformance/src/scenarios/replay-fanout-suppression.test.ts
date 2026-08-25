/**
 * Host-initiated fan-out is an external effect (`replay.md` §"Host-initiated
 * fan-out is an external effect").
 *
 * THE MUST NOT: a host that projects its event log outward — webhook delivery,
 * outbound streams, analytics or audit sinks — MUST NOT emit those outbound
 * deliveries for events a `mode: "replay"` fork re-emits as fixed history.
 *
 * WHY THIS SCENARIO EXISTS. Until now this was the largest normative MUST NOT on
 * the replay surface with **no conformance scenario and no SECURITY invariant**.
 * Two hosts had it deployed and the interop matrix still had to record it as
 * *not suite-witnessed*, because both rows rested on the hosts' own tests. A
 * host's own test is evidence about that host; it is not a witness of the wire.
 *
 * WHY IT IS OBSERVABLE AT ALL, unlike some other unmeasured invariants: the
 * outbound side has a real probe surface. The suite can BE the subscriber — boot
 * a local receiver, register it via `POST /v1/webhooks`, and read what actually
 * arrives. The property is stated over exactly what a subscriber sees, so this
 * asserts the thing itself rather than an adjacent proxy.
 *
 * ── The positive control is not decoration here; it is the whole test ────────
 * "No delivery arrived" passes identically when delivery never worked at all: a
 * mistyped URL, a subscription that was never created, a host that rejected the
 * receiver, a fixture that emitted nothing. That is a vacuous witness in its
 * purest form. So all three legs run in ONE test against ONE receiver and ONE
 * subscription, and the absence is only ever asserted AFTER presence has been
 * proven on that exact wiring. Do not split this into separate `it` blocks —
 * separate blocks re-register, and a re-registration that silently fails turns
 * the negative leg back into a vacuous pass.
 *
 * ── Why the timeout knob makes this leg STRICTER, not looser ─────────────────
 * Absence has nothing to poll for, so the negative is "nothing arrived within
 * N". `OPENWOP_POLL_TIMEOUT_SCALE` multiplies N. The reflex on seeing a timeout
 * multiplier is that it weakens assertions — here it is the reverse: waiting
 * longer for a delivery that must never come is a STRONGER claim, and an
 * operator raising the scale on a slow host makes this scenario harder to pass,
 * not easier.
 *
 * ── Deliberately NOT in the `openwop-replay-fork` floor ──────────────────────
 * This scenario needs the host to accept a loopback receiver. A host with an
 * SSRF guard on `POST /v1/webhooks` correctly refuses one, and the suite's
 * standing operator contract asks such hosts for an opt-in
 * (`OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` on the SQLite reference). At least one
 * certifying host rejects it today. Putting a receiver-gated row in that
 * profile's floor would make the profile un-certifiable for a host whose
 * SECURITY CONTROL IS CORRECT, and would read in the matrix as a regression that
 * is not one. Capability-gated, outside the floor. Moving it into a floor is a
 * separate decision needing an RFC 0148 §C argument.
 *
 * ── One interpretive call, stated rather than buried ─────────────────────────
 * The subscription below is for `run.completed`. That is a LIFECYCLE event, and
 * `replay.md` notes lifecycle events are "ambiguous noise" next to a
 * recorded-fact event like `memory.written`, which is "a false statement". The
 * reading applied here is that a replay fork reproduces the source's log, so the
 * `run.completed` in the fork's log is RE-EMITTED HISTORY and therefore squarely
 * inside "any event re-emitted as fixed history is in scope". A host that
 * suppressed only recorded-fact events while delivering re-emitted lifecycle
 * events would fail this scenario.
 *
 * That reading is no longer an inference: `replay.md` was clarified on
 * 2026-08-19 to say the contrast RANKS THE HARM and does not narrow the scope,
 * because the requirement above it already decides the question — replay-ness is
 * read from the run, never from the event type, so suppressing by event type is
 * selecting by event type. The paragraph stays here because a host that reads
 * the older text should meet a visible claim rather than a surprise red.
 *
 * @see spec/v1/replay.md §"Host-initiated fan-out is an external effect"
 * @see spec/v1/webhooks.md §"Register"
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { forkDeclined } from '../lib/fork-availability.js';
import { discoveryFamilies, readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal, scaledTimeoutMs } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { discoverOwnedTenant } from '../lib/webhook-receiver.js';
import { recordRequirement } from '../lib/requirement-ledger.js';
import { requirementIdForFile } from '../lib/scenario-disposition.js';

/**
 * RFC 0148 §A — the MUST NOT gets its OWN disposition, separate from the file's.
 *
 * Without this the file would be recorded `executed-pass` off leg 1's assertions
 * even on a run where the fork returned 501 and the MUST NOT was never
 * exercised. That is a partial witness reading as a full one: the positive
 * control genuinely passed, so the file is not lying, but the matrix cell for
 * this requirement would claim coverage the run did not produce. Recording the
 * requirement explicitly at every exit keeps the cell honest whichever path is
 * taken. `setup.ts` records the file's aggregate under the SAME id and catches
 * the resulting conflict — "a scenario that recorded its own file id first
 * wins" — so this is the sanctioned override, not a second row.
 *
 * It MUST be `requirementIdForFile`, not `requirementIdForScenario`. Those two
 * agree only for files in a certification FLOOR; for a non-floor scenario like
 * this one they differ (`openwop.scenario.<name>` vs the registry id). Recording
 * the registry id here would mint an ORPHAN requirement nothing reads, while the
 * row the bundle actually carries kept the file-level `executed-pass` — a fix
 * that changes nothing and looks like it did.
 */
const REQUIREMENT_ID = requirementIdForFile('replay-fanout-suppression.test.ts');

interface Delivered {
  readonly body: string;
}

async function startReceiver(): Promise<{ server: Server; url: string; received: Delivered[] }> {
  const received: Delivered[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('receiver address unavailable');
  return { server, url: `http://127.0.0.1:${addr.port}/`, received };
}

let activeServer: Server | null = null;
afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;
  }
});

/** Deliveries whose body mentions this run id — the fan-out attributable to it. */
function forRun(received: readonly Delivered[], runId: string): Delivered[] {
  return received.filter((d) => d.body.includes(runId));
}

/**
 * Wait `ms`, then report what arrived. Used for the NEGATIVE leg, where there is
 * no event to poll for. Scaled, per the note in the file header.
 */
async function quietWindow(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, scaledTimeoutMs(ms)));
}

/** Grace for fire-and-forget delivery on the POSITIVE legs. */
const DELIVERY_GRACE_MS = 1_500;
/**
 * How long the replay fork is watched for a delivery that must never arrive.
 * Deliberately several times the positive grace: a host that merely DELAYS
 * fan-out rather than suppressing it must not pass by being slow.
 */
const SUPPRESSION_WINDOW_MS = 6_000;

describe('replay-fanout-suppression: a replay fork MUST NOT fan out re-emitted events', () => {
  it('delivers for a live run, suppresses for a replay fork, and delivers again for a branch fork', async (ctx) => {
    const disco = await driver.get('/.well-known/openwop');
    const caps = discoveryFamilies(disco.json) as {
      webhooks?: { supported?: boolean };
      replay?: { fork?: boolean; supported?: boolean };
    };
    if (caps.webhooks?.supported !== true) {
      recordRequirement(REQUIREMENT_ID, 'inapplicable', 'host does not advertise webhooks.supported — outbound fan-out has no probe surface on this host');
      return softSkip('inapplicable', '[replay-fanout-suppression] host does not advertise webhook support');
    }
    if (!isFixtureAdvertised('conformance-noop')) {
      recordRequirement(REQUIREMENT_ID, 'inapplicable', 'conformance-noop fixture not advertised — no run to fan out');
      return softSkip('inapplicable', '[replay-fanout-suppression] conformance-noop not advertised');
    }

    const receiver = await startReceiver();
    activeServer = receiver.server;

    const ownedTenant = await discoverOwnedTenant(driver);
    const reg = await driver.post('/v1/webhooks', {
      url: receiver.url,
      events: ['run.completed'],
      ...(ownedTenant ? { tenantId: ownedTenant } : {}),
    });
    if (reg.status === 400 && (reg.json as { error?: string }).error === 'webhook_url_rejected') {
      // The host's SSRF guard refused a loopback destination. That is CORRECT
      // host behaviour, not a failure — see the floor note in the file header.
      recordRequirement(
        REQUIREMENT_ID,
        'blocked',
        "precondition not met — body.error === 'webhook_url_rejected'; the host's SSRF guard refused the loopback "
          + 'receiver, which is correct host behaviour, so this requirement is unobservable rather than unmet',
      );
      return softSkip(
        'blocked',
        '[replay-fanout-suppression] host SSRF guard rejected the loopback receiver; '
          + 'set OPENWOP_WEBHOOK_ALLOW_PRIVATE=true on the host (or equivalent) to run',
      );
    }
    expect(reg.status, driver.describe(
      'webhooks.md §"Register"',
      'POST /v1/webhooks MUST return 201 on success',
    )).toBe(201);

    // ── LEG 1 — POSITIVE CONTROL. Prove this wiring delivers at all. ─────────
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
    expect(create.status, 'failed to start conformance-noop').toBe(201);
    const sourceRunId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(sourceRunId, { timeoutMs: 10_000 });
    await quietWindow(DELIVERY_GRACE_MS);

    expect(
      forRun(receiver.received, sourceRunId).length,
      driver.describe(
        'webhooks.md §"Register"',
        'POSITIVE CONTROL: the host must deliver the source run\'s events to this receiver — '
          + 'without this, every "no delivery" assertion below is vacuous',
      ),
    ).toBeGreaterThan(0);

    // ── CAPABILITY GATE (added 2026-08-25) ──────────────────────────────────
    // This is the ONLY scenario in the replay family that never checked whether
    // the host advertises replay before forking — every sibling reads
    // `replay.supported` first. That omission is why it was the one scenario
    // reaching the fork seam on a host that does not implement it, and why it
    // hard-failed `expected 404 to be 201` on every CI run of `main` while the
    // siblings quietly returned at their capability check.
    //
    // `inapplicable`, not `blocked`: a host that does not advertise replay is
    // outside this MUST NOT's scope entirely, and `blocked` would claim the
    // requirement applies but could not be witnessed — a stronger claim than
    // the evidence supports. Recorded explicitly because LEG 1 above asserted,
    // so the file-level disposition would otherwise be `executed-pass`.
    const replayCap = await readCapabilityFamily<{ supported?: boolean; modes?: unknown }>('replay');
    if (replayCap?.supported !== true) {
      recordRequirement(
        REQUIREMENT_ID,
        'inapplicable',
        'host does not advertise `replay.supported: true`, so a replay fork cannot occur and this MUST NOT '
          + 'has nothing to constrain on this host',
      );
      ctx.skip();
      return;
    }

    // ── LEG 2 — THE MUST NOT. A replay fork re-emits; it must not deliver. ───
    const replay = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      mode: 'replay',
    });
    if (forkDeclined(replay.status, 'fanout-suppression replay fork')) {
      // Leg 1 already asserted, so the FILE is `executed-pass` — but the MUST
      // NOT was never exercised, and that is what this row must say. The
      // explicit record wins over the file-level one (setup.ts).
      //
      // 404 and 403 were NOT handled here until 2026-08-25, only 501. The
      // postgres reference host 404s this route, so this was the one scenario
      // in the replay family that actually reached the seam — and it hard-
      // failed `expected 404 to be 201` on every CI run of `main`, absorbed by
      // the 85% pass-rate floor. The suite required a host to implement the
      // route in order to say it had not implemented the route.
      recordRequirement(
        REQUIREMENT_ID,
        'blocked',
        `replay fork returned ${replay.status} — the re-emission this requirement is stated over never happened, `
          + 'so the absence of deliveries below would prove nothing',
      );
      ctx.skip();
      return;
    }
    expect(replay.status, 'replay fork should be accepted').toBe(201);
    const replayRunId = (replay.json as { runId: string }).runId;
    await pollUntilTerminal(replayRunId, { timeoutMs: 30_000 });
    await quietWindow(SUPPRESSION_WINDOW_MS);

    expect(
      forRun(receiver.received, replayRunId).map((d) => d.body.slice(0, 200)),
      driver.describe(
        'replay.md §"Host-initiated fan-out is an external effect"',
        'a mode:"replay" fork MUST NOT emit outbound deliveries for the events it re-emits as fixed history — '
          + 'delivering one asserts to a subscriber that something happened in this run which did not',
      ),
    ).toEqual([]);

    // Guard against the OTHER vacuity: a fork that emitted nothing at all would
    // also deliver nothing. The fork's own log MUST still carry the re-emitted
    // events (`replay.md`: suppression is outbound-only, the fork's event log
    // still carries them). Without this, a host that simply failed the fork
    // would pass leg 2.
    const forkEvents = await driver.get(`/v1/runs/${encodeURIComponent(replayRunId)}/events`);
    expect(forkEvents.status, 'fork events must be readable').toBe(200);
    const forkEventList = (forkEvents.json as { events?: { type?: string }[] }).events ?? [];
    expect(
      forkEventList.length,
      driver.describe(
        'replay.md §"Host-initiated fan-out is an external effect"',
        'suppression is OUTBOUND ONLY — the fork\'s own event log MUST still carry the re-emitted events, '
          + 'so an empty fork log means leg 2 proved nothing',
      ),
    ).toBeGreaterThan(0);

    // The MUST NOT has now been exercised against wiring proven to deliver, on a
    // fork proven to have re-emitted. Recorded here rather than after leg 3,
    // because leg 3 pins the boundary and may legitimately not run.
    recordRequirement(REQUIREMENT_ID, 'executed-pass', undefined, { assertionCount: 4 });

    // ── LEG 3 — the boundary. `branch` is explicitly OUT of scope. ───────────
    // This is what distinguishes "reads replay-ness from the RUN" from "silences
    // anything that is a fork". A host that suppressed both would pass legs 1-2
    // and be wrong: a branch fork's events are new facts and its effects are the
    // ones the operator asked for.
    const branch = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      mode: 'branch',
    });
    if (branch.status === 501 || branch.status === 400) {
      // branch not offered on this range — leg 2 still stands on its own.
      return;
    }
    expect(branch.status, 'branch fork should be accepted').toBe(201);
    const branchRunId = (branch.json as { runId: string }).runId;
    await pollUntilTerminal(branchRunId, { timeoutMs: 30_000 });
    await quietWindow(DELIVERY_GRACE_MS);

    expect(
      forRun(receiver.received, branchRunId).length,
      driver.describe(
        'replay.md §"Host-initiated fan-out is an external effect"',
        'a branch fork is deliberately OUT of scope — its events are new facts, so suppressing them '
          + 'means the host keyed on "is a fork" rather than on replay-ness read from the run',
      ),
    ).toBeGreaterThan(0);
  });
});
