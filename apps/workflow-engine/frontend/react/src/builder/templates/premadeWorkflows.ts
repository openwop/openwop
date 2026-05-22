/**
 * Premade workflow templates surfaced in the dashboard.
 *
 * Each template is a fully-formed `SavedWorkflow` graph using only the
 * 6 nodes the sample backend can execute end-to-end today: noop, delay,
 * uppercase, approval, mock-ai, chat (BYOK). See
 * `apps/workflow-engine/backend/typescript/src/bootstrap/nodes.ts`.
 *
 * Templates exercise the DAG executor (commit 9268353): fan-out, fan-in,
 * parallel concurrent paths, trigger rules, and explicit port routing.
 *
 * **Edge port-routing notes** — the executor (scheduler.ts) does shallow
 * merge keyed by `targetPort` at fan-in points; last writer wins per
 * port. We therefore route DATA on one edge per fan-in (with the
 * meaningful `targetPort`) and use GATE-only edges with distinct
 * `_gate_*` targetPort names on the other inputs, so the target waits
 * for every upstream (`triggerRule: 'all_success'`, default) without
 * having its data clobbered.
 *
 * **Node output shapes** (from nodes.ts):
 *   noop       — `{ ...inputs }`   (pass-through; preserves all keys)
 *   delay      — `{ waitedMs }`    (single key; original input lost)
 *   approval   — opaque pass-through after resolve
 *   uppercase  — `{ text }`
 *   mock-ai    — `{ completion }`
 *   chat       — `{ completion, provider, model, usage }`
 *
 * Templates are read-only in the dashboard. "Use template" clones the
 * graph into the user's localStorage workflow set via
 * `cloneTemplateToUserWorkflow()`.
 */

import { newWorkflowId } from '../persistence/localStore.js';
import type {
  BuilderEdge,
  BuilderNode,
  EdgeCondition,
  EdgeTriggerRule,
  SavedWorkflow,
} from '../schema/workflow.js';

export type TemplateCategory = 'quickstart' | 'hitl' | 'ai' | 'pipeline';

export interface TemplateWorkflow {
  /** Stable identifier (e.g. `template.hello-uppercase`). Not a workflow
   *  id — replaced with a fresh `newWorkflowId()` when cloned. */
  templateId: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** True when the template's first node is `chat` (real LLM) and the
   *  user must provide a BYOK credentialRef before it can run. */
  requiresBYOK?: boolean;
  /** Visual graph. Same shape as SavedWorkflow but without id/timestamps. */
  nodes: readonly BuilderNode[];
  edges: readonly BuilderEdge[];
  /** Default JSON to pre-fill in the canvas inputs panel. */
  defaultInputs: string;
}

// ---------- helpers (build-time only, not exported) -----------------------

const COL_W = 220;
const ROW_H = 130;
const ORIGIN_X = 120;
const ORIGIN_Y = 240;

/** Grid position. `row` may be negative (above center) or positive (below). */
function pos(col: number, row = 0): { x: number; y: number } {
  return { x: ORIGIN_X + col * COL_W, y: ORIGIN_Y + row * ROW_H };
}

function node(
  id: string,
  kind: BuilderNode['kind'],
  position: { x: number; y: number },
  name: string,
  config: Record<string, unknown> = {},
): BuilderNode {
  return { id, kind, name, position, config };
}

interface EdgeOpts {
  sourcePort?: string;
  targetPort?: string;
  triggerRule?: EdgeTriggerRule;
  condition?: EdgeCondition;
  label?: string;
}

function edge(id: string, source: string, target: string, opts: EdgeOpts = {}): BuilderEdge {
  const out: BuilderEdge = {
    id,
    source,
    sourcePort: opts.sourcePort ?? 'out',
    target,
    targetPort: opts.targetPort ?? 'in',
  };
  if (opts.triggerRule) out.triggerRule = opts.triggerRule;
  if (opts.condition) out.condition = opts.condition;
  if (opts.label) out.label = opts.label;
  return out;
}

// ---------- templates -----------------------------------------------------

