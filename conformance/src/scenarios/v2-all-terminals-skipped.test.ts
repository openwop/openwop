/**
 * v2 — a run in which no node failed and every terminal node was skipped ends
 * `run.completed` with `skippedTerminals` (RFC 0257; the rules are
 * `$defs/runCompleted.skippedTerminals` in
 * `schemas/v2/run-event-payloads.schema.json` and `spec/v2/core/execution.md`
 * §`subWorkflow`, Output).
 *
 * Server-free (always on):
 *   1. `0257.shape` — `skippedTerminals` is an optional nodeId list with
 *      `minItems: 1` and `uniqueItems`; an empty list fails validation.
 *
 * Host legs — each gated on its fixture in discovery `fixtures[]`
 * (unadvertised → `inapplicable`); judges in `lib/skipped-terminals-witness.ts`.
 *   2. `0257.trigger-rule-skip-completes` — `conformance-error-route-only`:
 *      the only terminal sits behind `any_failed`, no condition anywhere.
 *   3. `0257.condition-skip-completes` — `conformance-all-terminals-skipped`
 *      with `payload {ok: false}`: the `truthy` edge on `payload.ok` declines.
 *   4. `0257.terminal-completed-no-marker` — the same fixture with
 *      `{ok: true}`: `act` completes and there is no marker. A host that
 *      ignores the condition runs `act` on both inputs and fails leg 3.
 *   5. `0257.replay-same-disposition` — gated on `replay.modes ∋ replay`: a
 *      replay fork of the leg-2 run ends with the same event and marker.
 *   6. `0257.subworkflow-child-skipped` — gated on `subWorkflow`:
 *      `conformance-subworkflow-skip-parent` completes, and its
 *      `core.subWorkflow` node carries `childStatus: "completed"` and
 *      `childSkippedTerminals`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { gateFamily, v2RefValidator } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import { judgeNoMarker, judgeParent, judgeReplaySame, judgeSkippedCompletes, terminalOf, type Ev, type SkipFinding } from '../lib/skipped-terminals-witness.js';

const DOC = 'run-event-payloads.schema.json $defs/runCompleted.skippedTerminals; execution.md §subWorkflow (RFC 0257)';
const ID_SHAPE = 'openwop.requirement.0257.shape';
const ID_TRIGGER_RULE = 'openwop.requirement.0257.trigger-rule-skip-completes';
const ID_CONDITION = 'openwop.requirement.0257.condition-skip-completes';
const ID_NO_MARKER = 'openwop.requirement.0257.terminal-completed-no-marker';
const ID_REPLAY = 'openwop.requirement.0257.replay-same-disposition';
const ID_SUBWORKFLOW = 'openwop.requirement.0257.subworkflow-child-skipped';
const ROUTE_ONLY = 'conformance-error-route-only';
const CONDITION = 'conformance-all-terminals-skipped';
const PARENT = 'conformance-subworkflow-skip-parent';

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

async function logOf(runId: string): Promise<Ev[]> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (res?.json as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? (events as Ev[]).filter((e) => typeof e.sequence === 'number').sort((a, b) => (a.sequence as number) - (b.sequence as number)) : [];
}

/** Start a fixture and wait for its terminal event; the log, or why there is none. */
async function runToEnd(workflowId: string, inputs?: Record<string, unknown>): Promise<{ runId: string; log: Ev[] } | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId, ...(inputs ? { inputs } : {}) }));
  const runId = (created?.json as { runId?: unknown } | null)?.runId;
  if (created === null || created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs (${workflowId}) answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim() };
  return settle(runId);
}
async function settle(runId: string): Promise<{ runId: string; log: Ev[] } | { reason: string }> {
  const deadline = Date.now() + scaledTimeoutMs(20_000);
  for (;;) {
    const log = await logOf(runId);
    if (log.some((e) => typeof e.type === 'string' && /^run\.(completed|failed|cancelled)$/.test(e.type))) return { runId, log };
    if (Date.now() > deadline) return { reason: `run ${runId} logged no terminal event within the bound (${log.length} event(s))` };
    await new Promise((r) => setTimeout(r, 250));
  }
}

function expectAll(id: string, findings: readonly SkipFinding[]): void {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
}

