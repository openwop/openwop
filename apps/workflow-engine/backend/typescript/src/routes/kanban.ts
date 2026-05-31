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
  notifyBoardChanged,
  setCardLastRun,
  subscribeBoardChanges,
  updateCardFields,
  type KanbanTriggerDirective,
} from '../host/kanbanService.js';
import { getRosterEntry } from '../host/rosterService.js';
import { deliver, makeDedupKey, registerSubscription } from '../host/triggerBridgeService.js';

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
): Promise<{ runId: string; attribution: Record<string, unknown> } | null> {
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

  // RFC 0086 §C attribution: if the board is owned by a roster member,
  // attribute the run to that named agent (rosterId + persona + the
  // manifest agentId it instantiates). Content-free — ids/persona only.
  const board = await getBoard(trigger.boardId);
  const roster = board?.rosterId ? await getRosterEntry(board.rosterId) : null;
  // RFC 0086 §A: a disabled roster member's portfolio triggers are inert.
  // When a board is bound to a member that is missing or `enabled: false`,
  // the card move does NOT start a run.
  if (board?.rosterId && (!roster || !roster.enabled)) {
    log.info('kanban_trigger_skipped_disabled_roster', {
      boardId: trigger.boardId,
      rosterId: board.rosterId,
      reason: roster ? 'disabled' : 'missing',
    });
    return null;
  }
  const attribution: Record<string, unknown> = {
    boardId: trigger.boardId,
    cardId: trigger.cardId,
    fromColumnId: trigger.fromColumnId,
    toColumnId: trigger.toColumnId,
    workflowId: trigger.workflowId,
  };
  if (roster) {
    attribution.rosterId = roster.rosterId;
    attribution.persona = roster.persona;
    attribution.agentId = roster.agentRef.agentId;
  }

  // RFC 0083: the card→run firing goes through a durable trigger subscription
  // (dedup → retry → dead-letter → causation), not a direct executeRun. One
  // `queue`-source subscription backs each board (§E: a vendor work surface
  // bridges as the closest source kind).
  const subscriptionId = `host:kanban:${trigger.boardId}`;
  await registerSubscription({ subscriptionId, tenantId, source: 'queue', label: `Kanban board ${trigger.boardId}` });
  const dedupKey = makeDedupKey(subscriptionId, trigger.cardId, trigger.toColumnId);
  attribution.triggerSource = 'queue';
  attribution.triggerSubscriptionId = subscriptionId;

  const result = await deliver({
    subscriptionId,
    dedupKey,
    fire: async (deliveryId) => {
      const runId = randomUUID();
      const now = new Date().toISOString();
      const run: RunRecord = {
        runId,
        workflowId: trigger.workflowId,
        tenantId,
        status: 'pending',
        inputs: null,
        // Attribution block — the proto-`roster.run.initiated` payload
        // (RFC 0086 §C). Content-free: ids + column names + persona only.
        metadata: { kanban: attribution },
        // RFC 0083 §C-3: the delivery id is the run's causationId so
        // /ancestry resolves delivery → run.
        causationId: deliveryId,
        configurable: {},
        createdAt: now,
        updatedAt: now,
      };
      await storage.insertRun(run);
      // Host-extension-namespaced attribution event (RFC 0086 §E).
      await getEventLog().append({ runId, type: 'host.kanban.card.moved', payload: attribution });
      // Dispatch inline (sample single-instance) — same posture as POST /v1/runs.
      setImmediate(() => {
        executeRun(storage, run, wf.definition, { policyResolver: hostSuite.providerPolicyResolver }).catch((err) => {
          log.error('kanban_trigger_dispatch_failed', { runId, error: err instanceof Error ? err.message : String(err) });
        });
      });
      return runId;
    },
  });

  if ((result.outcome === 'delivered' || result.outcome === 'deduped') && result.runId) {
    if (result.outcome === 'delivered') {
      // RFC 0083 §C: the content-free delivery event on the new run's stream
      // (subscription id + opaque dedup key + attempt + outcome + runId only).
      await getEventLog().append({
        runId: result.runId,
        type: 'trigger.delivery.attempted',
        payload: { subscriptionId, dedupKey, attempt: result.attempts, outcome: 'delivered', runId: result.runId },
      });
    }
    // `deduped` returns the prior run (effectively-once) — no new run/event.
    return { runId: result.runId, attribution };
  }
  // `skipped` (paused subscription) or `dead-lettered` (retries exhausted, no run).
  return null;
}

