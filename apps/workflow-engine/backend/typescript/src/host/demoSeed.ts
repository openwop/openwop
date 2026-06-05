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
import { createBoard, createCard, listBoards, type KanbanBoard, type KanbanColumn, type KanbanCardSource } from './kanbanService.js';
import { getJob, registerJob } from './schedulingService.js';
import { getChart, putChart, type OrgDepartment, type OrgMember } from './orgChartService.js';
import { demoWorkflowsForRole, type DemoRoleKey } from './demoWorkflows.js';
import { createLogger } from '../observability/logger.js';
import { ensureUserAgentRegistered } from '../routes/userAgents.js';
import type { Storage } from '../storage/storage.js';
import type { UserAgentRecord } from '../types.js';
import demoAgentSeed from './seed-data/demoAgents.json';

/** Lowercase-kebab slug from a persona name — must match the frontend's
 *  `slugify` in `chat/lib/agentMentions.ts` so the `@`-mention slug a user
 *  types (`@nora`) resolves to the same agent the seed registered. */
function personaSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

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
  /** Model class for the persona's chat-callable inventory agent. Optional in
   *  the seed data; defaults to `chat`. One of the host's known classes
   *  (`userAgents.ts` KNOWN_MODEL_CLASSES: chat / reasoning / coding / extraction). */
  modelClass?: string;
  cards: SeedCard[];
  schedules: SeedSchedule[];
  department: { departmentId: string; name: string; roleId: string; roleName: string };
  /** Heartbeat autonomy for this seeded persona (host-extension). Omit for
   *  `auto` (start picks immediately); `review` ships the persona in the
   *  "agents propose, humans dispose" mode — its heartbeat queues a proposal
   *  for the approval inbox instead of running. Lets a white-label operator
   *  author review-mode agents declaratively in the seed (WHITE-LABEL.md §4). */
  autonomyLevel?: 'auto' | 'guided' | 'review';
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
  /** Present when `heal: true` — what an explicit re-seed restored for
   *  EXISTING personas (missing boards / schedule jobs / a missing chart). */
  healed?: { boards: number; schedules: number; orgChart: boolean };
}

