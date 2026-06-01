/**
 * Built-in demo agent seed — host extension (sample-grade, non-normative).
 *
 * Seeds the "AI coworkers" story (PRD §7): five named agents (Sally, Marcus,
 * Priya, Devon, Nora), each with a role, a workflow portfolio, a task board
 * with varied-source sample cards, a couple of schedules, and an org-chart
 * position. Lets a first-time visitor see the digital-coworker concept without
 * building anything.
 *
 * IDEMPOTENT + non-destructive: seeds only when the tenant's roster is EMPTY,
 * so it never fights a user's own edits (PRD §22.3). Re-running is a no-op once
 * any agent exists. Writes go through the durable host-ext stores, so the seed
 * is consistent across instances and survives a restart.
 *
 * @see src/host/demoWorkflows.ts — the runnable portfolio workflows
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 */

import { createRosterEntry, listRoster, type RosterEntry } from './rosterService.js';
import { createBoard, createCard, type KanbanColumn, type KanbanCardSource } from './kanbanService.js';
import { registerJob } from './schedulingService.js';
import { putChart, type OrgDepartment, type OrgMember } from './orgChartService.js';
import { demoWorkflowsForRole, type DemoRoleKey } from './demoWorkflows.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('host.demoSeed');

interface SeedCard {
  title: string;
  description?: string;
  source: KanbanCardSource;
  sourceLabel?: string;
  priority?: 'low' | 'normal' | 'high';
  /** Lane to place the card in (defaults to To Do). */
  columnId?: string;
  createdBy?: string;
  assignmentReason?: string;
  blockerNote?: string;
}

interface SeedSchedule {
  slug: string;
  cronExpr: string;
  /** Index into the role's workflow portfolio. */
  workflowIndex: number;
  label: string;
}

interface SeedAgent {
  persona: string;
  role: string;
  roleKey: DemoRoleKey;
  description: string;
  systemPrompt: string;
  cards: SeedCard[];
  schedules: SeedSchedule[];
  department: { departmentId: string; name: string; roleId: string; roleName: string };
}

/** The four canonical agent lanes (PRD §7). To Do is the trigger column. */
function demoColumns(triggerWorkflowId: string | undefined): KanbanColumn[] {
  return [
    { id: 'todo', name: 'To Do', ...(triggerWorkflowId ? { triggerWorkflowId } : {}) },
    { id: 'working', name: 'Working' },
    { id: 'waiting', name: 'Waiting on Human' },
    { id: 'done', name: 'Done' },
  ];
}

