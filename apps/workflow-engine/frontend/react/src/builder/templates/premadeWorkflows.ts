/**
 * Premade workflow templates surfaced in the dashboard.
 *
 * Each template is a fully-formed `SavedWorkflow` graph using only the
 * 5 nodes the sample backend can execute end-to-end today: noop, delay,
 * uppercase, approval, chat. See
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
 * **AI nodes** call a real LLM by default. With no `credentialRef`
 * configured, the chat-responder falls back to the managed
 * `openwop-free` tile (MiniMax under the hood). Users can override
 * per-node via the Inspector picker once they've stored their own key
 * at `/keys`.
 *
 * **Node output shapes** (from nodes.ts):
 *   noop       — `{ ...inputs }`   (pass-through; preserves all keys)
 *   delay      — `{ waitedMs }`    (single key; original input lost)
 *   approval   — opaque pass-through after resolve
 *   uppercase  — `{ text }`
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
  /** Pack node typeIds this template depends on. When set, the template
   *  is only offered if every typeId is present in the merged catalog
   *  (i.e. the host has the pack installed) — so it never seeds a
   *  workflow with "Unknown" nodes. Templates using only the built-in
   *  node set omit this. */
  requiresTypeIds?: readonly string[];
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
  // QUICKSTART — smallest honest workflow shapes
  // =========================================================================
  //
  // Single-node templates ("Hello uppercase", "Mock AI completion",
  // "Chat turn") were removed on 2026-05-22 — they didn't demonstrate
  // orchestration. The minimum useful workflow has at least two nodes
  // connected by one edge so the user can see what OpenWOP gives them
  // over a one-shot function call or LLM hit. The AI chat tab is the
  // right home for single-shot LLM calls.

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
  // PIPELINE / DAG — multi-step + concurrent paths
  // =========================================================================

  // RAG ingest + retrieve (RFC 0018). Full load → extract → split →
  // upsert → retrieve pipeline, all edges port-shape-correct + verified
  // end-to-end against a live host:
  //   - loader-url emits `document` (object {url,contentType,content,…});
  //     `core.openwop.data.object-get-path` (path: "content") extracts the
  //     text STRING from it → feeds the splitter's `text` (string) input.
  //     This is the field-extraction step a port→port edge can't do alone.
  //   - splitter `chunks` (array) → vector-upsert `documents` (array).
  //   - the upsert→retrieve edge is a GATE (distinct `_gate_*` targetPort)
  //     so retrieve waits for ingest without its `query` (from run inputs)
  //     being clobbered (see the port-routing note above).
  // load→extract→split runs end-to-end; vector-upsert/retriever then need
  // a host embeddings surface (host.aiProviders / BYOK) + vector store —
  // the item-12 pre-flight flags both when the host lacks them.
  {
    templateId: 'template.rag-ingest-retrieve',
    name: 'RAG: load + split + upsert + retrieve',
    description:
      'Load a URL → extract text → chunk → upsert to the vector store → retrieve by query. Needs the core.openwop.rag + core.openwop.data packs, a host vector store, and embeddings (BYOK).',
    category: 'pipeline',
    requiresTypeIds: [
      'core.rag.loader-url',
      'core.openwop.data.object-get-path',
      'core.rag.splitter-recursive',
      'core.rag.vector-upsert',
      'core.rag.retriever-basic',
    ],
    nodes: [
      node('load', 'core.rag.loader-url', pos(0, -1), 'Load URL'),
      node('extract', 'core.openwop.data.object-get-path', pos(1, -1), 'Extract text', { path: 'content' }),
      node('split', 'core.rag.splitter-recursive', pos(2, -1), 'Split (recursive)'),
      node('upsert', 'core.rag.vector-upsert', pos(3, -1), 'Vector upsert'),
      node('retrieve', 'core.rag.retriever-basic', pos(4, 0), 'Retrieve'),
    ],
    edges: [
      edge('e1', 'load', 'extract', { sourcePort: 'document', targetPort: 'object' }),
      edge('e2', 'extract', 'split', { sourcePort: 'value', targetPort: 'text' }),
      edge('e3', 'split', 'upsert', { sourcePort: 'chunks', targetPort: 'documents' }),
      edge('e4', 'upsert', 'retrieve', { sourcePort: 'upserted', targetPort: '_gate_ingest' }),
    ],
    defaultInputs: JSON.stringify(
      { url: 'https://raw.githubusercontent.com/openwop/openwop/main/README.md', query: 'What is OpenWOP?' },
      null,
      2,
    ),
  },

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
      node('draft', 'chat', pos(1), 'Draft content', {
        systemPrompt:
          'You are a careful editorial writer. Match the requested tone exactly. Keep paragraphs tight. Do not invent facts.',
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
  //   start ─┬─ fast_draft (chat) ─ fast_norm (uppercase) ────┐
  //          │                                                   ├─ converge (any_success) ─ final_review ─ publish
  //          └─ audit_wait (delay 2s) ─ audit_log (chat) ─ audit_norm (uppercase)
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
      node('fast_draft', 'chat', pos(1, -1), 'Fast draft', {
        systemPrompt:
          'You are a fast drafter. Produce a single-sentence response to the request below. No preamble.',
      }),
      node('fast_norm', 'uppercase', pos(2, -1), 'Fast normalize'),
      node('audit_wait', 'delay', pos(1, 1), 'Audit wait', { durationMs: 2000 }),
      node('audit_log', 'chat', pos(2, 1), 'Audit log', {
        systemPrompt:
          'You are an audit logger. Summarize the request below in one sentence in the format: "Request received at <time>: <summary>". Use a placeholder for the time.',
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
      // Audit lane: wait→chat (needs prompt from `start`, route directly).
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
  //   start ─ kickoff (approval) ─┬─ extract_A (chat) ─ norm_A (uppercase) ──┐
  //                               ├─ extract_B (delay 1s) ─ enrich_B (chat) ─┤
  //                               └─ extract_C (delay 2s) ─ enrich_C (chat) ─┤
  //                                                                              merge (noop, all_success)
  //                                                                              └─ transform (uppercase) ─ qa_review (approval) ─ load_wait (delay 1s) ─ load (chat) ─ confirm
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
      node('extract_A', 'chat', pos(2, -1), 'Extract source A', {
        systemPrompt:
          'You are a data extractor. Given the source description below, output a one-paragraph synthetic sample of the kind of records that source would produce. Plain text, no JSON.',
      }),
      node('norm_A', 'uppercase', pos(3, -1), 'Normalize A'),
      node('extract_B', 'delay', pos(2, 0), 'Extract source B', { durationMs: 1000 }),
      node('enrich_B', 'chat', pos(3, 0), 'Enrich B', {
        systemPrompt:
          'You are a data enricher. Given the input below, output a one-paragraph enriched version that adds plausible derived fields.',
      }),
      node('extract_C', 'delay', pos(2, 1), 'Extract source C', { durationMs: 2000 }),
      node('enrich_C', 'chat', pos(3, 1), 'Enrich C', {
        systemPrompt:
          'You are a data enricher. Given the input below, output a one-paragraph enriched version that adds plausible derived fields.',
      }),
      node('merge', 'noop', pos(4), 'Merge sources'),
      node('transform', 'uppercase', pos(5), 'Transform'),
      node('qa_review', 'approval', pos(6), 'QA review', {
        prompt: 'QA: approve transformed dataset.',
      }),
      node('load_wait', 'delay', pos(7), 'Load window', { durationMs: 1000 }),
      node('load', 'chat', pos(8), 'Load destination', {
        systemPrompt:
          'You are a load step. Confirm the transformed dataset below has been loaded by replying with a single sentence describing the destination and row count.',
      }),
      node('confirm', 'noop', pos(9), 'Confirm'),
    ],
    edges: [
      edge('e1', 'start', 'kickoff'),
      // Fan-out from kickoff to 3 extract lanes.
      edge('e2', 'kickoff', 'extract_A', { targetPort: 'prompt', label: 'prompt → chat' }),
      edge('e3', 'kickoff', 'extract_B'),
      edge('e4', 'kickoff', 'extract_C'),
      // Lane A: extract → normalize (completion→text)
      edge('e5', 'extract_A', 'norm_A', { sourcePort: 'completion', targetPort: 'text' }),
      // Lane B: delay → chat (needs prompt from kickoff)
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
  //   start ─ prepare (uppercase) ─┬─ critic_1 (chat) ─ summary_1 (uppercase) ─┐
  //                                ├─ critic_2 (chat) ─ summary_2 (uppercase) ─┼─ arbiter (approval) ─ final (uppercase) ─ publish
  //                                └─ critic_3 (chat) ─ summary_3 (uppercase) ─┘
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
      node('critic_1', 'chat', pos(2, -2), 'Clarity critic', {
        systemPrompt:
          'You are a clarity editor. Read the text below and give 3 short bullet-point notes on how to make it clearer. Do not rewrite. Be terse.',
      }),
      node('summary_1', 'uppercase', pos(3, -2), 'Summary 1'),
      node('critic_2', 'chat', pos(2, 0), 'Persuasion critic', {
        systemPrompt:
          'You are a copywriter focused on persuasion. Read the text below and give 3 short bullet-point notes on how to make it more persuasive. Do not rewrite. Be terse.',
      }),
      node('summary_2', 'uppercase', pos(3, 0), 'Summary 2'),
      node('critic_3', 'chat', pos(2, 2), 'Brevity critic', {
        systemPrompt:
          'You are a brevity editor. Read the text below and give 3 short bullet-point notes on what to cut. Do not rewrite. Be terse.',
      }),
      node('summary_3', 'uppercase', pos(3, 2), 'Summary 3'),
      node('arbiter', 'approval', pos(4), 'Arbiter review', {
        prompt:
          'Pick the critique you want to send to the final formatter. (Or hit reject to abort the run.)',
        // Maps the targetPort name on each incoming edge to a display
        // label for the approval card's per-option picker. Without this
        // the card falls back to a humanized port name.
        optionLabels: {
          clarity_summary: 'Clarity critic',
          persuasion_summary: 'Persuasion critic',
          brevity_summary: 'Brevity critic',
        },
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
      // Fan-in to arbiter — each summary lands on a distinct named
      // port so the approval node bundles them as discrete `options`
      // in interrupt.data. The approver picks one in the chat card;
      // the picked text flows downstream as the approval node's output.
      edge('e8', 'summary_1', 'arbiter', { sourcePort: 'text', targetPort: 'clarity_summary' }),
      edge('e9', 'summary_2', 'arbiter', { sourcePort: 'text', targetPort: 'persuasion_summary' }),
      edge('e10', 'summary_3', 'arbiter', { sourcePort: 'text', targetPort: 'brevity_summary' }),
      edge('e11', 'arbiter', 'final', { targetPort: 'text' }),
      edge('e12', 'final', 'publish', { sourcePort: 'text' }),
    ],
    defaultInputs: JSON.stringify(
      {
        text:
          'Our new pricing is simple: $19/month gets you the Starter plan with unlimited workflows, ' +
          '10,000 runs, and email support. Teams that need more can upgrade to Pro at $49/month for ' +
          '50,000 runs and priority support. Both plans include a 14-day free trial — no credit card ' +
          'required. Cancel anytime.',
      },
      null,
      2,
    ),
  },

  // The single-node "Chat turn" template was removed on 2026-05-22 —
  // it required BYOK to even try, it duplicated the AI chat tab, and
  // it didn't demonstrate orchestration (no edges, no multi-step shape).
  // Users who want to wire a real LLM into a workflow can drag a `chat`
  // node from the palette onto any of the surviving templates above.
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
    name: template.name,
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