export interface SeedOptions {
  /** Restore missing demo surfaces for personas that already exist.
   *
   *  OFF for the silent auto-seed-on-entry (it must never resurrect a board or
   *  schedule the user deliberately deleted); ON for the explicit "Load demo
   *  data" action — whose whole point is "put the demo back". Healing creates
   *  a missing BOARD (with its sample cards), registers missing schedule
   *  jobIds, and rebuilds the org chart ONLY when none exists. It never
   *  touches an existing board's cards (clearing a board is normal usage). */
  heal?: boolean;
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
export async function seedDemoAgents(
  tenantId: string,
  storage: Storage,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  if (!demoSeedEnabled()) {
    log.info('demo_seed_skipped', { tenantId, reason: 'OPENWOP_DEMO_SEED_ENABLED=false' });
    return { seeded: false, agents: 0 };
  }

  const existing = await listRoster(tenantId);
  const byPersona = new Map<string, RosterEntry>(existing.map((e) => [e.persona.toLowerCase(), e]));

  // Heal mode: one boards read up front so per-agent "is the board missing?"
  // is a map lookup, not N scans.
  const boardByRoster = new Map<string, KanbanBoard>();
  if (opts.heal) {
    for (const b of await listBoards(tenantId)) {
      if (b.rosterId) boardByRoster.set(b.rosterId, b);
    }
  }

  const members: OrgMember[] = [];
  const departments: OrgDepartment[] = [];
  const seenDepartments = new Set<string>();
  let created = 0;
  let healedBoards = 0;
  let healedSchedules = 0;

  for (const spec of SEED_AGENTS) {
    const workflowIds = demoWorkflowsForRole(spec.roleKey).map((w) => w.workflowId);

    // Register the persona as a tenant-owned, chat-callable inventory agent
    // (RFC 0072) via the same isolation-correct path the create wizard uses, so
    // a user can `@`-mention it in chat (the mention list is fed by
    // `GET /v1/agents`; the chat-responder resolves `inputs.agentId` →
    // systemPrompt, gated by `ownerTenant === tenantId`). The persona's
    // `systemPrompt` is authored in `demoAgents.json` and was previously unused
    // on any chat-reachable path. Done for EVERY spec (not just newly-created
    // roster entries) so an explicit "Load demo agents" re-seed heals tenants
    // seeded before this feature. Idempotent: insert-if-absent + last-write-wins
    // registry register.
    const chatAgentId = `user.${tenantId}.${personaSlug(spec.persona)}`;
    const userAgentRecord: UserAgentRecord = {
      agentId: chatAgentId,
      tenantId,
      persona: spec.persona,
      label: spec.role,
      description: spec.description,
      modelClass: spec.modelClass ?? 'chat',
      systemPrompt: spec.systemPrompt,
      toolAllowlist: [],
      memoryShape: { scratchpad: true, conversation: true, longTerm: false },
      createdAt: new Date().toISOString(),
    };
    await ensureUserAgentRegistered(storage, userAgentRecord);

    // Board + sample cards for one persona — used by the fresh-create path
    // AND by heal mode when an existing persona's board went missing (the
    // live "boards disappeared and re-seed didn't restore them" failure:
    // rows that predate the read-through-durability hardening kept their
    // roster entry but lost the board, and the old create-only seed could
    // never bring it back).
    const createBoardWithCards = async (rosterId: string): Promise<void> => {
      const board = await createBoard({
        tenantId,
        name: `${spec.persona}'s board`,
        rosterId,
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
    };

    const registerSchedule = async (rosterId: string, agentId: string, sched: SeedSchedule): Promise<void> => {
      const workflowId = workflowIds[sched.workflowIndex];
      if (!workflowId) return;
      await registerJob({
        jobId: `${rosterId}:${sched.slug}`,
        tenantId,
        cronExpr: sched.cronExpr,
        workflowId,
        rosterId,
        agentId,
        metadata: { label: sched.label },
      });
    };

    let entry = byPersona.get(spec.persona.toLowerCase());
    if (!entry) {
      // Create the roster entry, its board (4 demo lanes; To Do triggers the
      // first workflow), its sample cards, and its schedules. The AgentRef
      // points at the persona's chat-callable inventory agent (above), linking
      // the two projections of one persona — the roster portfolio owner and the
      // conversable agent. Runs still dispatch by workflowId, not this id.
      entry = await createRosterEntry({
        tenantId,
        persona: spec.persona,
        agentRef: { agentId: chatAgentId, version: '1.0.0' },
        workflows: workflowIds,
        label: spec.role,
        description: spec.description,
        autonomyLevel: spec.autonomyLevel,
      });
      created += 1;

      await createBoardWithCards(entry.rosterId);
      for (const sched of spec.schedules) {
        await registerSchedule(entry.rosterId, entry.agentRef.agentId, sched);
      }
    } else if (opts.heal) {
      // HEAL: restore what is structurally MISSING; never touch what exists.
      // A present-but-emptied board stays untouched (clearing cards is normal
      // usage); a present schedule keeps any user-tweaked cron.
      if (!boardByRoster.has(entry.rosterId)) {
        await createBoardWithCards(entry.rosterId);
        healedBoards += 1;
      }
      for (const sched of spec.schedules) {
        if (await getJob(`${entry.rosterId}:${sched.slug}`)) continue;
        await registerSchedule(entry.rosterId, entry.agentRef.agentId, sched);
        healedSchedules += 1;
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
  // a user's hand-built chart on a no-op re-seed. Heal mode additionally
  // rebuilds it when NO chart exists at all (nothing to clobber).
  let healedChart = false;
  if (opts.heal && created === 0) {
    healedChart = (await getChart(tenantId)) === null;
  }
  if (created > 0 || healedChart) {
    const orgResult = await putChart({ tenantId, departments, members });
    if ('error' in orgResult) {
      // Non-fatal: the roster + boards seeded fine; only the org-chart failed.
      log.warn('demo_seed_orgchart_failed', { tenantId, error: orgResult.error.code });
    }
  }

  if (healedBoards > 0 || healedSchedules > 0 || healedChart) {
    log.info('demo_seed_healed', { tenantId, healedBoards, healedSchedules, healedChart });
  }
  log.info('demo_seed_complete', { tenantId, created, total: SEED_AGENTS.length });
  return {
    seeded: created > 0, agents: SEED_AGENTS.length,
    ...(opts.heal ? { healed: { boards: healedBoards, schedules: healedSchedules, orgChart: healedChart } } : {}),
  };
}