export function registerKanbanRoutes(app: Express, deps: Deps): void {
  // Live board refresh (SSE): clients subscribe to a board's change stream
  // and refetch on `board.changed`. Tenant-scoped at subscribe time. A plain
  // text/event-stream with heartbeats; the payload is just the boardId — the
  // client refetches GET /boards/:id (no card bodies on the wire here).
  app.get('/v1/host/sample/kanban/boards/:boardId/events', async (req, res, next) => {
    try {
      const board = await getBoard(req.params.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Board not found.', 404, { boardId: req.params.boardId });
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const unsubscribe = subscribeBoardChanges((changedBoardId) => {
        if (changedBoardId === board.id) {
          res.write(`event: board.changed\ndata: ${JSON.stringify({ boardId: board.id })}\n\n`);
        }
      });
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    } catch (err) {
      next(err);
    }
  });

  // --- boards ---

  app.get('/v1/host/sample/kanban/boards', async (req, res, next) => {
    try {
      res.json({ boards: await listBoards(tenantOf(req)) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/kanban/boards', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        name?: unknown;
        columns?: unknown;
        triggerWorkflowId?: unknown;
        rosterId?: unknown;
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
      // Optional RFCS/0086 roster binding: the named agent that owns this
      // board. When bound and no explicit trigger workflow is given, the
      // To Do column defaults to the member's first portfolio workflow —
      // "Sally's board fires Sally's workflow".
      let rosterId: string | undefined;
      let triggerWorkflowId = typeof body.triggerWorkflowId === 'string' ? body.triggerWorkflowId : undefined;
      if (body.rosterId !== undefined) {
        if (typeof body.rosterId !== 'string') {
          throw new OpenwopError('validation_error', 'Field `rosterId` MUST be a string when present.', 400, {
            field: 'rosterId',
          });
        }
        const entry = await getRosterEntry(body.rosterId);
        if (!entry || entry.tenantId !== tenantOf(req)) {
          throw new OpenwopError('validation_error', 'Field `rosterId` does not name a roster entry in this tenant.', 400, {
            field: 'rosterId',
          });
        }
        rosterId = entry.rosterId;
        if (!triggerWorkflowId && entry.workflows.length > 0) {
          triggerWorkflowId = entry.workflows[0];
        }
      }
      const board = await createBoard({
        tenantId: tenantOf(req),
        name: body.name,
        triggerWorkflowId,
        rosterId,
        columns: Array.isArray(body.columns) ? (body.columns as never) : undefined,
      });
      res.status(201).json(board);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/kanban/boards/:boardId', async (req, res, next) => {
    try {
      const board = await getBoard(req.params.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Board not found.', 404, { boardId: req.params.boardId });
      }
      res.json({ board, cards: await listCards(board.id) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/kanban/boards/:boardId', async (req, res, next) => {
    try {
      const board = await getBoard(req.params.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Board not found.', 404, { boardId: req.params.boardId });
      }
      await deleteBoard(board.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // --- cards ---

  app.post('/v1/host/sample/kanban/boards/:boardId/cards', async (req, res, next) => {
    try {
      const board = await getBoard(req.params.boardId);
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
      const card = await createCard({
        boardId: board.id,
        columnId,
        title: body.title,
        description: typeof body.description === 'string' ? body.description : undefined,
        workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      });
      notifyBoardChanged(board.id);
      res.status(201).json(card);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/kanban/cards/:cardId', async (req, res, next) => {
    try {
      const cardId = req.params.cardId;
      const existing = await getCard(cardId);
      if (!existing) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId });
      }
      const board = await getBoard(existing.boardId);
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
      await updateCardFields(cardId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      });

      // A columnId change is a move — and a move into a trigger column
      // starts a run.
      let triggeredRunId: string | null = null;
      let attribution: Record<string, unknown> | null = null;
      if (typeof body.columnId === 'string' && body.columnId !== existing.columnId) {
        if (!board.columns.some((c) => c.id === body.columnId)) {
          throw new OpenwopError('validation_error', 'Field `columnId` MUST name a column on this board.', 400, {
            field: 'columnId',
          });
        }
        const moved = await moveCard(cardId, body.columnId);
        if (moved?.trigger) {
          const started = await startKanbanRun(deps, tenantOf(req), moved.trigger);
          if (started) {
            triggeredRunId = started.runId;
            attribution = started.attribution;
            await setCardLastRun(cardId, started.runId);
          }
        }
      }

      const card = await getCard(cardId);
      notifyBoardChanged(board.id);
      res.json({ card, triggeredRunId, attribution });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/kanban/cards/:cardId', async (req, res, next) => {
    try {
      const card = await getCard(req.params.cardId);
      if (!card) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId: req.params.cardId });
      }
      const board = await getBoard(card.boardId);
      if (!board || board.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Card not found.', 404, { cardId: req.params.cardId });
      }
      await deleteCard(card.id);
      notifyBoardChanged(card.boardId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
