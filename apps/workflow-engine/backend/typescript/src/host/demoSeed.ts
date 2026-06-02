/**
 * Built-in demo agent seed — host extension (sample-grade, non-normative).
 *
 * Seeds the "AI coworkers" story (PRD §7): five named agents (Sally, Marcus,
 * Priya, Devon, Nora), each with a role, a workflow portfolio, a task board
 * with varied-source sample cards, a couple of schedules, and an org-chart
 * position. Lets a first-time visitor see the digital-coworker concept without
 * building anything.
 *
 * WHITE-LABEL / SEED STRATEGY (mirrors myndhyve's `SEEDING.md`): the seed
 * CONTENT is data, not code. The roster lives in the brand-authoring surface
 * `src/host/seed-data/demoAgents.json` — a white-label deployer edits that one
 * file (or sets `OPENWOP_DEMO_SEED_ENABLED=false` to ship NO demo data) rather
 * than hand-editing hard-coded personas here. This file holds only the seeding
 * LOGIC.
 *
 * IDEMPOTENT + non-destructive: seeds only when the tenant's roster is EMPTY,
 * so it never fights a user's own edits (PRD §22.3). Re-running is a no-op once
 * any agent exists. Writes go through the durable host-ext stores, so the seed
 * is consistent across instances and survives a restart.
 *
 * @see src/host/seed-data/demoAgents.json — the seed content (brand surface)
 * @see src/host/demoWorkflows.ts — the runnable portfolio workflows
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 */

import { createRosterEntry, listRoster, type RosterEntry } from './rosterService.js';
import { createBoard, createCard, type KanbanColumn, type KanbanCardSource } from './kanbanService.js';
import { registerJob } from './schedulingService.js';
import { putChart, type OrgDepartment, type OrgMember } from './orgChartService.js';
import { demoWorkflowsForRole, type DemoRoleKey } from './demoWorkflows.js';
import { createLogger } from '../observability/logger.js';
import demoAgentSeed from './seed-data/demoAgents.json';

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
  /** Heartbeat autonomy for this seeded persona (host-extension). Omit for
   *  `auto` (start picks immediately); `review` ships the persona in the
   *  "agents propose, humans dispose" mode — its heartbeat queues a proposal
   *  for the approval inbox instead of running. Lets a white-label operator
   *  author review-mode agents declaratively in the seed (WHITE-LABEL.md §4). */
  autonomyLevel?: 'auto' | 'review';
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

/**
 * Demo roster content — loaded from the brand-authoring data file (esbuild
 * inlines it into the bundle). `resolveJsonModule` widens the JSON's string
 * fields to `string`, so we assert the authored shape here; the structure is
 * pinned by `agents-demo.test.ts`, which seeds and asserts the five personas.
 */
const SEED_AGENTS = demoAgentSeed as readonly SeedAgent[];

/**
 * White-label switch: set `OPENWOP_DEMO_SEED_ENABLED=false` to ship NO demo
 * agents/boards/schedules (a clean tenant for a branded deployment). Defaults
 * on, preserving the reference app's first-use experience.
 */
function demoSeedEnabled(): boolean {
  return process.env.OPENWOP_DEMO_SEED_ENABLED !== 'false';
}

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
  if (!demoSeedEnabled()) {
    log.info('demo_seed_skipped', { tenantId, reason: 'OPENWOP_DEMO_SEED_ENABLED=false' });
    return { seeded: false, agents: 0 };
  }

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
        autonomyLevel: spec.autonomyLevel,
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
