/**
 * `spec/v2/core/runs.md` §Diff and ancestry — a fork has no ancestry parent
 * (suite 2.43.2, target major 2; gated on `replay` and on
 * `multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`;
 * one run created plus one branch fork).
 *
 * `getRunAncestry`'s `parent` is the run that dispatched this one, and `cause`
 * names the composition mechanism it used (`core.subWorkflow`,
 * `core.dispatch`, `mcp-tool-call`, `a2a-message`). A fork is not dispatched:
 * its lineage is `sourceRunId` on the fork `201` and `parentRunId` on the
 * snapshot, and its ancestry `parent` MUST be `null`. A host that reuses its
 * fork link as an ancestry parent reports `cause: core.subWorkflow` for a run
 * no parent dispatched, and fails here.
 *
 * The source run's own ancestry is the control: it was created by `POST /runs`,
 * so its `parent` is `null` too. Without it a host answering `null` for every
 * run would pass the fork leg without being measured on it, and one answering
 * non-null for every run would fail it for the wrong reason.
 *
 * Its own file, not a leg of `v2-run-fork-refusals`: the ancestry gate is
 * absent on most v2 hosts, and an `inapplicable` leg would turn that file's
 * row into a `partial-witness` pass on every one of them.
 *
 * @see spec/v2/core/runs.md §Diff and ancestry
 * @see spec/v2/core/runs.md §Fork
 * @see schemas/v2/run-ancestry-response.schema.json
 * @see RFCS/0040-multi-agent-cross-host-causation.md §C
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily, familyAdvertised } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0040.fork-has-no-ancestry-parent';
const DOC = 'spec/v2/core/runs.md §Diff and ancestry';
const NOOP = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
async function status(runId: string): Promise<string | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
}

describe('v2 run-fork-ancestry (runs.md §Diff and ancestry)', () => {
  it('a branch fork is not a composition child: its ancestry parent is null', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('replay'))) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay) — forkRun is gated on replay (runs.md §Surface)');
    const chc = ((await familyAdvertised('multiAgent'))?.['executionModel'] as { crossHostCausation?: { ancestryEndpointSupported?: unknown } } | undefined)?.crossHostCausation;
    if (chc?.ancestryEndpointSupported !== true) return softSkip('inapplicable', 'multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported not advertised — getRunAncestry is gated on it (runs.md §Surface)');

    const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created.status} ${readErrorCode(created.json) ?? ''}`.trim());
    const t0 = Date.now(); let settled: string | null = null;
    while (Date.now() - t0 < 10_000) { settled = await status(runId); if (settled !== null && TERMINAL.has(settled)) break; await new Promise((r) => setTimeout(r, 250)); }
    if (settled === null || !TERMINAL.has(settled)) return softSkip('blocked', 'the noop run did not settle within 10 s');

    const own = await http(() => driver.get(`/runs/${enc(runId)}/ancestry`));
    if (own === null) return softSkip('blocked', 'GET /runs/{runId}/ancestry unreachable (fetch failed)');
    expect(own.status, req(ID, DOC, `a host advertising ancestryEndpointSupported MUST serve getRunAncestry — got ${own.status} ${readErrorCode(own.json) ?? ''}`.trim())).toBe(200);
    expect((own.json as { parent?: unknown } | null)?.parent, req(ID, DOC, 'the control: a run created by POST /runs was dispatched by no parent, so its ancestry parent MUST be null')).toBeNull();

    const fork = await http(() => driver.post(`/runs/${enc(runId)}:fork`, { mode: 'branch', fromSeq: 0 }));
    if (fork === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    if (fork.status === 404) return softSkip('blocked', 'POST /runs/{runId}:fork answered 404 with replay advertised — forkRun is not mounted');
    const forkId = (fork.json as { runId?: unknown } | null)?.runId;
    if (fork.status !== 201 || typeof forkId !== 'string') return softSkip('blocked', `a branch fork at fromSeq 0 answered ${fork.status} ${readErrorCode(fork.json) ?? ''} — no fork to read the ancestry of`.trim());
    expect((fork.json as { sourceRunId?: unknown }).sourceRunId, req(ID, 'spec/v2/core/runs.md §Fork', 'the fork\'s lineage is carried by the 201: sourceRunId MUST name the source')).toBe(runId);

    const anc = await http(() => driver.get(`/runs/${enc(forkId)}/ancestry`));
    if (anc === null) return softSkip('blocked', 'GET /runs/{fork}/ancestry unreachable (fetch failed)');
    expect(anc.status, req(ID, DOC, `getRunAncestry on a fork MUST answer 200 — got ${anc.status} ${readErrorCode(anc.json) ?? ''}`.trim())).toBe(200);
    const parent = (anc.json as { parent?: unknown } | null)?.parent;
    expect(parent, req(ID, DOC, `a fork is not dispatched, so its ancestry parent MUST be null — got ${JSON.stringify(parent)}. Its lineage is sourceRunId and the snapshot's parentRunId; ancestry's cause names a composition mechanism no fork used`)).toBeNull();
  }, 30_000);
});
