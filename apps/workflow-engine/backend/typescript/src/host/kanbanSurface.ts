/**
 * `ctx.kanban` host surface (RFC `host.kanban`, `spec/v1/host-capabilities.md`
 * §host.kanban) — a REAL bridge from the `vendor.myndhyve.kanban` pack nodes to
 * the demo app's durable kanban store (`kanbanService.ts`), i.e. the SAME boards
 * and cards the builder UI shows. A board created by a workflow node appears in
 * the UI, and vice-versa.
 *
 * Methods map 1:1 onto the pack's call sites:
 *   boardCreate / boardReview / taskAssign / taskGet / taskCreateBatch /
 *   timelinePlan / automateRules / resourceMonitor / getReadyTasks / moveTask.
 *
 * Genuinely computed (not stubbed): boardReview aggregates real column counts +
 * at-risk cards; timelinePlan runs a dependency-aware working-day scheduler with
 * a real critical path; resourceMonitor tallies live per-assignee load + WIP
 * breaches + overdue cards. Create operations are idempotent by `idempotencyKey`
 * within a tenant. automateRules persist per board (in-process; the rest of the
 * store is durable — noted on the surface).
 */

import { createLogger } from '../observability/logger.js';
import type { BundleScope } from './inMemorySurfaces.js';
import {
  createBoard, getBoard, listCards, getCard, createCard, updateCardFields, moveCard,
  type KanbanCard,
} from './kanbanService.js';

const log = createLogger('host.kanban');

type Json = Record<string, unknown>;

interface AutomationRule { trigger: string; action: string; config?: Json }

// Per-(tenant) idempotency cache for create/assign ops + per-board automation
// rules. Module-scoped so re-running a node with the same idempotencyKey is a
// no-op, matching the durable store's create semantics.
const _idem = new Map<string, unknown>();
const _rules = new Map<string, AutomationRule[]>();

const DONE_HINTS = ['done', 'complete', 'completed', 'shipped', 'closed', 'archived'];
const isDoneColumn = (columnId: string): boolean => DONE_HINTS.some((h) => columnId.toLowerCase().includes(h));

/** Advance `from` by `n` working days, skipping weekends when the week is < 7
 *  working days. Returns a new Date. */
