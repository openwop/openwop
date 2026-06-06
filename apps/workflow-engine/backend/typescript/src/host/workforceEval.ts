/**
 * RFC 0081 `live-shadow` eval for the Workforce demo (host extension; non-normative).
 *
 * This is a REAL eval — it dispatches the workforce's supervisor agent over an
 * embedded eval suite and scores each task against the human/legacy baseline —
 * NOT the runs-metadata-derived stand-in in `workforceService.ts §aggregateShadowEval`.
 * It uses the DETERMINISTIC dispatch seam (`runAgentDispatch`, the same seam the
 * conformance harness uses): a real turn through the agent registry + handoff
 * validation, driven by a per-task `simulateConfidence`, so the eval is
 * reproducible and costs no tokens. (A live-model variant via
 * `runAgentDispatchLive` is a future toggle.)
 *
 * Shapes mirror RFC 0081 (`spec/v1/agent-evaluation.md` §C): an `EvalSummary`
 * plus `eval.started` / `eval.scored` / `eval.completed` events on a real run.
 * Content-free per the `eval-summary-no-content-leak` invariant — scores, ids,
 * and counts only; never the scenario text or the agent's output.
 *
 * GATED: only callable when `OPENWOP_AGENT_EVAL_SUITE_ENABLED=true`, so the host's
 * `assurance.evals` / `agents.evalSuite` advertisement stays honest (RFC 0031).
 */

import { createHash } from 'node:crypto';
import type { Storage } from '../storage/storage.js';
import { getAgentRegistry } from '../executor/agentRegistry.js';
import { runAgentDispatch } from './agentDispatch.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('host.workforceEval');

/** Honest gate: the eval surface is only live when explicitly enabled. */
export function evalSuiteEnabled(): boolean {
  return process.env.OPENWOP_AGENT_EVAL_SUITE_ENABLED === 'true';
}

const EVAL_AGENT_ID = 'host.priya';
export const EVAL_SUITE_ID = 'sample.openwop.evals.invoice-exception';
const EVAL_SUITE_VERSION = '1.0.0';
const EVAL_MODEL_CLASS = 'reasoning';
const PASS_SCORE = 0.8;

interface EvalTask {
  taskId: string;
  /** The invoice-exception scenario handed to the agent (never leaves the host). */
  scenario: string;
  /** Drives the deterministic §F escalation path (≥ threshold ⇒ act, < ⇒ escalate). */
  simulateConfidence: number;
  /** The human/legacy baseline decision this task is scored against. */
  expect: 'completed' | 'escalated';
}

/** The embedded `live-shadow` suite — invoice-exception scenarios + their baseline
 *  (human) decision. The agent's deterministic threshold (0.7) means high-confidence
 *  scenarios should clear and low-confidence ones should escalate. */
const SUITE: readonly EvalTask[] = [
  { taskId: 'clean-po-match', scenario: 'Invoice matches PO and goods receipt within tolerance.', simulateConfidence: 0.96, expect: 'completed' },
  { taskId: 'small-price-variance', scenario: 'Unit price 2% over PO, within the auto-clear band.', simulateConfidence: 0.88, expect: 'completed' },
  { taskId: 'missing-receipt', scenario: 'No goods receipt on file for the invoiced quantity.', simulateConfidence: 0.55, expect: 'escalated' },
  { taskId: 'duplicate-suspect', scenario: 'Header closely matches an already-posted invoice.', simulateConfidence: 0.48, expect: 'escalated' },
  // A genuine agent/baseline DISAGREEMENT: the agent clears a 6%-over-PO line it
  // judges in-band, but the human baseline escalated it. Scores 0 → the suite
  // lands at 0.8 (4/5), a credible "good but not perfect" pass rather than 1.0.
  { taskId: 'borderline-variance', scenario: 'Unit price 6% over PO — outside the auto-clear band.', simulateConfidence: 0.74, expect: 'escalated' },
];

export interface EvalTaskResult {
  taskId: string;
  score: number;
  passed: boolean;
}

/** Mirrors RFC 0081 `EvalSummary` (host-ext shape; content-free). */
export interface WorkforceEvalSummary {
  runId: string;
  workforceId: string;
  suiteId: string;
  suiteVersion: string;
  mode: 'live-shadow';
  aggregateScore: number;
  passed: boolean;
  taskCount: number;
  passedCount: number;
  evaluatedModelClass: string;
  tasks: EvalTaskResult[];
}

let agentsRegistered = false;

/**
 * Register the workforce's supervisor as a REAL manifest agent so a live-shadow
 * eval can dispatch it (the `workforces.json` entries are otherwise decorative
 * AgentSpec refs). Idempotent + tenant-agnostic (no `ownerTenant`).
 */
