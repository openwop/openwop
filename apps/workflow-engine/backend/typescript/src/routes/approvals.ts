/**
 * Approval inbox — host-extension routes (sample-grade, non-normative).
 *
 * The human side of the "agents propose, humans dispose" gate. A review-mode
 * roster member's heartbeat queues a PendingApproval (host/approvalService.ts)
 * instead of starting the run; these routes let a human resolve it:
 *
 *   GET  /v1/host/sample/approvals[?status=pending]   — the queue
 *   POST /v1/host/sample/approvals/{id}/claim          — affirmative sign-off:
 *                                                        starts the proposed run
 *   POST /v1/host/sample/approvals/{id}/reject         — dismiss the proposal
 *
 * A CLAIM is the affirmative act — it starts the proposed run (via the shared
 * runStarter, so replay/fork/observability are inherited) and moves the card to
 * Working. A REJECT dismisses the proposal and parks the card in the board's
 * terminal column so the heartbeat won't re-propose it.
 *
 * @see src/host/approvalService.ts — the durable queue
 * @see src/routes/agentOps.ts — where review-mode proposals are created
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Storage } from '../storage/storage.js';
import { getRosterEntry } from '../host/rosterService.js';
import { getBoard, moveCard, setCardLastRun, notifyBoardChanged } from '../host/kanbanService.js';
import { startWorkflowRun } from '../host/runStarter.js';
import { getApproval, listApprovals, resolveApproval, attachRunId, type ApprovalStatus } from '../host/approvalService.js';

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

function noteOf(req: Request): string | undefined {
  const note = (req.body as { note?: unknown } | undefined)?.note;
  return typeof note === 'string' && note.trim().length > 0 ? note.trim() : undefined;
}

export function registerApprovalRoutes(app: Express, deps: Deps): void {
  // The queue. `?status=pending|approved|rejected` filters; default = all.
  app.get('/v1/host/sample/approvals', async (req, res, next) => {
    try {
      const raw = String(req.query.status ?? '');
      const status: ApprovalStatus | undefined =
        raw === 'pending' || raw === 'approved' || raw === 'rejected' ? raw : undefined;
      const items = await listApprovals(tenantOf(req), status);
      res.status(200).json({ items });
    } catch (err) {
      next(err);
    }
  });

  // Claim — the affirmative sign-off that starts the proposed run.
  app.post('/v1/host/sample/approvals/:approvalId/claim', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const approval = await getApproval(req.params.approvalId);
      if (!approval || approval.tenantId !== tenantId) {
        throw new OpenwopError('not_found', 'Approval not found.', 404, { approvalId: req.params.approvalId });
      }
      if (approval.status !== 'pending') {
        throw new OpenwopError('conflict', `Approval already ${approval.status}.`, 409, { status: approval.status });
      }
      // Confirm the proposing member still exists before acting.
      const entry = await getRosterEntry(approval.rosterId);
      if (!entry || entry.tenantId !== tenantId) {
        throw new OpenwopError('not_found', 'Proposing agent no longer exists.', 404, { rosterId: approval.rosterId });
      }
      // Pre-resolve the proposed workflow BEFORE locking, so a vanished
      // workflow fails cleanly (422) instead of leaving an approved-but-unrun
      // approval. 422 (not 404): the request is well-formed, but the proposal
      // it references can no longer be acted on.
      const wf = await deps.hostSuite.workflowCatalog.getWorkflow(approval.workflowId);
      if (!wf) {
        throw new OpenwopError('workflow_not_found', 'Proposed workflow no longer resolves.', 422, {
          workflowId: approval.workflowId,
        });
      }

      // Resolve-before-dispatch: flip pending→approved FIRST; `changed` is the
      // lock. Only the winning claim dispatches — a concurrent claim sees
      // changed:false and 409s, so we never start two runs for one proposal.
      const lock = await resolveApproval(approval.approvalId, { status: 'approved', note: noteOf(req) });
      if (!lock) {
        throw new OpenwopError('not_found', 'Approval not found.', 404, { approvalId: approval.approvalId });
      }
      if (!lock.changed) {
        throw new OpenwopError('conflict', `Approval already ${lock.approval.status}.`, 409, { status: lock.approval.status });
      }

      const runId = await startWorkflowRun(deps, {
        tenantId,
        workflowId: approval.workflowId,
        metadata: {
          // `approval` is the attribution block — the activity feed reads it so
          // a claimed run reads as "ran an approved proposal", not a heartbeat
          // pick-up.
          approval: {
            rosterId: entry.rosterId,
            persona: entry.persona,
            agentId: entry.agentRef.agentId,
            boardId: approval.boardId,
            cardId: approval.cardId,
            approvalId: approval.approvalId,
            source: 'approval',
          },
        },
      });
      // Pre-checked above, so a null here is a rare race (workflow removed
      // between check and dispatch); surface it rather than silently drop.
      if (!runId) {
        throw new OpenwopError('workflow_not_found', 'Proposed workflow no longer resolves.', 422, {
          workflowId: approval.workflowId,
        });
      }
      await attachRunId(approval.approvalId, runId);

      // Best-effort: move the picked card to Working (the run has started).
      if (approval.boardId && approval.cardId) {
        await setCardLastRun(approval.cardId, runId);
        const board = await getBoard(approval.boardId);
        const working = board?.columns.find((c) => c.id === 'working' || c.name.toLowerCase() === 'working');
        if (working) await moveCard(approval.cardId, working.id);
        notifyBoardChanged(approval.boardId);
      }

      res.status(200).json({ approvalId: approval.approvalId, status: 'approved', runId });
    } catch (err) {
      next(err);
    }
  });

  // Reject — dismiss the proposal; park the card in the terminal column so the
  // heartbeat won't re-propose it on the next "Check now".
  app.post('/v1/host/sample/approvals/:approvalId/reject', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const approval = await getApproval(req.params.approvalId);
      if (!approval || approval.tenantId !== tenantId) {
        throw new OpenwopError('not_found', 'Approval not found.', 404, { approvalId: req.params.approvalId });
      }
      if (approval.status !== 'pending') {
        throw new OpenwopError('conflict', `Approval already ${approval.status}.`, 409, { status: approval.status });
      }

      // Park the card terminally (best-effort) so it leaves the To Do pick path.
      if (approval.boardId && approval.cardId) {
        const board = await getBoard(approval.boardId);
        const terminal = board?.columns[board.columns.length - 1];
        if (terminal) await moveCard(approval.cardId, terminal.id);
        notifyBoardChanged(approval.boardId);
      }

      const resolved = await resolveApproval(approval.approvalId, { status: 'rejected', note: noteOf(req) });
      if (!resolved?.changed) {
        throw new OpenwopError('conflict', 'Approval already resolved.', 409, { approvalId: approval.approvalId });
      }
      res.status(200).json({ approvalId: approval.approvalId, status: 'rejected', approval: resolved.approval });
    } catch (err) {
      next(err);
    }
  });
}
