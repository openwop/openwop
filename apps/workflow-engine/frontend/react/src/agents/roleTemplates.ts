/**
 * Role templates + workflow display metadata for the "AI coworkers" UX.
 *
 * Mirrors the backend's built-in demo catalog (host/demoWorkflows.ts): the
 * runnable workflow ids and their business-friendly names. The UI shows the
 * friendly names — raw ids stay out of first-use surfaces (PRD §16). Used by
 * the agent dashboard, workspace portfolio, and the create-agent wizard.
 *
 * Keep in sync with apps/.../backend/typescript/src/host/demoWorkflows.ts.
 */

import type { CSSProperties } from 'react';
import {
  BotIcon,
  BriefcaseIcon,
  LifeBuoyIcon,
  MegaphoneIcon,
  ScaleIcon,
  WrenchIcon,
} from '../ui/icons/index.js';

export interface WorkflowOption {
  workflowId: string;
  name: string;
  purpose: string;
}

export interface RoleTemplate {
  key: string;
  /** Suggested role title for the wizard. */
  title: string;
  /** Short blurb shown on the role picker. */
  blurb: string;
  /** A persona-shaping default system prompt the wizard pre-fills. */
  personaPrompt: string;
  workflows: WorkflowOption[];
}

export const ROLE_TEMPLATES: ReadonlyArray<RoleTemplate> = [
  {
    key: 'sales-ops',
    title: 'Sales Ops Assistant',
    blurb: 'Routes leads, keeps the CRM clean, follows up on opportunities.',
    personaPrompt:
      'You are a Sales Ops Assistant. You are precise, friendly, and CRM-aware. You route leads, keep the CRM clean, and follow up on stalled opportunities quickly.',
    workflows: [
      { workflowId: 'sample.agents.lead-routing', name: 'Lead routing', purpose: 'Score a new lead and route it to the right account owner.' },
      { workflowId: 'sample.agents.crm-hygiene', name: 'CRM hygiene review', purpose: 'Flag stale or incomplete CRM records for cleanup.' },
      { workflowId: 'sample.agents.follow-up-reminder', name: 'Follow-up reminder generation', purpose: 'Draft follow-up reminders for stalled opportunities.' },
    ],
  },
  {
    key: 'support-triage',
    title: 'Support Triage Specialist',
    blurb: 'Classifies tickets, escalates the urgent ones, drafts responses.',
    personaPrompt:
      'You are a Support Triage Specialist. You are calm, concise, and customer-first. You classify inbound tickets, escalate the urgent ones, and draft first responses.',
    workflows: [
      { workflowId: 'sample.agents.ticket-classification', name: 'Ticket classification', purpose: 'Categorize an inbound support ticket by topic and severity.' },
      { workflowId: 'sample.agents.priority-escalation', name: 'Priority escalation', purpose: 'Escalate high-priority tickets to the on-call owner.' },
      { workflowId: 'sample.agents.support-response', name: 'Support response drafting', purpose: 'Draft a customer-ready first response for review.' },
    ],
  },
  {
    key: 'finance-ops',
    title: 'Finance Ops Analyst',
    blurb: 'Extracts invoices, summarizes spend, gates risky changes for approval.',
    personaPrompt:
      'You are a Finance Ops Analyst. You are careful and audit-friendly. You extract invoice data, summarize spend anomalies, and ALWAYS request human approval before applying a risky change.',
    workflows: [
      { workflowId: 'sample.agents.invoice-extraction', name: 'Invoice extraction', purpose: 'Extract structured fields from an uploaded invoice.' },
      { workflowId: 'sample.agents.approval-gate', name: 'Approval gate', purpose: 'Hold a risky change for human approval before applying it.' },
      { workflowId: 'sample.agents.spend-anomaly', name: 'Spend anomaly summary', purpose: 'Summarize unusual spend for the finance team.' },
    ],
  },
  {
    key: 'engineering-ops',
    title: 'Engineering Ops Coordinator',
    blurb: 'Runs release checklists, summarizes incidents, coordinates handoffs.',
    personaPrompt:
      'You are an Engineering Ops Coordinator. You are pragmatic, technical, and risk-aware. You run release checklists, summarize incidents, and coordinate code-review handoffs.',
    workflows: [
      { workflowId: 'sample.agents.release-checklist', name: 'Release checklist', purpose: 'Run the pre-release checklist and report gaps.' },
      { workflowId: 'sample.agents.incident-summary', name: 'Incident summary', purpose: 'Draft an incident summary from the timeline.' },
      { workflowId: 'sample.agents.code-review-handoff', name: 'Code review handoff', purpose: 'Package a change for the next reviewer in the chain.' },
    ],
  },
  {
    key: 'marketing-ops',
    title: 'Marketing Campaign Coordinator',
    blurb: 'Reviews briefs, routes content for approval, runs publish checklists.',
    personaPrompt:
      'You are a Marketing Campaign Coordinator. You are brand-aware and action-oriented. You review campaign briefs, route content for approval, and run channel publish checklists.',
    workflows: [
      { workflowId: 'sample.agents.campaign-brief', name: 'Campaign brief review', purpose: 'Review a campaign brief against brand guidelines.' },
      { workflowId: 'sample.agents.content-approval', name: 'Content approval routing', purpose: 'Route content for approval before publish.' },
      { workflowId: 'sample.agents.channel-publish', name: 'Channel publish checklist', purpose: 'Run the publish checklist for each channel.' },
    ],
  },
];