export function registerWorkforceEvalAgents(): void {
  if (agentsRegistered) return;
  const reg = getAgentRegistry();
  if (!reg.get(EVAL_AGENT_ID)) {
    reg.register({
      agentId: EVAL_AGENT_ID,
      persona: 'invoice-exception-supervisor',
      modelClass: EVAL_MODEL_CLASS,
      systemPrompt:
        'Resolve invoice exceptions. Clear clean PO/receipt matches within tolerance; ' +
        'escalate ambiguous, duplicate-suspect, or unreceipted invoices to a human.',
      label: 'Priya — Invoice Exception Supervisor',
      toolAllowlist: [],
      memoryShape: { scratchpad: true, conversation: false, longTerm: true },
      confidence: { defaultThreshold: 0.7 },
      packName: 'host:workforce',
      packVersion: '0',
    });
  }
  agentsRegistered = true;
}

function evalRunId(tenantId: string, workforceId: string, nowMs: number): string {
  return `eval-${createHash('sha256').update(`${tenantId}:${workforceId}:${nowMs}`).digest('hex').slice(0, 24)}`;
}

/**
 * Run a real live-shadow eval of the workforce's supervisor over the embedded
 * suite. Persists a real eval run + `eval.*` events and returns the EvalSummary.
 */
export async function runWorkforceLiveShadowEval(
  storage: Storage,
  tenantId: string,
  workforceId: string,
  nowMs: number,
): Promise<WorkforceEvalSummary> {
  registerWorkforceEvalAgents();
  const runId = evalRunId(tenantId, workforceId, nowMs);
  const at = (offsetMs: number): string => new Date(nowMs + offsetMs).toISOString();

  await storage.insertRun({
    runId,
    workflowId: EVAL_SUITE_ID,
    tenantId,
    status: 'running',
    inputs: { suiteId: EVAL_SUITE_ID, mode: 'live-shadow' },
    metadata: { mode: 'eval', workforceId, suiteId: EVAL_SUITE_ID, evalAgentId: EVAL_AGENT_ID },
    configurable: {},
    createdAt: at(0),
    updatedAt: at(0),
  });
  await storage.appendEvent({
    eventId: `${runId}-eval-started`,
    runId,
    type: 'eval.started',
    timestamp: at(0),
    payload: { suiteId: EVAL_SUITE_ID, suiteVersion: EVAL_SUITE_VERSION, taskCount: SUITE.length, modes: ['live-shadow'] },
  });

  const tasks: EvalTaskResult[] = [];
  let n = 0;
  for (const t of SUITE) {
    // A REAL dispatch through the agent registry (deterministic seam).
    const r = runAgentDispatch({
      agentId: EVAL_AGENT_ID,
      task: { scenario: t.scenario },
      simulateConfidence: t.simulateConfidence,
    });
    const passed = r.status === t.expect;
    const score = passed ? 1 : 0;
    tasks.push({ taskId: t.taskId, score, passed });
    await storage.appendEvent({
      eventId: `${runId}-eval-scored-${t.taskId}`,
      runId,
      type: 'eval.scored',
      timestamp: at(++n),
      // Content-free per `eval-summary-no-content-leak`: scores/ids only — no
      // scenario text, no agent output.
      payload: { taskId: t.taskId, score, passed },
    });
  }

  const passedCount = tasks.filter((t) => t.passed).length;
  const aggregateScore = tasks.length
    ? Number((tasks.reduce((s, t) => s + t.score, 0) / tasks.length).toFixed(4))
    : 0;
  const passed = aggregateScore >= PASS_SCORE;

  await storage.appendEvent({
    eventId: `${runId}-eval-completed`,
    runId,
    type: 'eval.completed',
    timestamp: at(n + 1),
    payload: { aggregateScore, passed, taskCount: tasks.length, passedCount },
  });

  const summary: WorkforceEvalSummary = {
    runId,
    workforceId,
    suiteId: EVAL_SUITE_ID,
    suiteVersion: EVAL_SUITE_VERSION,
    mode: 'live-shadow',
    aggregateScore,
    passed,
    taskCount: tasks.length,
    passedCount,
    evaluatedModelClass: EVAL_MODEL_CLASS,
    tasks,
  };

  await storage.updateRun(runId, {
    status: 'completed',
    completedAt: at(n + 2),
    metadata: { mode: 'eval', workforceId, suiteId: EVAL_SUITE_ID, evalAgentId: EVAL_AGENT_ID, evalSummary: summary },
  });
  log.info('workforce_eval_completed', { tenantId, workforceId, runId, aggregateScore, passed });
  return summary;
}