const SEED_AGENTS: ReadonlyArray<SeedAgent> = [
  {
    persona: 'Sally',
    role: 'Sales Ops Assistant',
    roleKey: 'sales-ops',
    description: 'Precise, friendly, CRM-aware — follows up quickly.',
    systemPrompt:
      'You are Sally, a Sales Ops Assistant. You are precise, friendly, and CRM-aware. You route leads, keep the CRM clean, and follow up on stalled opportunities quickly.',
    cards: [
      { title: 'Review new enterprise lead from website form', source: 'discord', sourceLabel: '/assign @sally', priority: 'high', createdBy: 'Jordan (Sales)', assignmentReason: 'Owns inbound enterprise lead routing for this region.' },
      { title: 'Route ACME renewal note to account owner', source: 'human', priority: 'normal', createdBy: 'Jordan (Sales)', assignmentReason: 'Renewals are part of Sally’s Sales Ops portfolio.', blockerNote: 'Waiting on the updated ACME contract value from Finance.' },
      { title: 'Draft follow-up for stalled opportunity', source: 'workflow', sourceLabel: 'Follow-up reminder generation', createdBy: 'Follow-up reminder generation', assignmentReason: 'Auto-routed to the lead owner.' },
    ],
    schedules: [
      { slug: 'scan-leads', cronExpr: '0 9 * * 1-5', workflowIndex: 0, label: 'Scan new leads (weekdays 9:00 AM)' },
      { slug: 'stale-opps', cronExpr: '0 15 * * 5', workflowIndex: 2, label: 'Summarize stale opportunities (Fri 3:00 PM)' },
    ],
    department: { departmentId: 'sales', name: 'Sales', roleId: 'sales-assistant', roleName: 'Sales Ops Assistant' },
  },
  {
    persona: 'Marcus',
    role: 'Support Triage Specialist',
    roleKey: 'support-triage',
    description: 'Calm, concise, customer-first.',
    systemPrompt:
      'You are Marcus, a Support Triage Specialist. You are calm, concise, and customer-first. You classify inbound tickets, escalate the urgent ones, and draft first responses.',
    cards: [
      { title: 'Classify inbound ticket: "login loop on mobile"', source: 'discord', sourceLabel: '/assign @marcus', priority: 'high' },
      { title: 'Escalate P1 outage report to on-call', source: 'workflow', sourceLabel: 'Priority escalation', columnId: 'waiting', assignmentReason: 'Marcus triages all inbound P1s.', blockerNote: 'Paused until the on-call engineer acknowledges in PagerDuty.' },
      { title: 'Draft response for billing question', source: 'human' },
    ],
    schedules: [
      { slug: 'triage-sweep', cronExpr: '0 * * * *', workflowIndex: 0, label: 'Hourly triage sweep' },
    ],
    department: { departmentId: 'support', name: 'Support', roleId: 'support-specialist', roleName: 'Support Triage Specialist' },
  },
  {
    persona: 'Priya',
    role: 'Finance Ops Analyst',
    roleKey: 'finance-ops',
    description: 'Careful, audit-friendly — asks for approval on risky changes.',
    systemPrompt:
      'You are Priya, a Finance Ops Analyst. You are careful and audit-friendly. You extract invoice data, summarize spend anomalies, and ALWAYS request human approval before applying a risky change.',
    cards: [
      { title: 'Extract fields from Q2 vendor invoice batch', source: 'api', sourceLabel: 'Invoices API', priority: 'normal' },
      { title: 'Approve refund over $5,000', source: 'agent', sourceLabel: 'Created by Marcus', columnId: 'waiting', priority: 'high', createdBy: 'Marcus', assignmentReason: 'Refunds over $5k need Priya’s finance approval.', blockerNote: 'Needs a human sign-off — over Priya’s auto-approval limit.' },
      { title: 'Summarize unusual spend in marketing', source: 'schedule', sourceLabel: 'Weekly spend scan' },
    ],
    schedules: [
      { slug: 'spend-scan', cronExpr: '0 8 * * 1', workflowIndex: 2, label: 'Weekly spend anomaly scan (Mon 8:00 AM)' },
    ],
    department: { departmentId: 'finance', name: 'Finance', roleId: 'finance-analyst', roleName: 'Finance Ops Analyst' },
  },
  {
    persona: 'Devon',
    role: 'Engineering Ops Coordinator',
    roleKey: 'engineering-ops',
    description: 'Pragmatic, technical, risk-aware.',
    systemPrompt:
      'You are Devon, an Engineering Ops Coordinator. You are pragmatic, technical, and risk-aware. You run release checklists, summarize incidents, and coordinate code-review handoffs.',
    cards: [
      { title: 'Run pre-release checklist for v2.4', source: 'human', priority: 'high' },
      { title: 'Summarize last night’s incident timeline', source: 'workflow', sourceLabel: 'Incident summary' },
    ],
    schedules: [
      { slug: 'release-check', cronExpr: '0 16 * * 4', workflowIndex: 0, label: 'Pre-release checklist (Thu 4:00 PM)' },
    ],
    department: { departmentId: 'engineering', name: 'Engineering', roleId: 'eng-coordinator', roleName: 'Engineering Ops Coordinator' },
  },
  {
    persona: 'Nora',
    role: 'Marketing Campaign Coordinator',
    roleKey: 'marketing-ops',
    description: 'Brand-aware, action-oriented.',
    systemPrompt:
      'You are Nora, a Marketing Campaign Coordinator. You are brand-aware and action-oriented. You review campaign briefs, route content for approval, and run channel publish checklists.',
    cards: [
      { title: 'Review Q3 campaign brief against brand guide', source: 'human', priority: 'normal' },
      { title: 'Route blog post for approval', source: 'workflow', sourceLabel: 'Content approval routing', columnId: 'waiting' },
    ],
    schedules: [
      { slug: 'publish-check', cronExpr: '0 10 * * 1-5', workflowIndex: 2, label: 'Daily publish checklist (weekdays 10:00 AM)' },
    ],
    department: { departmentId: 'marketing', name: 'Marketing', roleId: 'mkt-coordinator', roleName: 'Marketing Campaign Coordinator' },
  },
];

export interface SeedResult {
  seeded: boolean;
  agents: number;
}