const WF_BY_ID = new Map<string, WorkflowOption>(
  ROLE_TEMPLATES.flatMap((r) => r.workflows).map((w) => [w.workflowId, w]),
);

/** Friendly display name for a workflow id; falls back to the raw id when it is
 *  not a known built-in (e.g. a user's own registered workflow). */
export function workflowName(workflowId: string): string {
  return WF_BY_ID.get(workflowId)?.name ?? workflowId;
}

export function workflowPurpose(workflowId: string): string | undefined {
  return WF_BY_ID.get(workflowId)?.purpose;
}

/** True when the id is one of the built-in runnable demo workflows (vs a
 *  local-only/unregistered workflow that needs registration to run). */
export function isKnownWorkflow(workflowId: string): boolean {
  return WF_BY_ID.has(workflowId);
}

export const ALL_WORKFLOW_OPTIONS: ReadonlyArray<WorkflowOption> = ROLE_TEMPLATES.flatMap((r) => r.workflows);

// ---------------------------------------------------------------------------
// Role theming — give each role a distinct Lucide glyph so a dashboard of 5+
// coworkers reads at a glance. Differentiation is by ICON only (no per-role
// colour): DESIGN.app.md §3 reserves the functional/accent palette for run
// state, so a role accent would fight the editorial discipline. The clay
// avatar stays uniform; the glyph inside it carries the role.
// ---------------------------------------------------------------------------

type IconComponent = (props: { size?: number; strokeWidth?: number; style?: CSSProperties }) => JSX.Element;

export interface RoleTheme {
  key: string;
  /** Human label for the role family (e.g. "Sales", "Support"). */
  label: string;
  Icon: IconComponent;
}

const ROLE_THEMES: Record<string, RoleTheme> = {
  'sales-ops': { key: 'sales-ops', label: 'Sales', Icon: BriefcaseIcon },
  'support-triage': { key: 'support-triage', label: 'Support', Icon: LifeBuoyIcon },
  'finance-ops': { key: 'finance-ops', label: 'Finance', Icon: ScaleIcon },
  'engineering-ops': { key: 'engineering-ops', label: 'Engineering', Icon: WrenchIcon },
  'marketing-ops': { key: 'marketing-ops', label: 'Marketing', Icon: MegaphoneIcon },
};

const CUSTOM_THEME: RoleTheme = { key: 'custom', label: 'Custom', Icon: BotIcon };

/** Map a role-template key (or anything) to its theme; unknown → the custom (Bot) theme. */
export function roleThemeForKey(key: string | undefined): RoleTheme {
  return (key && ROLE_THEMES[key]) || CUSTOM_THEME;
}

/** Derive the role-template key for a roster member: prefer the seeded
 *  `host:demo-<key>` agentRef, else infer from the workflow portfolio, else
 *  fall back to the custom theme. Mirrors host/demoSeed.ts agentRef ids. */
export function roleKeyForAgent(agentId: string | undefined, workflows: ReadonlyArray<string>): string {
  if (agentId) {
    const m = /^host:demo-(.+)$/.exec(agentId);
    if (m && ROLE_THEMES[m[1]]) return m[1];
  }
  // Infer from the portfolio: the template whose workflows overlap the most.
  let best: { key: string; hits: number } | null = null;
  for (const t of ROLE_TEMPLATES) {
    const ids = new Set(t.workflows.map((w) => w.workflowId));
    const hits = workflows.reduce((n, w) => n + (ids.has(w) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { key: t.key, hits };
  }
  return best?.key ?? 'custom';
}

/** Convenience: theme for a roster member. */
export function roleThemeForAgent(agentId: string | undefined, workflows: ReadonlyArray<string>): RoleTheme {
  return roleThemeForKey(roleKeyForAgent(agentId, workflows));
}
