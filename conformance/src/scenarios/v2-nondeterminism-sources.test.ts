/**
 * v2 — declared nondeterminism replays its recorded values (RFC 0237 §B;
 * `spec/v2/core/replay.md` §Declared nondeterminism; suite 2.45.23, target
 * major 2; fixture-gated).
 *
 * A host listing `nondeterminismPolicy.sources` MUST record each value drawn
 * from a listed source where it is read, and a `replay` fork MUST reproduce it
 * rather than draw again. The log entry itself is host-internal; what a client
 * sees is the fork's output. So the leg runs `conformance-nondeterminism` (one
 * conformance-reserved node that writes one value per listed source to the run
 * outputs), forks it in `replay` mode from `fromSeq: 0`, and requires each listed
 * source's output to be byte-equal.
 *
 *   0237.declared-source-replays   for every listed source, the fork's output
 *                                  equals the source run's.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `nondeterminismPolicy.sources`
 * absent, the fixture not advertised, or `replay` mode not served ⇒
 * `inapplicable`; a create or fork the host refuses ⇒ `blocked`.
 *
 * @see RFCS/0237-nondeterminism-sources.md §B, §D
 * @see spec/v2/core/replay.md §Declared nondeterminism
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';

const DOC = 'spec/v2/core/replay.md §Declared nondeterminism';
const ID = 'openwop.requirement.0237.declared-source-replays';
const FIXTURE = 'conformance-nondeterminism';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** `run.completed.outputs`, read from the run's event log. */
async function outputsOf(runId: string): Promise<Record<string, unknown> | null> {
  const r = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`));
  const events = (r?.json as { events?: Array<{ type?: string; payload?: { outputs?: unknown } }> } | null)?.events ?? [];
  const done = events.find((e) => e.type === 'run.completed');
  const out = done?.payload?.outputs;
  return out !== null && typeof out === 'object' ? (out as Record<string, unknown>) : null;
}

describe('v2 declared nondeterminism replays (RFC 0237 §B — fixture-gated)', () => {
  it('a replay fork reproduces every value drawn from a listed source', async () => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const policy = await familyAdvertised('nondeterminismPolicy');
    const sources = Array.isArray(policy?.['sources']) ? (policy['sources'] as unknown[]).filter((s): s is string => typeof s === 'string') : [];
    if (sources.length === 0) return softSkip('inapplicable', 'the host lists no nondeterminismPolicy.sources');
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `the host does not advertise the ${FIXTURE} fixture`);
    const modes = (await familyAdvertised('replay'))?.['modes'];
    if (!Array.isArray(modes) || !modes.includes('replay')) return softSkip('inapplicable', 'the host does not serve replay-mode forks');

    const created = await http(() => driver.post('/runs', { workflowId: FIXTURE }));
    const runId = (created?.json as { runId?: unknown } | null | undefined)?.runId;
    if (created?.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs {workflowId: ${FIXTURE}} answered ${created?.status ?? 'no response'} ${readErrorCode(created?.json) ?? ''}`.trim());
    const source = await pollUntilTerminal(runId, { timeoutMs: 20_000 });
    if (source.status !== 'completed') return softSkip('blocked', `the ${FIXTURE} run ended ${source.status}, not completed`);
    const first = await outputsOf(runId);
    expect(first !== null, req(ID, DOC, `run.completed MUST carry outputs for ${FIXTURE}`)).toBe(true);

    const fork = await http(() => driver.post(`/runs/${encodeURIComponent(runId)}:fork`, { mode: 'replay', fromSeq: 0 }));
    const forkId = (fork?.json as { runId?: unknown } | null | undefined)?.runId;
    if (fork === null || fork.status >= 300 || typeof forkId !== 'string') return softSkip('blocked', `the replay fork answered ${fork?.status ?? 'no response'} ${readErrorCode(fork?.json) ?? ''}`.trim());
    const forked = await pollUntilTerminal(forkId, { timeoutMs: 20_000 });
    if (forked.status !== 'completed') return softSkip('blocked', `the replay fork ended ${forked.status}, not completed`);
    const second = await outputsOf(forkId);

    for (const s of sources) {
      expect(typeof first?.[s], req(ID, DOC, `the ${FIXTURE} outputs MUST carry a value for the listed source ${s} (got ${JSON.stringify(first)})`)).toBe('string');
      expect(second?.[s], req(ID, DOC, `a replay fork MUST reproduce the value drawn from the listed source ${s}: the source run drew ${JSON.stringify(first?.[s])}, the fork ${JSON.stringify(second?.[s])}`)).toBe(first?.[s]);
    }
  }, 60_000);
});
