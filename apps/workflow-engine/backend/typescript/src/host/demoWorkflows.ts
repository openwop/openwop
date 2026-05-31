/**
 * Built-in demo role-workflows — host extension (sample-grade, non-normative).
 *
 * The "AI coworkers" demo (RFCS/0086 roster + RFCS/0087 org-chart) seeds named
 * agents — Sally in Sales Ops, Marcus in Support, … — each owning a portfolio
 * of role workflows ("Lead routing", "Ticket classification", …). For those
 * portfolio ids to be *runnable* (a Kanban card move, a schedule, or a
 * heartbeat pick-up starts a real run), they MUST resolve via
 * `workflowCatalog.getWorkflow()`.
 *
 * They live HERE — alongside the hard-coded `sample.demo.*` workflows in
 * host/index.ts (catalog source A) — and NOT in the builder's in-memory
 * registry (`POST /v1/host/sample/workflows`). That matters for two reasons:
 *   - cross-instance: the in-memory registry is process-local, so a workflow
 *     registered on one Cloud Run instance is invisible to the others (the app
 *     scales to max=10). A hard-coded catalog entry is identical on every
 *     instance.
 *   - restart-safe: the in-memory registry is lost on restart; these survive.
 *
 * Each definition is built from deterministic sample nodes
 * (`local.sample.demo.mock-ai`, `local.sample.demo.uppercase`,
 * `core.approvalGate`) so every demo workflow runs end-to-end with NO BYOK
 * provider and replays deterministically — the same posture as the existing
 * `sample.demo.*` catalog entries.
 *
 * @see src/host/index.ts — workflowCatalog.getWorkflow (catalog source A)
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md §D
 */

import type { WorkflowDefinition } from '../executor/types.js';

/** A built-in demo workflow: a runnable id + business-friendly metadata the
 *  frontend surfaces (no raw ids in first-use UI, per the PRD copy rules). */
export interface DemoWorkflowSpec {
  /** Backend-resolvable workflow id (the value stored in a roster portfolio). */
  workflowId: string;
  /** Business-friendly name shown in the UI. */
  name: string;
  /** One-line "what this workflow does" for portfolio cards. */
  purpose: string;
  /** The role this workflow belongs to (drives wizard suggestions). */
  role: DemoRoleKey;
  /** The deterministic node graph the run executes. */
  definition: WorkflowDefinition;
}

export type DemoRoleKey =
  | 'sales-ops'
  | 'support-triage'
  | 'finance-ops'
  | 'engineering-ops'
  | 'marketing-ops';

/** A single-node deterministic "summarize"-style workflow (mock AI, no BYOK). */
function mockAiWorkflow(workflowId: string): WorkflowDefinition {
  return {
    workflowId,
    nodes: [{ nodeId: 'work', typeId: 'local.sample.demo.mock-ai', outputRole: 'primary' }],
  };
}

/** An approval-gated workflow: a human approval interrupt then a deterministic
 *  step. Drives the "Waiting on Human" lane story for Finance Ops. */
function approvalWorkflow(workflowId: string, prompt: string): WorkflowDefinition {
  return {
    workflowId,
    nodes: [
      { nodeId: 'approve', typeId: 'core.approvalGate', config: { prompt } },
      { nodeId: 'apply', typeId: 'local.sample.demo.mock-ai', outputRole: 'primary' },
    ],
    edges: [{ edgeId: 'e1', sourceNodeId: 'approve', targetNodeId: 'apply' }],
  };
}

