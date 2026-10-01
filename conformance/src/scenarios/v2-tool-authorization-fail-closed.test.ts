/**
 * `spec/v2/core/host-services.md` §`toolHooks` — per-tool authorization fails
 * closed (target major 2; gated on `toolHooks.perToolAuthorization` and the
 * `conformance-tool-scope-probe` fixture).
 *
 *   "Before invoking, the host MUST check the principal's scopes against the
 *    tool's `requiredScopes`. If one is missing or cannot be evaluated, it MUST
 *    NOT invoke, MUST emit `agent.toolReturned` with `status: forbidden`, and
 *    MUST answer `403 forbidden` with `details.scope: "tool"`, `toolName` and
 *    `requiredScopes`."
 *
 * Before this file the rule had a witness at major 1 only
 * (`tool-hooks-authorization-fail-closed`), through a v1 seam that returned the
 * host's own account of what it did. It never observed the tool.
 *
 * No seam. The fixture's node (`core.conformance.scoped-tool`,
 * conformance/fixtures.md §`conformance-tool-scope-probe`) makes ONE external
 * tool call through the host's ordinary tool path as the run's principal. The
 * tool, when invoked, POSTs to a URL the suite hands it, so "not invoked" is
 * counted at the suite's own receiver, not taken from the host's log:
 *
 *   0. control — no required scope: the tool MUST be invoked (one arrival,
 *      `agent.tool-returned { status: ok }`). Without it a host that refuses
 *      every tool, or a node that never calls out, passes both legs vacuously.
 *   1. `missing-scope` — `requiredScopes: ["conformance:never-granted"]`, a
 *      scope the operator grants nobody;
 *   2. `unevaluable-scope` — `requiredScopes: ["conformance:unevaluable"]`,
 *      whose check the operator binds to error.
 *
 * For 1 and 2: the receiver sees NO call; the log carries
 * `agent.tool-returned { toolName, status: forbidden }` with no `durationMs`
 * (the call never started) and no `ok` return for the tool; and the refusal,
 * which a run surfaces as the node's failure (`errors.md` §Host-service
 * refusals), is `forbidden` with `details.scope: "tool"`, `details.toolName`
 * and `details.requiredScopes` naming the scope.
 *
 * Dispositions: `toolHooks` not in the v2 root, or `perToolAuthorization` not
 * `true` ⇒ `inapplicable`, read with `familyAdvertised` rather than
 * `gateFamily` so strict mode does not demand a `family.toolHooks` opt-out from
 * a host that never claimed the facet. Facet advertised without the fixture, a
 * fixture run that cannot be created or does not settle, or a control that
 * returns `ok` but never reaches the receiver (a loopback receiver the host
 * cannot address — set `OPENWOP_WEBHOOK_RECEIVER_URL`) ⇒ `blocked` (RFC 0148 §A).
 *
 * Sabotage (a patched local copy of the v2 reference host): treat an
 * unevaluable scope as granted, and the `unevaluable-scope` leg fails on the
 * receiver; skip the check entirely, and both legs fail; refuse with
 * `forbidden` but still call the tool, and both fail on the receiver.
 *
 * @see spec/v2/core/host-services.md §toolHooks
 * @see conformance/fixtures.md §`conformance-tool-scope-probe`
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { startEffectReceiver, waitForFirstArrival } from '../lib/effect-receiver.js';

export const REQUIRES_HOST_CALLBACK = 'the host invokes the scope-probe tool, which calls the suite-owned effect receiver (OPENWOP_WEBHOOK_RECEIVER_PORT)';

const FIXTURE = 'conformance-tool-scope-probe';
const TOOL = 'conformance.scope-probe';
const DOC = 'spec/v2/core/host-services.md §toolHooks';
const FIXTURE_DOC = 'conformance/fixtures.md §conformance-tool-scope-probe';
const ID_MISSING = 'openwop.requirement.toolHooks.authorization-fail-closed-missing-scope';
const ID_UNEVALUABLE = 'openwop.requirement.toolHooks.authorization-fail-closed-unevaluable-scope';
const NEVER_GRANTED = 'conformance:never-granted';
const UNEVALUABLE = 'conformance:unevaluable';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
/** After a refused run settles, how long a late call to the receiver is still waited for. */
const QUIET_MS = 2_000;

type Skip = { skip: ['inapplicable' | 'blocked', string] };
interface Ev { type?: unknown; nodeId?: unknown; payload?: Record<string, unknown> }

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

