/**
 * Shared helpers for the RFC 0081 `agents.evalSuite` conformance scenario.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/agentEval.js`.
 *
 * Two surfaces:
 *   - the NORMATIVE read (`GET /v1/runs/{runId}/eval-summary`, RFC 0081 §C),
 *     exercised black-box; and
 *   - the host-sample eval-run seam (`POST /v1/host/sample/agents/eval-run`),
 *     used to drive the §B `mode:"eval"` projection so the `eval.*` ordering +
 *     the terminal `EvalSummary` can be asserted against the test event-log
 *     seam. The seam is OPTIONAL — scenarios soft-skip on 404/405 (the
 *     reference eval projection is deferred per RFC 0081 §Conformance).
 *
 * Gating uses the `agents.evalSuite.supported` capability flag from the live
 * discovery doc (root-first per RFC 0073).
 *
 * @see RFCS/0081-agent-evaluation-and-scorecards.md
 * @see spec/v1/agent-evaluation.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `agents.evalSuite` from discovery (root-first per RFC 0073); null when
 *  unadvertised. */
export async function readEvalSuiteCap(): Promise<Record<string, unknown> | null> {
  const agents = await readCapabilityFamily<{ evalSuite?: unknown }>('agents');
  const es = agents?.evalSuite;
  return es && typeof es === 'object' ? (es as Record<string, unknown>) : null;
}

export interface EvalRunResult {
  runId?: string;
  suiteId?: string;
  suiteVersion?: string;
  taskCount?: number;
  passed?: boolean;
  aggregateScore?: number;
}

/**
 * Drive one `mode:"eval"` projection through the host-sample eval-run seam
 * (RFC 0081 §B). `body.modes` selects the eval modes (default golden); the host
 * picks a default agent + a built-in golden suite when `agentId` is omitted.
 * Returns null when the seam is unwired (404/405).
 */
export async function driveEvalRun(
  body: { agentId?: string; modes?: string[]; taskCount?: number } = {},
): Promise<EvalRunResult | null> {
  const res = await driver.post('/v1/host/sample/agents/eval-run', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as EvalRunResult | undefined) ?? {};
}

/** GET the NORMATIVE eval scorecard (RFC 0081 §C
 *  `GET /v1/runs/{runId}/eval-summary`); returns `{ status, summary }` so a
 *  caller can distinguish a 404 (not-an-eval-run / unadvertised) or 409 (still
 *  running) from a served summary. */
export async function getEvalSummary(
  runId: string,
): Promise<{ status: number; summary: Record<string, unknown> | undefined }> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/eval-summary`);
  return { status: res.status, summary: res.json as Record<string, unknown> | undefined };
}

/** The closed five-mode vocabulary (RFC 0081 §D). */
export const EVAL_MODES = ['golden', 'rubric', 'adversarial', 'regression', 'live-shadow'];

/** Content keys an `eval.*` event / `EvalSummary` task entry MUST NEVER carry
 *  (SECURITY invariant `eval-summary-no-content-leak`, SR-1): task output,
 *  rubric prose, model completion, prompt, or credential material. */
export const EVAL_CONTENT_FORBIDDEN = [
  'taskOutput',
  'output',
  'rubric',
  'completion',
  'prompt',
  'body',
  'secret',
  'credentials',
  'token',
  'apiKey',
];