export const PREMADE_WORKFLOWS: readonly TemplateWorkflow[] = [
  // =========================================================================
  // QUICKSTART (3) — single- or two-node smoke tests
  // =========================================================================

  {
    templateId: 'template.hello-uppercase',
    name: 'Hello uppercase',
    description: 'Single-node smoke test. Reads inputs.text and emits it uppercased.',
    category: 'quickstart',
    nodes: [node('n1', 'uppercase', pos(0), 'Uppercase')],
    edges: [],
    defaultInputs: JSON.stringify({ text: 'hello world' }, null, 2),
  },

  {
    templateId: 'template.mock-ai-completion',
    name: 'Mock AI completion',
    description: 'Single-node deterministic AI demo. No BYOK or external calls.',
    category: 'quickstart',
    nodes: [
      node('n1', 'mock-ai', pos(0), 'Mock AI', {
        systemPromptRef: 'writer-system',
        userPromptRef: 'writer-user',
      }),
    ],
    edges: [],
    defaultInputs: JSON.stringify({ prompt: 'Say hi in five words.' }, null, 2),
  },

  {
    templateId: 'template.approval-gate',
    name: 'Approval gate',
    description: 'Human approves, then uppercase runs. The canonical HITL pattern.',
    category: 'quickstart',
    nodes: [
      node('n1', 'approval', pos(0), 'Approve', { prompt: 'Approve this sample run?' }),
      node('n2', 'uppercase', pos(1), 'Uppercase'),
    ],
    edges: [edge('e1', 'n1', 'n2')],
    defaultInputs: JSON.stringify({ text: 'hello after approval' }, null, 2),
  },

  // =========================================================================
  // PIPELINE / DAG (5) — multi-step + concurrent paths
  // =========================================================================

  // Template 4: Multi-channel content review (12 nodes)
  //
  //   start ─ draft ─ normalize ─┬─ legal_review ───────────┐
  //                              ├─ brand_review ───────────┼─ converge ─ final ─ publish
  //                              ├─ compliance_wait ─ comp_review ───────┤
  //                              └─ risk_assess ─ risk_review ───────────┘
  //
  // Demonstrates: 1→4 fan-out, 4→1 fan-in with `all_success`, two of the
  // branches have their own sequential pre-step (delay before approval).
  {
    templateId: 'template.multi-channel-content-review',
    name: 'Multi-channel content review',
    description:
      'AI drafts content → 4 concurrent review tracks (legal, brand, compliance, risk) — all must approve before publishing.',
    category: 'pipeline',
    nodes: [
      node('start', 'noop', pos(0), 'Start'),
      node('draft', 'mock-ai', pos(1), 'Draft content', {
        systemPromptRef: 'writer-system',
        userPromptRef: 'writer-user',
      }),
      node('normalize', 'uppercase', pos(2), 'Normalize'),
      node('legal_review', 'approval', pos(3, -2), 'Legal review', {
        prompt: 'Legal: approve the drafted content.',
      }),
      node('brand_review', 'approval', pos(3, -1), 'Brand review', {
        prompt: 'Brand: approve voice and tone.',
      }),
      node('compliance_wait', 'delay', pos(3, 1), 'Compliance scan', { durationMs: 1500 }),
      node('compliance_review', 'approval', pos(4, 1), 'Compliance review', {
        prompt: 'Compliance: confirm scan results are acceptable.',
      }),
      node('risk_assess', 'delay', pos(3, 2), 'Risk score', { durationMs: 1000 }),
      node('risk_review', 'approval', pos(4, 2), 'Risk review', {
        prompt: 'Risk: confirm risk score is within tolerance.',
      }),
      node('converge', 'noop', pos(5), 'Converge'),
      node('final', 'uppercase', pos(6), 'Final format'),
      node('publish', 'noop', pos(7), 'Publish'),
    ],
    edges: [
      edge('e1', 'start', 'draft'),
      edge('e2', 'draft', 'normalize', { sourcePort: 'completion', targetPort: 'text' }),
      // Fan-out from normalize to 4 tracks (sequential pre-steps on 2 of them).
      edge('e3', 'normalize', 'legal_review', { sourcePort: 'text' }),
      edge('e4', 'normalize', 'brand_review', { sourcePort: 'text' }),
      edge('e5', 'normalize', 'compliance_wait', { sourcePort: 'text' }),
      edge('e6', 'normalize', 'risk_assess', { sourcePort: 'text' }),
      edge('e7', 'compliance_wait', 'compliance_review'),
      edge('e8', 'risk_assess', 'risk_review'),
      // Fan-in to converge. One DATA edge (carries `text` for downstream
      // uppercase) + three GATE-only edges. Default triggerRule
      // `all_success` makes converge wait for every upstream.
      edge('e9', 'legal_review', 'converge', { targetPort: 'text' }),
      edge('e10', 'brand_review', 'converge', { targetPort: '_gate_brand' }),
      edge('e11', 'compliance_review', 'converge', { targetPort: '_gate_compliance' }),
      edge('e12', 'risk_review', 'converge', { targetPort: '_gate_risk' }),
      edge('e13', 'converge', 'final', { sourcePort: 'text', targetPort: 'text' }),
      edge('e14', 'final', 'publish', { sourcePort: 'text' }),
    ],
    defaultInputs: JSON.stringify(
      { prompt: 'Draft a one-line announcement of our Q3 product launch.' },
      null,
      2,
    ),
  },

  // Template 5: Race-to-respond with audit trail (10 nodes)
  //
  //   start ─┬─ fast_draft (mock-ai) ─ fast_norm (uppercase) ────┐
  //          │                                                   ├─ converge (any_success) ─ final_review ─ publish
  //          └─ audit_wait (delay 2s) ─ audit_log (mock-ai) ─ audit_norm (uppercase)
  //
  // Demonstrates: 2-way fan-out, `any_success` convergence (first track
  // wins downstream firing, but both tracks still run to completion).
  {
    templateId: 'template.race-with-audit',
    name: 'Race-to-respond with audit trail',
    description:
      'Fast draft path races against a delayed audit-log path. `any_success` convergence lets downstream fire as soon as either lane finishes; both still complete.',
    category: 'pipeline',
    nodes: [
      node('start', 'noop', pos(0), 'Start'),
      node('fast_draft', 'mock-ai', pos(1, -1), 'Fast draft', {
        systemPromptRef: 'writer-system',
        userPromptRef: 'writer-user',
      }),
      node('fast_norm', 'uppercase', pos(2, -1), 'Fast normalize'),
      node('audit_wait', 'delay', pos(1, 1), 'Audit wait', { durationMs: 2000 }),
      node('audit_log', 'mock-ai', pos(2, 1), 'Audit log', {
        systemPromptRef: 'audit-logger-system',
        userPromptRef: 'writer-user',
      }),
      node('audit_norm', 'uppercase', pos(3, 1), 'Audit normalize'),
      node('converge', 'noop', pos(4), 'Converge (any)'),
      node('final_review', 'approval', pos(5), 'Final review', {
        prompt: 'Approve consolidated response?',
      }),
      node('uppercase_out', 'uppercase', pos(6), 'Format output'),
      node('publish', 'noop', pos(7), 'Publish'),
    ],
    edges: [
      // Fan-out from start.
      edge('e1', 'start', 'fast_draft'),
      edge('e2', 'start', 'audit_wait'),
      // Fast lane: completion→text→approval
      edge('e3', 'fast_draft', 'fast_norm', { sourcePort: 'completion', targetPort: 'text' }),
      // Audit lane: wait→mock-ai (needs prompt from `start`, route directly).
      edge('e4', 'audit_wait', 'audit_log', { targetPort: '_gate_wait' }),
      edge('e5', 'start', 'audit_log', { targetPort: 'prompt', label: 'prompt passthrough' }),
      edge('e6', 'audit_log', 'audit_norm', { sourcePort: 'completion', targetPort: 'text' }),
      // any_success convergence — converge fires on the first to finish.
      edge('e7', 'fast_norm', 'converge', {
        sourcePort: 'text',
        targetPort: 'text',
        triggerRule: 'any_success',
        label: 'first wins',
      }),
      edge('e8', 'audit_norm', 'converge', {
        sourcePort: 'text',
        targetPort: 'text',
        triggerRule: 'any_success',
      }),
      edge('e9', 'converge', 'final_review', { sourcePort: 'text' }),
      edge('e10', 'final_review', 'uppercase_out', { targetPort: 'text' }),
      edge('e11', 'uppercase_out', 'publish', { sourcePort: 'text' }),
    ],
    defaultInputs: JSON.stringify({ prompt: 'Summarize today\'s product updates.' }, null, 2),
  },

  // Template 6: Approval escalation with timeout fallback (9 nodes)
  //
  //   start ─┬─ primary_approval ─ primary_action (uppercase) ─┐
  //          │                                                  ├─ converge (any_success) ─ confirm ─ publish
  //          └─ timeout_delay (5s) ─ escalate (approval) ─ escalated_action (uppercase)
  //
  // Demonstrates: approval-vs-timeout race, escalation chain on the
  // slow path, `any_success` so whichever path resolves first proceeds.
  {
    templateId: 'template.approval-escalation',
    name: 'Approval escalation with timeout fallback',
    description:
      'Primary approver races a timeout-triggered escalation to a second approver. Whichever resolves first drives publication.',
    category: 'hitl',
    nodes: [
      node('start', 'noop', pos(0), 'Start'),
      node('primary_approval', 'approval', pos(1, -1), 'Primary approver', {
        prompt: 'Primary approver: approve this request.',
      }),
      node('primary_action', 'uppercase', pos(2, -1), 'Primary path'),
      node('timeout_delay', 'delay', pos(1, 1), 'Timeout window', { durationMs: 5000 }),
      node('escalate', 'approval', pos(2, 1), 'Escalation approver', {
        prompt: 'Escalation: primary timed out. Approve as manager?',
      }),
      node('escalated_action', 'uppercase', pos(3, 1), 'Escalated path'),
      node('converge', 'noop', pos(4), 'Converge (any)'),
      node('confirm', 'approval', pos(5), 'Confirm publication', {
        prompt: 'Final confirmation before publish.',
      }),
      node('publish', 'noop', pos(6), 'Publish'),
    ],
    edges: [
      edge('e1', 'start', 'primary_approval'),
      edge('e2', 'start', 'timeout_delay'),
      edge('e3', 'primary_approval', 'primary_action', { targetPort: 'text' }),
      edge('e4', 'timeout_delay', 'escalate', { targetPort: '_gate_timeout' }),
      edge('e5', 'start', 'escalate', { targetPort: 'in', label: 'data passthrough' }),
      edge('e6', 'escalate', 'escalated_action', { targetPort: 'text' }),
      edge('e7', 'primary_action', 'converge', {
        sourcePort: 'text',
        targetPort: 'text',
        triggerRule: 'any_success',
      }),
      edge('e8', 'escalated_action', 'converge', {
        sourcePort: 'text',
        targetPort: 'text',
        triggerRule: 'any_success',
      }),
      edge('e9', 'converge', 'confirm', { sourcePort: 'text' }),
      edge('e10', 'confirm', 'publish'),
    ],
    defaultInputs: JSON.stringify({ text: 'production deploy v1.4.2' }, null, 2),
  },

  // Template 7: ETL pipeline with parallel extracts (14 nodes)
  //
  //   start ─ kickoff (approval) ─┬─ extract_A (mock-ai) ─ norm_A (uppercase) ──┐
  //                               ├─ extract_B (delay 1s) ─ enrich_B (mock-ai) ─┤
  //                               └─ extract_C (delay 2s) ─ enrich_C (mock-ai) ─┤
  //                                                                              merge (noop, all_success)
  //                                                                              └─ transform (uppercase) ─ qa_review (approval) ─ load_wait (delay 1s) ─ load (mock-ai) ─ confirm
  //
  // Demonstrates: ops-style ETL — gated kickoff, 3-way parallel extracts
  // each with their own sequential pre-step, fan-in convergence, then a
  // serial load chain.
  {
    templateId: 'template.etl-parallel-extracts',
    name: 'ETL pipeline with parallel extracts',
    description:
      '3 concurrent extract lanes (each with its own pre-fetch delay or enrich step) converge, transform, get QA-approved, then load. Mirrors a real ETL ops flow.',
    category: 'pipeline',
    nodes: [
      node('start', 'noop', pos(0), 'Start'),
      node('kickoff', 'approval', pos(1), 'Kickoff', {
        prompt: 'Approve ETL kickoff.',
      }),
      node('extract_A', 'mock-ai', pos(2, -1), 'Extract source A', {
        systemPromptRef: 'etl-extractor-system',
        userPromptRef: 'writer-user',
      }),
      node('norm_A', 'uppercase', pos(3, -1), 'Normalize A'),
      node('extract_B', 'delay', pos(2, 0), 'Extract source B', { durationMs: 1000 }),
      node('enrich_B', 'mock-ai', pos(3, 0), 'Enrich B', {
        systemPromptRef: 'etl-enricher-system',
        userPromptRef: 'writer-user',
      }),
      node('extract_C', 'delay', pos(2, 1), 'Extract source C', { durationMs: 2000 }),
      node('enrich_C', 'mock-ai', pos(3, 1), 'Enrich C', {
        systemPromptRef: 'etl-enricher-system',
        userPromptRef: 'writer-user',
      }),
      node('merge', 'noop', pos(4), 'Merge sources'),
      node('transform', 'uppercase', pos(5), 'Transform'),
      node('qa_review', 'approval', pos(6), 'QA review', {
        prompt: 'QA: approve transformed dataset.',
      }),
      node('load_wait', 'delay', pos(7), 'Load window', { durationMs: 1000 }),
      node('load', 'mock-ai', pos(8), 'Load destination', {
        systemPromptRef: 'editor-system',
        userPromptRef: 'writer-user',
      }),
      node('confirm', 'noop', pos(9), 'Confirm'),
    ],
    edges: [
      edge('e1', 'start', 'kickoff'),
      // Fan-out from kickoff to 3 extract lanes.
      edge('e2', 'kickoff', 'extract_A', { targetPort: 'prompt', label: 'prompt → mock-ai' }),
      edge('e3', 'kickoff', 'extract_B'),
      edge('e4', 'kickoff', 'extract_C'),
      // Lane A: extract → normalize (completion→text)
      edge('e5', 'extract_A', 'norm_A', { sourcePort: 'completion', targetPort: 'text' }),
      // Lane B: delay → mock-ai (needs prompt from kickoff)
      edge('e6', 'extract_B', 'enrich_B', { targetPort: '_gate_b' }),
      edge('e7', 'kickoff', 'enrich_B', { targetPort: 'prompt' }),
      // Lane C: same pattern as B
      edge('e8', 'extract_C', 'enrich_C', { targetPort: '_gate_c' }),
      edge('e9', 'kickoff', 'enrich_C', { targetPort: 'prompt' }),
      // Fan-in to merge — A carries `text`, B/C are gates.
      edge('e10', 'norm_A', 'merge', { sourcePort: 'text', targetPort: 'text' }),
      edge('e11', 'enrich_B', 'merge', { sourcePort: 'completion', targetPort: '_gate_b_done' }),
      edge('e12', 'enrich_C', 'merge', { sourcePort: 'completion', targetPort: '_gate_c_done' }),
      // Serial post-processing.
      edge('e13', 'merge', 'transform', { sourcePort: 'text', targetPort: 'text' }),
      edge('e14', 'transform', 'qa_review', { sourcePort: 'text' }),
      edge('e15', 'qa_review', 'load_wait'),
      edge('e16', 'load_wait', 'load', { targetPort: '_gate_load' }),
      edge('e17', 'qa_review', 'load', { targetPort: 'prompt', label: 'qa output → load prompt' }),
      edge('e18', 'load', 'confirm', { sourcePort: 'completion' }),
    ],
    defaultInputs: JSON.stringify({ prompt: 'customer order events 2026-05-17' }, null, 2),
  },

  // Template 8: Triple-AI review board (11 nodes)
  //
  //   start ─ prepare (uppercase) ─┬─ critic_1 (mock-ai) ─ summary_1 (uppercase) ─┐
  //                                ├─ critic_2 (mock-ai) ─ summary_2 (uppercase) ─┼─ arbiter (approval) ─ final (uppercase) ─ publish
  //                                └─ critic_3 (mock-ai) ─ summary_3 (uppercase) ─┘
  //
  // Demonstrates: 1→3 fan-out into independent AI-then-format chains,
  // 3→1 fan-in to a human arbiter that picks the best.
  {
    templateId: 'template.triple-ai-review-board',
    name: 'Triple-AI review board',
    description:
      '3 parallel AI critics produce independent assessments; a human arbiter picks the best one before publication.',
    category: 'ai',
    nodes: [
      node('start', 'noop', pos(0), 'Start'),
      node('prepare', 'uppercase', pos(1), 'Prepare prompt'),
      node('critic_1', 'mock-ai', pos(2, -2), 'Critic 1', {
        systemPromptRef: 'critic-system',
        userPromptRef: 'writer-user',
      }),
      node('summary_1', 'uppercase', pos(3, -2), 'Summary 1'),
      node('critic_2', 'mock-ai', pos(2, 0), 'Critic 2', {
        systemPromptRef: 'critic-system',
        userPromptRef: 'writer-user',
      }),
      node('summary_2', 'uppercase', pos(3, 0), 'Summary 2'),
      node('critic_3', 'mock-ai', pos(2, 2), 'Critic 3', {
        systemPromptRef: 'critic-system',
        userPromptRef: 'writer-user',
      }),
      node('summary_3', 'uppercase', pos(3, 2), 'Summary 3'),
      node('arbiter', 'approval', pos(4), 'Arbiter pick', {
        prompt: 'Compare the three critic summaries and approve the best.',
      }),
      node('final', 'uppercase', pos(5), 'Final format'),
      node('publish', 'noop', pos(6), 'Publish'),
    ],
    edges: [
      edge('e1', 'start', 'prepare', { targetPort: 'text' }),
      // Fan-out: 3 critics each get prompt-routed text.
      edge('e2', 'prepare', 'critic_1', { sourcePort: 'text', targetPort: 'prompt' }),
      edge('e3', 'prepare', 'critic_2', { sourcePort: 'text', targetPort: 'prompt' }),
      edge('e4', 'prepare', 'critic_3', { sourcePort: 'text', targetPort: 'prompt' }),
      // Each critic → its own summary uppercase
      edge('e5', 'critic_1', 'summary_1', { sourcePort: 'completion', targetPort: 'text' }),
      edge('e6', 'critic_2', 'summary_2', { sourcePort: 'completion', targetPort: 'text' }),
      edge('e7', 'critic_3', 'summary_3', { sourcePort: 'completion', targetPort: 'text' }),
      // Fan-in to arbiter — summary_1 carries data, 2 and 3 are gates.
      edge('e8', 'summary_1', 'arbiter', { sourcePort: 'text', targetPort: 'in' }),
      edge('e9', 'summary_2', 'arbiter', { sourcePort: 'text', targetPort: '_gate_2' }),
      edge('e10', 'summary_3', 'arbiter', { sourcePort: 'text', targetPort: '_gate_3' }),
      edge('e11', 'arbiter', 'final', { targetPort: 'text' }),
      edge('e12', 'final', 'publish', { sourcePort: 'text' }),
    ],
    defaultInputs: JSON.stringify({ text: 'evaluate our new pricing page copy' }, null, 2),
  },

  // =========================================================================
  // AI BYOK (1) — single chat turn
  // =========================================================================

  {
    templateId: 'template.chat-turn',
    name: 'Chat turn',
    description:
      'Single LLM turn via your BYOK credential. Replace credentialRef with one of your saved credentials.',
    category: 'ai',
    requiresBYOK: true,
    nodes: [
      node('n1', 'chat', pos(0), 'Chat', {
        systemPromptRef: 'chat-assistant-system',
      }),
    ],
    edges: [],
    defaultInputs: JSON.stringify(
      {
        messages: [{ role: 'user', content: 'Say hi in five words.' }],
        credentialRef: 'REPLACE_WITH_YOUR_CREDENTIAL_REF',
        provider: 'anthropic',
      },
      null,
      2,
    ),
  },
];

/**
 * Clone a template into a fresh SavedWorkflow ready to drop into
 * localStorage. New id, new timestamps, name suffixed with " (from
 * template)" so it doesn't collide with the original template label.
 */
export function cloneTemplateToUserWorkflow(template: TemplateWorkflow): SavedWorkflow {
  const now = new Date().toISOString();
  return {
    id: newWorkflowId(),
    name: `${template.name} (from template)`,
    version: '1.0.0',
    nodes: template.nodes.map((n) => ({ ...n, config: { ...n.config } })),
    edges: template.edges.map((e) => ({ ...e })),
    defaultInputs: template.defaultInputs,
    createdAt: now,
    updatedAt: now,
  };
}

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  quickstart: 'Quickstart',
  hitl: 'Human-in-the-loop',
  ai: 'AI',
  pipeline: 'Pipeline / DAG',
};
