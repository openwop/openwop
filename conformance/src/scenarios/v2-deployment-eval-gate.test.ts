/**
 * v2 — a promote that cites a failed eval run is refused (RFC 0082 §E; the
 * rule is the `agents.deployment` facet description in
 * `spec/v2/facets/agents.schema.json`: when the gate carries `requiredEval`,
 * the host MUST verify the eval run is terminal and passed before
 * `deployment.promoted`, else deny with `eval_gate_unmet`).
 *
 * The v1 `agent-deployment-lifecycle` scenario witnessed this through the v1
 * sample seam only. Here the suite causes it on the wire, with no seam:
 *   1. read `GET /agents/{agentId}/deployments` for the scripted agent and
 *      pick a `draft`, `test` or `staged` record;
 *   2. run `conformance-eval-gate-failing` (one task that always fails, so the
 *      summary is `passed: false`) to completion;
 *   3. `POST /agents/{agentId}/deployments` `{version, transition: "promote",
 *      evalRunId}`.
 *
 * Whether a promote is gated on `requiredEval` is host policy, so a host opts
 * in by listing `conformance-eval-gate-failing` in discovery `fixtures`: the
 * fixture contract (`conformance/fixtures.md`) says its promote of the
 * scripted agent carries `requiredEval`, and that it holds a promotable record.
 * Judges in `lib/deployment-eval-gate-witness.ts`.
 *   - `0082.eval-gate-unmet-refused` — `422 eval_gate_unmet`.
 *   - `0082.eval-gate-unmet-unchanged` — the record keeps its state, channels
 *     and canary share.
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md §E
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { majorProfile } from '../lib/major-profile.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollTerminal, isRecord } from '../lib/fixture-run-observer.js';
import { judgeGateRefused, judgeRecordUnchanged, pickPromotable, type GateFinding } from '../lib/deployment-eval-gate-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'agents.schema.json §deployment, transitionAgentDeployment (RFC 0082 §E)';
const AGENT = 'core.conformance.agents.scripted';
const FIXTURE = 'conformance-eval-gate-failing';
const ID_REFUSED = 'openwop.requirement.0082.eval-gate-unmet-refused';
const ID_UNCHANGED = 'openwop.requirement.0082.eval-gate-unmet-unchanged';
const DEPLOYMENTS = `/agents/${encodeURIComponent(AGENT)}/deployments`;

type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
type Outcome = { before: Record<string, unknown>; refusal: OpenWOPResponse; after: unknown };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
const expectAll = (id: string, findings: readonly GateFinding[]): void => {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
};

async function gate(): Promise<Skip | null> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'] };
  const agents = doc['agents'];
  if (!isRecord(agents) || !isRecord(agents['deployment'])) return { skip: ['inapplicable', 'the host does not advertise agents.deployment'] };
  if (!isRecord(agents['evalSuite'])) return { skip: ['inapplicable', 'the host does not advertise agents.evalSuite'] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['inapplicable', `the host does not advertise fixture ${FIXTURE}`] };
  return null;
}

let once: Promise<Skip | Outcome> | undefined;
/** One refused promote, read by both legs. */
function promoteAgainstFailedEval(): Promise<Skip | Outcome> {
  once ??= (async (): Promise<Skip | Outcome> => {
    const list = await http(() => driver.get(DEPLOYMENTS));
    if (list === null || list.status !== 200) return { skip: ['blocked', `GET ${DEPLOYMENTS} answered ${list?.status ?? 'nothing'}`] };
    const before = pickPromotable(list.json);
    if (before === undefined) return { skip: ['blocked', `the host lists ${FIXTURE} but holds no draft, test or staged record of ${AGENT} to promote`] };

    const res = await http(() => driver.post(PROFILE.runsPath, { mode: 'eval', evalSuiteRef: `https://conformance.openwop.dev/eval-suites/${FIXTURE}`, agentId: AGENT }));
    if (res === null) return { skip: ['blocked', 'POST /runs unreachable (fetch failed)'] };
    if (res.status === 429) return { skip: ['blocked', 'POST /runs answered 429 — the run budget, not the wire'] };
    const evalRunId = isRecord(res.json) && typeof res.json['runId'] === 'string' ? res.json['runId'] : undefined;
    if ((res.status !== 201 && res.status !== 202) || evalRunId === undefined) return { skip: ['blocked', `createRun of ${FIXTURE} answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim()] };
    const terminal = await pollTerminal(PROFILE, evalRunId, { timeoutMs: 60_000 });
    if (terminal.snapshot['status'] !== 'completed') return { skip: ['blocked', `eval run ${evalRunId} ended ${String(terminal.snapshot['status'])}, not completed`] };
    const summary = await http(() => driver.get(`${PROFILE.runsPath}/${PROFILE.idSegment(evalRunId)}/eval-summary`));
    if (summary === null || summary.status !== 200 || !isRecord(summary.json)) return { skip: ['blocked', `GET …/eval-summary answered ${summary?.status ?? 'nothing'}`] };
    // Without a failed summary the refusal would prove nothing about the gate.
    if (summary.json['passed'] !== false) return { skip: ['blocked', `${FIXTURE} MUST fail, but its summary says passed: ${JSON.stringify(summary.json['passed'])}`] };

    const refusal = await http(() => driver.post(DEPLOYMENTS, { version: before['version'], transition: 'promote', evalRunId }));
    if (refusal === null) return { skip: ['blocked', `POST ${DEPLOYMENTS} unreachable (fetch failed)`] };
    if (refusal.status === 429) return { skip: ['blocked', `POST ${DEPLOYMENTS} answered 429 — the rate budget, not the gate`] };
    const after = await http(() => driver.get(DEPLOYMENTS));
    return { before, refusal, after: after?.status === 200 ? after.json : undefined };
  })();
  return once;
}

describe('v2 RFC 0082 §E — a promote citing a failed eval run is refused (host)', () => {
  it('answers 422 eval_gate_unmet', async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const o = await promoteAgainstFailedEval();
    if ('skip' in o) return softSkip(...o.skip);
    expectAll(ID_REFUSED, judgeGateRefused({ status: o.refusal.status, json: o.refusal.json }));
  });

  it('leaves the deployment record as it was', async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const o = await promoteAgainstFailedEval();
    if ('skip' in o) return softSkip(...o.skip);
    if (o.after === undefined) return softSkip('blocked', `GET ${DEPLOYMENTS} after the promote did not answer 200`);
    expectAll(ID_UNCHANGED, judgeRecordUnchanged(o.before, o.after));
  });
});
