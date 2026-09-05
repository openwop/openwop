/**
 * `spec/v2/core/replay.md` §Endpoint — the fork prefix boundary is EXCLUSIVE
 * (suite 2.0.0, target major 2; unaided; gated on `replay`; two runs created).
 *
 * "Events with `sequence < fromSeq` are fixed history; events `>= fromSeq` are
 * re-executed." A host that copies `sequence <= fromSeq` inherits one event too
 * many and re-executes from one event too late.
 *
 * Why this file exists. Until rc.60 the only major-2 witness of that boundary
 * was `v2-fork-a-v1-run`, which is driven through the conformance seam and sits
 * on the seams floor — so a host that does not advertise the seams profile was
 * never measured on it, and `v2-run-fork-refusals` (the unaided fork scenario)
 * asserts only the refusals and never reads the forked log. A tier-1 host
 * shipped `<= fromSeq` and passed every unaided major-2 scenario; it found the
 * defect only when fixing 1-based sequence numbering made the off-by-one
 * visible — two errors cancelling. The v1 scenarios that do check the prefix
 * (`replay-fork`, `replay-fork-arbitrary`, `feedback-fork-not-copied`) are
 * `majors: [1]` and never run here.
 *
 * The falsifiable shape, chosen to be race-free and implementation-agnostic.
 * `fromSeq` is placed on a `node.completed` that is not the run's last, so the
 * source's event AT `fromSeq` is one re-execution cannot honestly reproduce at
 * that same sequence: an exclusive host restarts that node, and its event at
 * `fromSeq` is the fresh `node.started`; an inclusive host inherited the
 * `node.completed` and re-executes from `fromSeq + 1`, so its event at
 * `fromSeq` is the source's, verbatim. Both logs are read after they settle.
 *
 * Measured on the reference host (exclusive) at `fromSeq: 4` of an 8-event
 * `conformance-multi-node` log: source `4 node.completed b`, fork
 * `4 node.started b`, fork 9 events to the source's 8 — the fork is LONGER,
 * because node `b` had started inside the prefix and its completion is
 * re-executed. Length is therefore not the discriminator and this file does not
 * assert on it; the event at the boundary is.
 *
 * What this file deliberately does NOT assert: the CONTENT of the re-executed
 * tail, determinism across two forks, timing, and effect re-fire suppression.
 * Those are `replay.md` §Replay determinism and the seams floor's, witnessed in
 * `replay-fork-arbitrary` (major 1) and `v2-effect-seam-no-refire` (seams).
 *
 * @see spec/v2/core/replay.md §Endpoint
 * @see spec/v2/core/runs.md §Fork
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.fork-prefix-boundary';
const DOC = 'spec/v2/core/replay.md §Endpoint';
const MULTI = 'conformance-multi-node';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Ev { readonly sequence?: unknown; readonly type?: unknown }

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

/** Every event of a run, in sequence order, read through the poll surface. */
async function logOf(runId: string): Promise<Ev[] | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1&streamMode=debug`));
  if (res === null || res.status !== 200) return null;
  const events = (res.json as { events?: unknown } | undefined)?.events;
  if (!Array.isArray(events)) return null;
  return (events as Ev[]).filter((e) => typeof e.sequence === 'number').sort((a, b) => (a.sequence as number) - (b.sequence as number));
}

/** Poll until the run is terminal or the bound elapses; returns the last status seen. */
async function settle(runId: string, ms = 20_000): Promise<string | null> {
  const deadline = Date.now() + ms;
  let status: string | null = null;
  while (Date.now() < deadline) {
    const res = await http(() => driver.get(`/runs/${enc(runId)}`));
    status = res?.status === 200 ? String((res.json as { status?: unknown } | undefined)?.status ?? '') : status;
    if (status !== null && TERMINAL.has(status)) return status;
    await new Promise((r) => setTimeout(r, 200));
  }
  return status;
}

describe('v2 run-fork-prefix (replay.md §Endpoint — the boundary is exclusive)', () => {
  it('a replay fork inherits exactly [0, fromSeq): the event at fromSeq is re-executed, never carried over', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay) — forkRun is gated on replay (runs.md §Surface)');
    if (!isFixtureAdvertised(MULTI)) return softSkip('inapplicable', `${MULTI} fixture not advertised — no multi-event deterministic run to fork at a mid-log point`);

    const created = await http(() => driver.post('/runs', { workflowId: MULTI }));
    if (created === null || created.status !== 201) return softSkip('blocked', `POST /runs {workflowId: ${MULTI}} answered ${created?.status ?? 'no response'} ${readErrorCode(created?.json) ?? ''}`.trim());
    const runId = (created.json as { runId?: unknown }).runId;
    if (typeof runId !== 'string') return softSkip('blocked', 'the 201 carried no runId');

    const sourceStatus = await settle(runId);
    if (sourceStatus === null || !TERMINAL.has(sourceStatus)) return softSkip('blocked', `the source run did not settle within 20 s (last status: ${sourceStatus ?? 'unreadable'}) — a mid-log fork point cannot be chosen from an unfinished log`);
    const source = await logOf(runId);
    if (source === null) return softSkip('blocked', `GET /runs/{runId}/events/poll did not answer 200 with events[] for the source run`);

    // The fork point: a `node.completed` that is not the run's last event, so
    // the source's event AT fromSeq is one an honest re-execution cannot
    // reproduce at that sequence (it restarts the node instead).
    const seqs = source.map((e) => e.sequence as number);
    const last = Math.max(...seqs);
    const point = source.find((e) => e.type === 'node.completed' && (e.sequence as number) > 0 && (e.sequence as number) < last);
    if (point === undefined) return softSkip('inapplicable', `no node.completed sits strictly inside the ${source.length}-event source log (types: ${[...new Set(source.map((e) => String(e.type)))].join(', ')}) — this host's log shape offers no fork point where an inherited row and a re-executed row are distinguishable`);
    const fromSeq = point.sequence as number;

    const fork = await http(() => driver.post(`/runs/${enc(runId)}:fork`, { mode: 'replay', fromSeq }));
    if (fork === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    if (fork.status === 404) return softSkip('blocked', 'POST /runs/{runId}:fork answered 404 — forkRun is served by a host advertising replay (runs.md §Surface)');
    expect(fork.status, req(ID, 'spec/v2/core/runs.md §Fork', `a replay fork at a sequence in the source log MUST answer 201 — got ${fork.status} ${readErrorCode(fork.json) ?? ''}`.trim())).toBe(201);
    const forkId = (fork.json as { runId?: unknown }).runId;
    if (typeof forkId !== 'string') return softSkip('blocked', 'the fork 201 carried no runId');

    const forkStatus = await settle(forkId);
    if (forkStatus === null || !TERMINAL.has(forkStatus)) return softSkip('blocked', `the fork did not settle within 20 s (last status: ${forkStatus ?? 'unreadable'}) — the inherited-prefix length is only comparable on a finished log`);
    const forked = await logOf(forkId);
    if (forked === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll did not answer 200 with events[] for the fork');

    // The prefix itself: every inherited row matches the source by sequence and
    // type. This is the fixed-history claim, stated positively.
    const inherited = forked.filter((e) => (e.sequence as number) < fromSeq);
    expect(
      inherited.map((e) => `${String(e.sequence)}:${String(e.type)}`),
      req(ID, DOC, `the fork MUST inherit [0, ${fromSeq}) from the source verbatim by sequence and type`),
    ).toEqual(source.filter((e) => (e.sequence as number) < fromSeq).map((e) => `${String(e.sequence)}:${String(e.type)}`));

    // The boundary. The source's event at `fromSeq` is re-executed, not fixed
    // history, so it MUST NOT appear at its own sequence in the fork. An
    // inclusive host copies [0, fromSeq] and that is exactly what it shows.
    const at = forked.find((e) => (e.sequence as number) === fromSeq);
    if (at === undefined) return softSkip('blocked', `the fork's log has no event at sequence ${fromSeq} (last ${Math.max(...forked.map((e) => e.sequence as number))}) — the boundary is unobservable on this log`);
    expect(
      String(at.type),
      req(ID, DOC, `the event at sequence ${fromSeq} is re-executed, not fixed history: the fork MUST NOT carry the source's ${String(point.type)} at that sequence — seeing it means the prefix was copied inclusively ([0, ${fromSeq}] instead of [0, ${fromSeq}))`),
    ).not.toBe(String(point.type));
  }, 60_000);
});
