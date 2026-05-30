/**
 * Kanban boards — host-extension routes (sample-grade, non-normative).
 *
 * Surface under `/v1/host/sample/kanban/*`:
 *   GET    /boards                       list the caller's boards
 *   POST   /boards                       create a board (default To Do/Doing/Done lanes)
 *   GET    /boards/:boardId              board + its cards
 *   DELETE /boards/:boardId              delete a board (cascades cards)
 *   POST   /boards/:boardId/cards        create a card in a column
 *   PATCH  /cards/:cardId                update a card; a `columnId` change MOVES it,
 *                                        and a move INTO a trigger column starts a run
 *   DELETE /cards/:cardId                delete a card
 *
 * The card→run trigger is the "named workflow agents" demo (RFCS/0086 §D):
 * when a card lands in a column that names a workflow (or the card carries
 * its own `workflowId`), the host starts a normal run for it — reusing the
 * exact `POST /v1/runs` recipe (workflowCatalog.getWorkflow → insertRun →
 * executeRun) so replay/fork/observability are inherited. The run records
 * a `kanban` attribution block in its metadata + emits a content-free
 * `kanban.card.moved` event on its stream (the proto-`roster.run.initiated`
 * attribution RFC 0086 §C standardizes). Tenant-scoped per board ownership
 * (the RFC 0074 carry-forward): a caller only sees + mutates its own boards.
 *
 * @see src/host/kanbanService.ts — the process-local store + pure move logic
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md §C/§D/§E
 */

import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { OpenwopError } from '../types.js';
import type { RunRecord } from '../types.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Storage } from '../storage/storage.js';
import { executeRun } from '../executor/executor.js';
import { getEventLog } from '../executor/eventLog.js';
import { createLogger } from '../observability/logger.js';
import {
  createBoard,
  createCard,
  deleteBoard,
  deleteCard,
  getBoard,
  getCard,
  listBoards,
  listCards,
  moveCard,
  setCardLastRun,
  updateCardFields,
  type KanbanTriggerDirective,
} from '../host/kanbanService.js';

const log = createLogger('routes.kanban');

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

/** Resolve the trigger's workflow, create + dispatch a run, and emit the
 *  attribution event. Returns the new runId, or null if the workflow is
 *  unknown (the move still succeeds — a dangling trigger is logged, not
 *  fatal, mirroring how a misconfigured schedule node is non-fatal). */