/** The built-in demo workflow catalog, keyed by workflowId. */
export const DEMO_WORKFLOWS: ReadonlyArray<DemoWorkflowSpec> = [
  // ── Sales Ops (Sally) ──
  {
    workflowId: 'sample.agents.lead-routing',
    name: 'Lead routing',
    purpose: 'Score a new lead and route it to the right account owner.',
    role: 'sales-ops',
    definition: mockAiWorkflow('sample.agents.lead-routing'),
  },
  {
    workflowId: 'sample.agents.crm-hygiene',
    name: 'CRM hygiene review',
    purpose: 'Flag stale or incomplete CRM records for cleanup.',
    role: 'sales-ops',
    definition: mockAiWorkflow('sample.agents.crm-hygiene'),
  },
  {
    workflowId: 'sample.agents.follow-up-reminder',
    name: 'Follow-up reminder generation',
    purpose: 'Draft follow-up reminders for stalled opportunities.',
    role: 'sales-ops',
    definition: mockAiWorkflow('sample.agents.follow-up-reminder'),
  },
  // ── Support Triage (Marcus) ──
  {
    workflowId: 'sample.agents.ticket-classification',
    name: 'Ticket classification',
    purpose: 'Categorize an inbound support ticket by topic and severity.',
    role: 'support-triage',
    definition: mockAiWorkflow('sample.agents.ticket-classification'),
  },
  {
    workflowId: 'sample.agents.priority-escalation',
    name: 'Priority escalation',
    purpose: 'Escalate high-priority tickets to the on-call owner.',
    role: 'support-triage',
    definition: approvalWorkflow('sample.agents.priority-escalation', 'Escalate this ticket to on-call?'),
  },
  {
    workflowId: 'sample.agents.support-response',
    name: 'Support response drafting',
    purpose: 'Draft a customer-ready first response for review.',
    role: 'support-triage',
    definition: mockAiWorkflow('sample.agents.support-response'),
  },
  // ── Finance Ops (Priya) ──
  {
    workflowId: 'sample.agents.invoice-extraction',
    name: 'Invoice extraction',
    purpose: 'Extract structured fields from an uploaded invoice.',
    role: 'finance-ops',
    definition: mockAiWorkflow('sample.agents.invoice-extraction'),
  },
  {
    workflowId: 'sample.agents.approval-gate',
    name: 'Approval gate',
    purpose: 'Hold a risky change for human approval before applying it.',
    role: 'finance-ops',
    definition: approvalWorkflow('sample.agents.approval-gate', 'Approve this finance change?'),
  },
  {
    workflowId: 'sample.agents.spend-anomaly',
    name: 'Spend anomaly summary',
    purpose: 'Summarize unusual spend for the finance team.',
    role: 'finance-ops',
    definition: mockAiWorkflow('sample.agents.spend-anomaly'),
  },
  // ── Engineering Ops (Devon) ──
  {
    workflowId: 'sample.agents.release-checklist',
    name: 'Release checklist',
    purpose: 'Run the pre-release checklist and report gaps.',
    role: 'engineering-ops',
    definition: mockAiWorkflow('sample.agents.release-checklist'),
  },
  {
    workflowId: 'sample.agents.incident-summary',
    name: 'Incident summary',
    purpose: 'Draft an incident summary from the timeline.',
    role: 'engineering-ops',
    definition: mockAiWorkflow('sample.agents.incident-summary'),
  },
  {
    workflowId: 'sample.agents.code-review-handoff',
    name: 'Code review handoff',
    purpose: 'Package a change for the next reviewer in the chain.',
    role: 'engineering-ops',
    definition: mockAiWorkflow('sample.agents.code-review-handoff'),
  },
  // ── Marketing Ops (Nora) ──
  {
    workflowId: 'sample.agents.campaign-brief',
    name: 'Campaign brief review',
    purpose: 'Review a campaign brief against brand guidelines.',
    role: 'marketing-ops',
    definition: mockAiWorkflow('sample.agents.campaign-brief'),
  },
  {
    workflowId: 'sample.agents.content-approval',
    name: 'Content approval routing',
    purpose: 'Route content for approval before publish.',
    role: 'marketing-ops',
    definition: approvalWorkflow('sample.agents.content-approval', 'Approve this content for publish?'),
  },
  {
    workflowId: 'sample.agents.channel-publish',
    name: 'Channel publish checklist',
    purpose: 'Run the publish checklist for each channel.',
    role: 'marketing-ops',
    definition: mockAiWorkflow('sample.agents.channel-publish'),
  },
];

const BY_ID = new Map<string, DemoWorkflowSpec>(DEMO_WORKFLOWS.map((w) => [w.workflowId, w]));

/** Resolve a built-in demo workflow definition by id, or null. Wired into
 *  `workflowCatalog.getWorkflow` so demo portfolio ids are runnable. */
export function getDemoWorkflow(workflowId: string): WorkflowDefinition | null {
  return BY_ID.get(workflowId)?.definition ?? null;
}

/** The workflow ids belonging to a role — used by the seed + create-agent
 *  wizard to suggest a portfolio. */
export function demoWorkflowsForRole(role: DemoRoleKey): DemoWorkflowSpec[] {
  return DEMO_WORKFLOWS.filter((w) => w.role === role);
}