describe('v2 RFC 0257 — skippedTerminals wire shape (server-free)', () => {
  it('skippedTerminals is an optional, non-empty, unique nodeId list on run.completed', () => {
    const v = v2RefValidator('run-event-payloads.schema.json#/$defs/runCompleted');
    expect(v({ outputs: {} }).ok, req(ID_SHAPE, DOC, 'run.completed without skippedTerminals MUST validate')).toBe(true);
    expect(v({ outputs: {}, skippedTerminals: ['session'] }).ok, req(ID_SHAPE, DOC, 'run.completed with skippedTerminals MUST validate')).toBe(true);
    expect(v({ outputs: {}, skippedTerminals: [] }).ok, req(ID_SHAPE, DOC, 'an empty skippedTerminals MUST fail (minItems 1)')).toBe(false);
    expect(v({ outputs: {}, skippedTerminals: ['a', 'a'] }).ok, req(ID_SHAPE, DOC, 'a repeated id MUST fail (uniqueItems)')).toBe(false);
  });
});

describe('v2 RFC 0257 — every terminal skipped, no node failed (host)', () => {
  it('a terminal skipped by its trigger rule, with no condition, ends run.completed with skippedTerminals', async () => {
    if (!isFixtureAdvertised(ROUTE_ONLY)) return softSkip('inapplicable', `fixture ${ROUTE_ONLY} is not advertised`);
    const r = await runToEnd(ROUTE_ONLY);
    if ('reason' in r) return softSkip('blocked', r.reason);
    expectAll(ID_TRIGGER_RULE, judgeSkippedCompletes(r.log, ['on-fail']));
  }, 60_000);

  it('a terminal skipped by a declining edge condition ends run.completed with skippedTerminals', async () => {
    if (!isFixtureAdvertised(CONDITION)) return softSkip('inapplicable', `fixture ${CONDITION} is not advertised`);
    const r = await runToEnd(CONDITION, { payload: { ok: false } });
    if ('reason' in r) return softSkip('blocked', r.reason);
    expectAll(ID_CONDITION, judgeSkippedCompletes(r.log, ['act']));
  }, 60_000);

  it('a run in which a terminal completed carries no skippedTerminals (the positive control)', async () => {
    if (!isFixtureAdvertised(CONDITION)) return softSkip('inapplicable', `fixture ${CONDITION} is not advertised`);
    const r = await runToEnd(CONDITION, { payload: { ok: true } });
    if ('reason' in r) return softSkip('blocked', r.reason);
    expectAll(ID_NO_MARKER, judgeNoMarker(r.log));
  }, 60_000);

  it('a replay fork reproduces the terminal event and skippedTerminals', async () => {
    const replay = await gateFamily('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');
    if (!(Array.isArray(replay['modes']) && replay['modes'].includes('replay'))) return softSkip('inapplicable', 'replay.modes does not list replay');
    if (!isFixtureAdvertised(ROUTE_ONLY)) return softSkip('inapplicable', `fixture ${ROUTE_ONLY} is not advertised`);
    const src = await runToEnd(ROUTE_ONLY);
    if ('reason' in src) return softSkip('blocked', src.reason);
    const first = src.log.find((e) => e.type === 'node.started');
    if (first === undefined || terminalOf(src.log) === null) return softSkip('blocked', 'the source run logged no node.started or no single terminal event to fork from');
    const fork = await http(() => driver.post(`/runs/${enc(src.runId)}:fork`, { mode: 'replay', fromSeq: first.sequence }));
    const forkId = (fork?.json as { runId?: unknown } | null)?.runId;
    if (fork === null || fork.status !== 201 || typeof forkId !== 'string') return softSkip('blocked', `POST /runs/{runId}:fork answered ${fork?.status ?? 'nothing'} ${readErrorCode(fork?.json) ?? ''} — forkRun owns that contract`.trim());
    const k = await settle(forkId);
    if ('reason' in k) return softSkip('blocked', k.reason);
    expectAll(ID_REPLAY, judgeReplaySame(src.log, k.log));
  }, 90_000);

  it('a core.subWorkflow parent completes on a child that reached no terminal, and carries its list', async () => {
    if (!(await gateFamily('subWorkflow'))) return softSkip('inapplicable', 'subWorkflow family not advertised (gate recorded under openwop.family.subWorkflow)');
    if (!isFixtureAdvertised(PARENT) || !isFixtureAdvertised(ROUTE_ONLY)) return softSkip('inapplicable', `fixtures ${PARENT} and ${ROUTE_ONLY} are not both advertised`);
    const r = await runToEnd(PARENT);
    if ('reason' in r) return softSkip('blocked', r.reason);
    expectAll(ID_SUBWORKFLOW, judgeParent(r.log, 'subwf-call', ['on-fail']));
  }, 90_000);
});