async function startKanbanRun(
  deps: Deps,
  tenantId: string,
  trigger: KanbanTriggerDirective,
): Promise<string | null> {
  const { storage, hostSuite } = deps;
  const wf = await hostSuite.workflowCatalog.getWorkflow(trigger.workflowId);
  if (!wf) {
    log.warn('kanban_trigger_workflow_not_found', {
      workflowId: trigger.workflowId,
      boardId: trigger.boardId,
      cardId: trigger.cardId,
    });
    return null;
  }

  const runId = randomUUID();
  const now = new Date().toISOString();
  const run: RunRecord = {
    runId,
    workflowId: trigger.workflowId,
    tenantId,
    status: 'pending',
    inputs: null,
    // Attribution block — the proto-`roster.run.initiated` payload
    // (RFC 0086 §C). Content-free: ids + column names only.
    metadata: {
      kanban: {
        boardId: trigger.boardId,
        cardId: trigger.cardId,
        fromColumnId: trigger.fromColumnId,
        toColumnId: trigger.toColumnId,
      },
    },
    configurable: {},
    createdAt: now,
    updatedAt: now,
  };
  await storage.insertRun(run);

  // Content-free attribution event on the new run's stream. Mirrors the
  // RFC 0086 `roster.run.initiated` shape (ids only — no card body).
  await getEventLog().append({
    runId,
    type: 'kanban.card.moved',
    payload: {
      boardId: trigger.boardId,
      cardId: trigger.cardId,
      fromColumnId: trigger.fromColumnId,
      toColumnId: trigger.toColumnId,
      workflowId: trigger.workflowId,
    },
  });

  // Dispatch inline (sample single-instance) — same posture as POST /v1/runs.
  setImmediate(() => {
    executeRun(storage, run, wf.definition, {
      policyResolver: hostSuite.providerPolicyResolver,
    }).catch((err) => {
      log.error('kanban_trigger_dispatch_failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  return runId;
}

export function registerKanbanRoutes(app: Express, deps: Deps): void {
  // --- boards ---

  app.get('/v1/host/sample/kanban/boards', (req, res) => {
    res.json({ boards: listBoards(tenantOf(req)) });
  });

  app.post('/v1/host/sample/kanban/boards', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        name?: unknown;
        columns?: unknown;
        triggerWorkflowId?: unknown;
      };
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw new OpenwopError('validation_error', 'Field `name` is required and MUST be a non-empty string.', 400, {
          field: 'name',
        });
      }
      if (body.triggerWorkflowId !== undefined && typeof body.triggerWorkflowId !== 'string') {
        throw new OpenwopError('validation_error', 'Field `triggerWorkflowId` MUST be a string when present.', 400, {
          field: 'triggerWorkflowId',
        });
      }
      const board = createBoard({
        tenantId: tenantOf(req),
        name: body.name,
        triggerWorkflowId: typeof body.triggerWorkflowId === 'string' ? body.triggerWorkflowId : undefined,
        columns: Array.isArray(body.columns) ? (body.columns as never) : undefined,
      });
      res.status(201).json(board);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/kanban/boards/:boardId', (req, res, next) => {
    try {
      const board = getBoard(req.params.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Board not found.', 404, { boardId: req.params.boardId });
      }
      res.json({ board, cards: listCards(board.id) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/kanban/boards/:boardId', (req, res, next) => {
    try {
      const board = getBoard(req.params.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Board not found.', 404, { boardId: req.params.boardId });
      }
      deleteBoard(board.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // --- cards ---

  app.post('/v1/host/sample/kanban/boards/:boardId/cards', (req, res, next) => {
    try {
      const board = getBoard(req.params.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Board not found.', 404, { boardId: req.params.boardId });
      }
      const body = (req.body ?? {}) as {
        title?: unknown;
        columnId?: unknown;
        description?: unknown;
        workflowId?: unknown;
      };
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        throw new OpenwopError('validation_error', 'Field `title` is required and MUST be a non-empty string.', 400, {
          field: 'title',
        });
      }
      const columnId = typeof body.columnId === 'string' ? body.columnId : board.columns[0]?.id;
      if (!columnId || !board.columns.some((c) => c.id === columnId)) {
        throw new OpenwopError('validation_error', 'Field `columnId` MUST name a column on this board.', 400, {
          field: 'columnId',
        });
      }
      const card = createCard({
        boardId: board.id,
        columnId,
        title: body.title,
        description: typeof body.description === 'string' ? body.description : undefined,
        workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      });
      res.status(201).json(card);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/kanban/cards/:cardId', async (req, res, next) => {
    try {
      const cardId = req.params.cardId;
      const existing = getCard(cardId);
      if (!existing) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId });
      }
      const board = getBoard(existing.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId });
      }
      const body = (req.body ?? {}) as {
        title?: unknown;
        description?: unknown;
        workflowId?: unknown;
        columnId?: unknown;
      };

      // Field updates first (title/description/workflowId).
      updateCardFields(cardId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      });

      // A columnId change is a move — and a move into a trigger column
      // starts a run.
      let triggeredRunId: string | null = null;
      if (typeof body.columnId === 'string' && body.columnId !== existing.columnId) {
        if (!board.columns.some((c) => c.id === body.columnId)) {
          throw new OpenwopError('validation_error', 'Field `columnId` MUST name a column on this board.', 400, {
            field: 'columnId',
          });
        }
        const moved = moveCard(cardId, body.columnId);
        if (moved?.trigger) {
          triggeredRunId = await startKanbanRun(deps, tenantOf(req), moved.trigger);
          if (triggeredRunId) setCardLastRun(cardId, triggeredRunId);
        }
      }

      const card = getCard(cardId);
      res.json({ card, triggeredRunId });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/kanban/cards/:cardId', (req, res, next) => {
    try {
      const card = getCard(req.params.cardId);
      if (!card) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId: req.params.cardId });
      }
      const board = getBoard(card.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId: req.params.cardId });
      }
      deleteCard(card.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