/**
 * Seed the built-in demo agents for a tenant. Per-persona idempotent: each of
 * the five canonical demo personas is created only if it is MISSING, so this
 * both (a) never duplicates on re-run and (b) self-heals a seed that failed
 * partway. It does NOT touch the user's own (non-demo) agents — only the five
 * named demo personas are managed here. `seeded` is true when at least one
 * agent was created this call.
 *
 * The dashboard only auto-seeds when the roster is entirely empty, so a re-seed
 * of a populated tenant happens only via the explicit "Load demo agents"
 * action (which restoring a deleted demo agent is the expected outcome of).
 */
export async function seedDemoAgents(tenantId: string): Promise<SeedResult> {
  const existing = await listRoster(tenantId);
  const byPersona = new Map<string, RosterEntry>(existing.map((e) => [e.persona.toLowerCase(), e]));

  const members: OrgMember[] = [];
  const departments: OrgDepartment[] = [];
  const seenDepartments = new Set<string>();
  let created = 0;

  for (const spec of SEED_AGENTS) {
    const workflowIds = demoWorkflowsForRole(spec.roleKey).map((w) => w.workflowId);

    let entry = byPersona.get(spec.persona.toLowerCase());
    if (!entry) {
      // Create the roster entry, its board (4 demo lanes; To Do triggers the
      // first workflow), its sample cards, and its schedules. Attribution-only
      // AgentRef (runs dispatch by workflowId, not this id) — a synthetic
      // host-internal manifest reference per RFC 0002.
      entry = await createRosterEntry({
        tenantId,
        persona: spec.persona,
        agentRef: { agentId: `host:demo-${spec.roleKey}`, version: '1.0.0' },
        workflows: workflowIds,
        label: spec.role,
        description: spec.description,
      });
      created += 1;

      const board = await createBoard({
        tenantId,
        name: `${spec.persona}'s board`,
        rosterId: entry.rosterId,
        columns: demoColumns(workflowIds[0]),
      });

      for (const card of spec.cards) {
        await createCard({
          boardId: board.id,
          columnId: card.columnId ?? 'todo',
          title: card.title,
          ...(card.description !== undefined ? { description: card.description } : {}),
          source: card.source,
          ...(card.sourceLabel !== undefined ? { sourceLabel: card.sourceLabel } : {}),
          ...(card.priority !== undefined ? { priority: card.priority } : {}),
          ...(card.createdBy !== undefined ? { createdBy: card.createdBy } : {}),
          ...(card.assignmentReason !== undefined ? { assignmentReason: card.assignmentReason } : {}),
          ...(card.blockerNote !== undefined ? { blockerNote: card.blockerNote } : {}),
        });
      }

      for (const sched of spec.schedules) {
        const workflowId = workflowIds[sched.workflowIndex];
        if (!workflowId) continue;
        await registerJob({
          jobId: `${entry.rosterId}:${sched.slug}`,
          tenantId,
          cronExpr: sched.cronExpr,
          workflowId,
          rosterId: entry.rosterId,
          agentId: entry.agentRef.agentId,
          metadata: { label: sched.label },
        });
      }
    }

    // Org-chart membership is rebuilt from every demo persona that now has a
    // roster entry (existing + just-created), so a self-healed partial seed
    // still produces a complete chart.
    if (!seenDepartments.has(spec.department.departmentId)) {
      seenDepartments.add(spec.department.departmentId);
      departments.push({
        departmentId: spec.department.departmentId,
        name: spec.department.name,
        parentDepartmentId: null,
        roles: [{ roleId: spec.department.roleId, name: spec.department.roleName }],
      });
    }
    members.push({
      rosterId: entry.rosterId,
      departmentId: spec.department.departmentId,
      roleId: spec.department.roleId,
      reportsTo: null,
    });
  }

  // Only (re)write the org-chart when we created something — avoids clobbering
  // a user's hand-built chart on a no-op re-seed.
  if (created > 0) {
    const orgResult = await putChart({ tenantId, departments, members });
    if ('error' in orgResult) {
      // Non-fatal: the roster + boards seeded fine; only the org-chart failed.
      log.warn('demo_seed_orgchart_failed', { tenantId, error: orgResult.error.code });
    }
  }

  log.info('demo_seed_complete', { tenantId, created, total: SEED_AGENTS.length });
  return { seeded: created > 0, agents: SEED_AGENTS.length };
}