function addWorkingDays(from: Date, n: number, workingDaysPerWeek: number): Date {
  const d = new Date(from.getTime());
  if (workingDaysPerWeek >= 7) { d.setDate(d.getDate() + n); return d; }
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

export interface KanbanSurface {
  boardCreate(args: { name: string; columns: Array<{ id: string; label: string; wipLimit?: number }>; description?: string; projectId?: string; idempotencyKey: string }): Promise<{ boardId: string; createdAt: string }>;
  boardReview(args: { boardId: string; includeArchived?: boolean; atRiskThresholdDays?: number }): Promise<unknown>;
  taskAssign(args: { taskId: string; assigneeId: string; notifyAssignee?: boolean; comment?: string; idempotencyKey: string }): Promise<unknown>;
  taskGet(taskId: string): Promise<unknown>;
  taskCreateBatch(args: { parentTaskId: string; subtasks: Array<{ title: string; description?: string; estimateHours?: number }>; idempotencyKey: string }): Promise<{ subtaskIds: string[] }>;
  timelinePlan(args: { boardId: string; startDate?: string; workingHoursPerDay?: number; workingDaysPerWeek?: number; scheduler?: string; idempotencyKey: string }): Promise<unknown>;
  automateRules(args: { boardId: string; rules: AutomationRule[]; replaceExisting?: boolean; idempotencyKey: string }): Promise<unknown>;
  resourceMonitor(args: { boardId: string; maxConcurrentPerAssignee?: number; includeAgents?: boolean }): Promise<unknown>;
  getReadyTasks(boardId: string): Promise<Array<Json>>;
  moveTask(taskId: string, toColumn: string): Promise<void>;
}

export function createKanbanSurface(scope: BundleScope): KanbanSurface {
  const tenantId = scope.tenantId;
  const idemKey = (key: string): string => `${tenantId}::${key}`;

  return {
    async boardCreate({ name, columns, description, idempotencyKey }) {
      const ck = idemKey(`board:${idempotencyKey}`);
      const cached = _idem.get(ck) as { boardId: string; createdAt: string } | undefined;
      if (cached) return cached;
      const board = await createBoard({
        tenantId,
        name,
        columns: (columns ?? []).map((c) => ({ id: c.id, name: c.label })),
      });
      if (description) log.info('board created with description (stored as name context only)', { boardId: board.id });
      const out = { boardId: board.id, createdAt: board.createdAt };
      _idem.set(ck, out);
      return out;
    },

    async boardReview({ boardId, atRiskThresholdDays = 3 }) {
      const board = await getBoard(boardId);
      const cards = await listCards(boardId);
      const columnCounts: Record<string, number> = {};
      for (const col of board?.columns ?? []) columnCounts[col.id] = 0;
      for (const c of cards) columnCounts[c.columnId] = (columnCounts[c.columnId] ?? 0) + 1;
      const horizon = Date.now() + atRiskThresholdDays * 86_400_000;
      const atRiskTasks = cards
        .filter((c) => c.dueAt && !isDoneColumn(c.columnId) && Date.parse(c.dueAt) <= horizon)
        .map((c) => ({ taskId: c.id, title: c.title, dueAt: c.dueAt, columnId: c.columnId }));
      return {
        ...(board?.name ? { boardName: board.name } : {}),
        totalTasks: cards.length,
        columnCounts,
        atRiskTasks,
        reviewedAt: new Date().toISOString(),
      };
    },

    async taskAssign({ taskId, assigneeId, comment, idempotencyKey }) {
      const ck = idemKey(`assign:${idempotencyKey}`);
      const cached = _idem.get(ck) as { previousAssigneeId?: string; assignedAt: string } | undefined;
      if (cached) return cached;
      const card = await getCard(taskId);
      const previousAssigneeId = card?.assigneeId;
      await updateCardFields(taskId, { assigneeId, ...(comment ? { assignmentReason: comment } : {}) });
      const out = { ...(previousAssigneeId ? { previousAssigneeId } : {}), assignedAt: new Date().toISOString() };
      _idem.set(ck, out);
      return out;
    },

    async taskGet(taskId) {
      return (await getCard(taskId)) ?? null;
    },

    async taskCreateBatch({ parentTaskId, subtasks, idempotencyKey }) {
      const ck = idemKey(`batch:${idempotencyKey}`);
      const cached = _idem.get(ck) as { subtaskIds: string[] } | undefined;
      if (cached) return cached;
      const parent = await getCard(parentTaskId);
      if (!parent) throw Object.assign(new Error(`parent task ${parentTaskId} not found`), { code: 'kanban_task_not_found' });
      const subtaskIds: string[] = [];
      for (const s of subtasks ?? []) {
        const card = await createCard({
          boardId: parent.boardId,
          columnId: parent.columnId,
          title: s.title,
          ...(s.description !== undefined ? { description: s.description } : {}),
          ...(s.estimateHours !== undefined ? { estimateHours: s.estimateHours } : {}),
          dependsOn: [parentTaskId],
          source: 'workflow',
        });
        subtaskIds.push(card.id);
      }
      const out = { subtaskIds };
      _idem.set(ck, out);
      return out;
    },

    async timelinePlan({ boardId, startDate, workingHoursPerDay = 8, workingDaysPerWeek = 5 }) {
      const cards = await listCards(boardId);
      const byId = new Map(cards.map((c) => [c.id, c]));
      const durationDays = (c: KanbanCard): number => Math.max(1, Math.ceil((c.estimateHours ?? workingHoursPerDay) / workingHoursPerDay));
      // Topological order over dependsOn (Kahn); cards not on this board are
      // treated as already satisfied. Cycles fall back to board order.
      const order: KanbanCard[] = [];
      const indeg = new Map<string, number>();
      for (const c of cards) indeg.set(c.id, (c.dependsOn ?? []).filter((d) => byId.has(d)).length);
      const ready = cards.filter((c) => (indeg.get(c.id) ?? 0) === 0);
      while (ready.length) {
        const c = ready.shift()!;
        order.push(c);
        for (const other of cards) {
          if ((other.dependsOn ?? []).includes(c.id)) {
            const n = (indeg.get(other.id) ?? 1) - 1;
            indeg.set(other.id, n);
            if (n === 0) ready.push(other);
          }
        }
      }
      if (order.length < cards.length) order.push(...cards.filter((c) => !order.includes(c)));

      const base = startDate ? new Date(startDate) : new Date();
      const startOffset = new Map<string, number>(); // working-day offset from base
      const schedule: Array<{ taskId: string; startAt: string; endAt: string }> = [];
      for (const c of order) {
        const depEnd = Math.max(0, ...(c.dependsOn ?? [])
          .filter((d) => byId.has(d))
          .map((d) => (startOffset.get(d) ?? 0) + durationDays(byId.get(d)!)));
        startOffset.set(c.id, depEnd);
        const startAt = addWorkingDays(base, depEnd, workingDaysPerWeek);
        const endAt = addWorkingDays(base, depEnd + durationDays(c), workingDaysPerWeek);
        schedule.push({ taskId: c.id, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      }
      // Critical path: walk back from the task with the latest finish.
      const finish = (id: string): number => (startOffset.get(id) ?? 0) + durationDays(byId.get(id)!);
      let endTask = order[0];
      for (const c of order) if (endTask && finish(c.id) > finish(endTask.id)) endTask = c;
      const criticalPath: string[] = [];
      let cur: KanbanCard | undefined = endTask;
      while (cur) {
        criticalPath.unshift(cur.id);
        const deps: string[] = (cur.dependsOn ?? []).filter((d) => byId.has(d));
        const next: KanbanCard | undefined = deps.length
          ? deps.map((d) => byId.get(d)!).sort((a, b) => finish(b.id) - finish(a.id))[0]
          : undefined;
        cur = next;
      }
      const projectEndDate = schedule.reduce<string | undefined>((max, s) => (!max || s.endAt > max ? s.endAt : max), undefined);
      return { schedule, criticalPath, ...(projectEndDate ? { projectEndDate } : {}) };
    },

    async automateRules({ boardId, rules, replaceExisting }) {
      const key = `${tenantId}::${boardId}`;
      const existing = _rules.get(key) ?? [];
      const next = replaceExisting ? [...(rules ?? [])] : [...existing, ...(rules ?? [])];
      _rules.set(key, next);
      return { activeRules: next.length, added: (rules ?? []).length, appliedAt: new Date().toISOString() };
    },

    async resourceMonitor({ boardId, maxConcurrentPerAssignee = 5 }) {
      const cards = await listCards(boardId);
      const open = cards.filter((c) => !isDoneColumn(c.columnId));
      const assigneeLoad: Record<string, number> = {};
      for (const c of open) if (c.assigneeId) assigneeLoad[c.assigneeId] = (assigneeLoad[c.assigneeId] ?? 0) + 1;
      const wipBreaches = Object.entries(assigneeLoad)
        .filter(([, n]) => n > maxConcurrentPerAssignee)
        .map(([assigneeId, current]) => ({ assigneeId, current, max: maxConcurrentPerAssignee }));
      const now = Date.now();
      const overdueTasks = open
        .filter((c) => c.dueAt && Date.parse(c.dueAt) < now)
        .map((c) => ({ taskId: c.id, dueAt: c.dueAt! }));
      return { assigneeLoad, wipBreaches, overdueTasks, monitoredAt: new Date().toISOString() };
    },

    async getReadyTasks(boardId) {
      const cards = await listCards(boardId);
      const done = new Set(cards.filter((c) => isDoneColumn(c.columnId)).map((c) => c.id));
      return cards
        .filter((c) => !isDoneColumn(c.columnId) && (c.dependsOn ?? []).every((d) => done.has(d) || !cards.some((x) => x.id === d)))
        .map((c) => ({ id: c.id, title: c.title, columnId: c.columnId, ...(c.assigneeId ? { assigneeId: c.assigneeId } : {}) }));
    },

    async moveTask(taskId, toColumn) {
      const card = await getCard(taskId);
      if (!card) throw Object.assign(new Error(`task ${taskId} not found`), { code: 'kanban_task_not_found' });
      const board = await getBoard(card.boardId);
      // Resolve `toColumn` against the board by id, then by case-insensitive name.
      const col = board?.columns.find((c) => c.id === toColumn)
        ?? board?.columns.find((c) => c.name.toLowerCase() === String(toColumn).toLowerCase());
      const targetId = col?.id ?? toColumn;
      await moveCard(taskId, targetId);
    },
  };
}

// Re-exported so a future durable-rules migration has a single touch-point.
export function _clearKanbanSurfaceCachesForTest(): void {
  _idem.clear();
  _rules.clear();
}