async function gate(): Promise<Skip | null> {
  if (!(await v2Discovery().catch(() => null))) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 under OpenWOP-Version: 2.0'] };
  const hooks = await familyAdvertised('toolHooks');
  if (!hooks) return { skip: ['inapplicable', 'toolHooks is not advertised in the v2 discovery root — no per-tool authorization obligation'] };
  if (hooks['perToolAuthorization'] !== true) return { skip: ['inapplicable', 'toolHooks is advertised without perToolAuthorization: true — the host makes no per-tool authorization claim'] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['blocked', `the host advertises toolHooks.perToolAuthorization but not the ${FIXTURE} fixture — the fail-closed claim is made and cannot be observed without it`] };
  return null;
}

interface Exercise {
  readonly runId: string;
  readonly status: string;
  readonly arrivals: number;
  readonly tunnelled: boolean;
  readonly receiver: string;
  /** `agent.tool-returned` payloads for the probe tool. */
  readonly returns: Array<Record<string, unknown>>;
  /** The node's `node.failed` error, if it failed. */
  readonly error: { code?: unknown; details?: Record<string, unknown> } | null;
}

/** Run the fixture once, against a fresh receiver, and read back what reached the receiver and what the log says. */
async function exercise(requiredScope: string): Promise<Exercise | { reason: string }> {
  const rx = await startEffectReceiver();
  try {
    const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs: { requiredScope, url: rx.url } }));
    if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${FIXTURE}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the advertised fixture did not start`.trim() };
    const t0 = Date.now(); let status = '';
    while (Date.now() - t0 < 30_000) {
      const snap = await http(() => driver.get(`/runs/${enc(runId)}`));
      status = String((snap?.json as { status?: unknown } | null)?.status ?? '');
      if (TERMINAL.has(status)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!TERMINAL.has(status)) return { reason: `the ${FIXTURE} run did not reach a terminal status within 30 s (last: ${status || 'unreadable'})` };
    // A tool call that the host made is on the wire before the run settles, but give a slow network the benefit.
    if (requiredScope === '') await waitForFirstArrival(rx, 5_000);
    else await new Promise((r) => setTimeout(r, QUIET_MS));
    const poll = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
    const events = (poll?.json as { events?: unknown } | null)?.events;
    if (poll?.status !== 200 || !Array.isArray(events)) return { reason: `GET /runs/{runId}/events/poll answered ${poll?.status ?? 'nothing'}` };
    const evs = events as Ev[];
    const returns = evs.filter((e) => e.type === 'agent.tool-returned' && e.payload?.['toolName'] === TOOL).map((e) => e.payload as Record<string, unknown>);
    const failed = evs.find((e) => e.type === 'node.failed');
    const error = (failed?.payload?.['error'] ?? null) as Exercise['error'];
    return { runId, status, arrivals: rx.arrivals(), tunnelled: rx.tunnelled, receiver: rx.url, returns, error };
  } finally {
    await rx.close();
  }
}

/** The control run, once per file: the tool IS invoked when it requires nothing. */
let control: Promise<Exercise | { reason: string }> | null = null;
function controlRun(): Promise<Exercise | { reason: string }> {
  control ??= exercise('');
  return control;
}

/** Everything a scoped leg needs, or the recorded reason it cannot run. Every soft-skip decision is made here. */
async function leg(scope: string): Promise<{ control: Exercise; denied: Exercise } | Skip> {
  const why = await gate(); if (why) return why;
  const c = await controlRun();
  if ('reason' in c) return { skip: ['blocked', `control run: ${c.reason}`] };
  const ok = c.status === 'completed' && c.returns.some((r) => r['status'] === 'ok');
  if (ok && c.arrivals === 0) {
    return { skip: ['blocked', `the control run invoked ${TOOL} (status ok) but nothing reached the suite's receiver at ${c.receiver}${c.tunnelled ? '' : ' (a loopback address — set OPENWOP_WEBHOOK_RECEIVER_URL to a front the host can reach)'}; "not invoked" cannot be counted`] };
  }
  const d = await exercise(scope);
  if ('reason' in d) return { skip: ['blocked', `${scope} run: ${d.reason}`] };
  return { control: c, denied: d };
}

