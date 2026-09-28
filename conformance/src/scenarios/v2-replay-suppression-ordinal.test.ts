/**
 * `spec/v2/core/replay.md` §Suppression rule 2 — a replay fork resolves a
 * side-effecting node's outcome keyed on `(sourceRunId, nodeId, n)`, where `n`
 * counts the node's `node.started` events through this execution, including
 * retries, later visits and the fork's inherited prefix (openwop#1718, suite
 * 2.43.2, target major 2).
 *
 * The rule said `(nodeId, attempt)`. In a run where a node executes more than
 * once (a loop back over an edge), that key names no single execution: a host
 * counting attempts per execution resolves every visit from the first visit's
 * outcome, and one selecting the latest recorded outcome does the same when
 * only one exists.
 *
 * Construction (`conformance-replay-ordinal-loop`): start → effect → wait →
 * effect, so `effect` executes twice. The suite cancels the source inside
 * `wait`, after `effect`'s first execution completed and before its second, and
 * forks `mode: "replay"` at `effect`'s first `node.started`. In the fork:
 *   - `effect` execution 1 (n = 1) has a recorded outcome and resolves from it;
 *   - `effect` execution 2 (n = 2) has none, so it MUST fail closed with
 *     `replay_source_missing` (rule 3) and MUST NOT complete.
 * Only the fail-closed half is asserted as the discriminator: a host keyed on
 * the wrong ordinal completes execution 2 from execution 1's outcome.
 *
 * Gated on `replay` and on the fixture, which only a host that runs cycles and
 * suppresses side effects advertises. No such host is known today (the v2
 * reference host does not loop), so the row has a negative control only — see
 * RFC 0140's gap register.
 *
 * @see spec/v2/core/replay.md §Suppression
 * @see RFCS/0140-replay-side-effect-suppression.md
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { gateFamily } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';

const ID = 'openwop.requirement.replay.suppression-execution-ordinal';
const DOC = 'spec/v2/core/replay.md §Suppression';
const FIXTURE = 'conformance-replay-ordinal-loop';
const EFFECT = 'effect';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Ev { readonly sequence?: unknown; readonly type?: unknown; readonly nodeId?: unknown; readonly payload?: { readonly nodeId?: unknown; readonly error?: { readonly code?: unknown } } }

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const nodeOf = (e: Ev): unknown => e.nodeId ?? e.payload?.nodeId;

async function logOf(runId: string): Promise<Ev[]> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1&streamMode=debug`));
  const events = (res?.json as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? (events as Ev[]).filter((e) => typeof e.sequence === 'number').sort((a, b) => (a.sequence as number) - (b.sequence as number)) : [];
}
async function statusOf(runId: string): Promise<string | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
}
async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('v2 replay-suppression-ordinal (replay.md §Suppression rule 2, openwop#1718)', () => {
  it('a replay fork resolves each execution of a looped side-effecting node by its own ordinal, failing closed where none was recorded', async () => {
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `fixture ${FIXTURE} is not advertised — the host does not run cycles with a side-effecting node`);

    const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs: { delayMs: 3000 } }));
    const runId = (created?.json as { runId?: unknown } | null)?.runId;
    if (created === null || created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs (${FIXTURE}) answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim());

    // Cancel inside `wait`: effect's first execution completed, its second not yet started.
    const firstDone = await until(async () => (await logOf(runId)).some((e) => e.type === 'node.completed' && nodeOf(e) === EFFECT), scaledTimeoutMs(10_000));
    if (!firstDone) return softSkip('blocked', `the source run never completed ${EFFECT}'s first execution`);
    await http(() => driver.post(`/runs/${enc(runId)}/cancel`, {}));
    if (!(await until(async () => TERMINAL.has((await statusOf(runId)) ?? ''), scaledTimeoutMs(10_000)))) return softSkip('blocked', 'the cancelled source run did not settle');
    const source = await logOf(runId);
    const effectStarts = source.filter((e) => e.type === 'node.started' && nodeOf(e) === EFFECT);
    const effectDone = source.filter((e) => e.type === 'node.completed' && nodeOf(e) === EFFECT);
    if (effectStarts.length !== 1 || effectDone.length !== 1) return softSkip('blocked', `the source was cancelled with ${effectStarts.length} starts and ${effectDone.length} completions of ${EFFECT}, not exactly one of each — the second execution cannot be isolated`);

    const fromSeq = effectStarts[0]!.sequence as number;
    const fork = await http(() => driver.post(`/runs/${enc(runId)}:fork`, { mode: 'replay', fromSeq }));
    const forkId = (fork?.json as { runId?: unknown } | null)?.runId;
    if (fork === null || fork.status !== 201 || typeof forkId !== 'string') return softSkip('blocked', `POST /runs/{runId}:fork answered ${fork?.status ?? 'nothing'} ${readErrorCode(fork?.json) ?? ''} — forkRun owns that contract`.trim());
    await until(async () => TERMINAL.has((await statusOf(forkId)) ?? ''), scaledTimeoutMs(20_000));
    const forked = await logOf(forkId);
    const forkEffect = forked.filter((e) => nodeOf(e) === EFFECT);

    expect(
      forkEffect.filter((e) => e.type === 'node.completed').length,
      req(ID, DOC, 'only the execution with a recorded outcome (n = 1) may complete in the fork; execution 2 has none and MUST NOT complete'),
    ).toBeLessThanOrEqual(1);
    expect(
      forkEffect.some((e) => e.type === 'node.failed' && e.payload?.error?.code === 'replay_source_missing'),
      req(ID, `${DOC} rules 2–3`, `the second execution of ${EFFECT} (n = 2) has no recorded source outcome and MUST fail closed with replay_source_missing — a host keyed on (nodeId, attempt), or on the latest outcome, resolves it from the first execution instead`),
    ).toBe(true);
  }, 90_000);
});