describe('v2 tool authorization fail-closed (host-services.md §toolHooks)', () => {
  it('a tool whose required scope the principal lacks is not invoked and is refused forbidden', async () => {
    const o = await leg(NEVER_GRANTED); if ('skip' in o) return softSkip(...o.skip);
    const { control: c, denied: d } = o;
    // Positive control: without it, a host that refuses every tool passes vacuously.
    expect(`${c.status}/${c.returns.map((r) => String(r['status'])).join(',') || 'no tool-returned'}`, req(ID_MISSING, FIXTURE_DOC, `with no required scope the fixture MUST invoke ${TOOL} and complete with agent.tool-returned status ok (positive control)`)).toMatch(/^completed\/(.*,)?ok(,.*)?$/);
    expect(c.arrivals, req(ID_MISSING, FIXTURE_DOC, `with no required scope ${TOOL} MUST reach the suite's receiver (positive control)`)).toBeGreaterThan(0);

    expect(d.arrivals, req(ID_MISSING, DOC, `a tool whose required scope (${NEVER_GRANTED}) the principal lacks or that cannot be evaluated MUST NOT be invoked — the suite's receiver saw ${d.arrivals} call(s)`)).toBe(0);
    const forbidden = d.returns.filter((r) => r['status'] === 'forbidden');
    expect(forbidden.length, req(ID_MISSING, DOC, `the host MUST emit agent.tool-returned with status: forbidden for ${TOOL} (got statuses: ${JSON.stringify(d.returns.map((r) => r['status'] ?? null))})`)).toBeGreaterThan(0);
    expect(d.returns.filter((r) => r['status'] === 'ok').length, req(ID_MISSING, DOC, `a refused tool MUST NOT also return ok`)).toBe(0);
    expect(forbidden.filter((r) => r['durationMs'] !== undefined).length, req(ID_MISSING, 'schemas/v2/run-event-payloads.schema.json#/$defs/agentToolReturned', 'durationMs is absent when the call never started (forbidden)')).toBe(0);

    const details = d.error?.details ?? {};
    expect(d.error?.code, req(ID_MISSING, DOC, `the refusal MUST be forbidden (the run surfaces it as the node's failure, errors.md §Host-service refusals; run status ${d.status})`)).toBe('forbidden');
    expect(details['scope'], req(ID_MISSING, DOC, 'the forbidden refusal MUST carry details.scope: "tool"')).toBe('tool');
    expect(details['toolName'], req(ID_MISSING, DOC, 'the forbidden refusal MUST carry details.toolName')).toBe(TOOL);
    expect(Array.isArray(details['requiredScopes']) ? (details['requiredScopes'] as unknown[]) : [], req(ID_MISSING, DOC, 'the forbidden refusal MUST carry details.requiredScopes naming the tool\'s scopes')).toContain(NEVER_GRANTED);
  }, 90_000);

  it('a tool whose required scope cannot be evaluated is not invoked and is refused forbidden', async () => {
    const o = await leg(UNEVALUABLE); if ('skip' in o) return softSkip(...o.skip);
    const { control: c, denied: d } = o;
    // Positive control: without it, a host that refuses every tool passes vacuously.
    expect(`${c.status}/${c.returns.map((r) => String(r['status'])).join(',') || 'no tool-returned'}`, req(ID_UNEVALUABLE, FIXTURE_DOC, `with no required scope the fixture MUST invoke ${TOOL} and complete with agent.tool-returned status ok (positive control)`)).toMatch(/^completed\/(.*,)?ok(,.*)?$/);
    expect(c.arrivals, req(ID_UNEVALUABLE, FIXTURE_DOC, `with no required scope ${TOOL} MUST reach the suite's receiver (positive control)`)).toBeGreaterThan(0);

    expect(d.arrivals, req(ID_UNEVALUABLE, DOC, `a tool whose required scope (${UNEVALUABLE}) the principal lacks or that cannot be evaluated MUST NOT be invoked — the suite's receiver saw ${d.arrivals} call(s)`)).toBe(0);
    const forbidden = d.returns.filter((r) => r['status'] === 'forbidden');
    expect(forbidden.length, req(ID_UNEVALUABLE, DOC, `the host MUST emit agent.tool-returned with status: forbidden for ${TOOL} (got statuses: ${JSON.stringify(d.returns.map((r) => r['status'] ?? null))})`)).toBeGreaterThan(0);
    expect(d.returns.filter((r) => r['status'] === 'ok').length, req(ID_UNEVALUABLE, DOC, `a refused tool MUST NOT also return ok`)).toBe(0);
    expect(forbidden.filter((r) => r['durationMs'] !== undefined).length, req(ID_UNEVALUABLE, 'schemas/v2/run-event-payloads.schema.json#/$defs/agentToolReturned', 'durationMs is absent when the call never started (forbidden)')).toBe(0);

    const details = d.error?.details ?? {};
    expect(d.error?.code, req(ID_UNEVALUABLE, DOC, `the refusal MUST be forbidden (the run surfaces it as the node's failure, errors.md §Host-service refusals; run status ${d.status})`)).toBe('forbidden');
    expect(details['scope'], req(ID_UNEVALUABLE, DOC, 'the forbidden refusal MUST carry details.scope: "tool"')).toBe('tool');
    expect(details['toolName'], req(ID_UNEVALUABLE, DOC, 'the forbidden refusal MUST carry details.toolName')).toBe(TOOL);
    expect(Array.isArray(details['requiredScopes']) ? (details['requiredScopes'] as unknown[]) : [], req(ID_UNEVALUABLE, DOC, 'the forbidden refusal MUST carry details.requiredScopes naming the tool\'s scopes')).toContain(UNEVALUABLE);
  }, 90_000);
});
