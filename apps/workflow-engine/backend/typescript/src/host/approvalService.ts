/**
 * Pending-approval queue — host extension (sample-grade, non-normative).
 *
 * The reference implementation of the "agents propose, humans dispose" gate.
 * When a roster member runs at `autonomyLevel: 'review'` (host/rosterService.ts)
 * its heartbeat does NOT start the picked run; it queues a PendingApproval here
 * describing the proposed action (which workflow, on which board card). A human
 * reviews the proposal in the approvals inbox and either:
 *   - CLAIMS it — an affirmative sign-off that starts the proposed run, OR
 *   - REJECTS it — the proposal is dismissed and the card stays in To Do.
 *
 * This is a PRE-EXECUTION gate, deliberately distinct from the normative
 * `interrupt` kind (interrupt.md), which suspends a run that is already
 * in flight. The propose moment in this sample is the heartbeat's pick
 * decision — before any run exists — so a lightweight durable queue models it
 * more honestly than forcing every demo workflow to carry an approval node.
 *
 * Read-through, per-entity durable store (host/hostExtPersistence.ts): safe
 * across instances + restart-durable, like the roster/kanban surfaces.
 */

import { randomUUID } from 'node:crypto';
import { DurableCollection } from './hostExtPersistence.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** A proposed-but-unstarted action awaiting human sign-off. */
export interface PendingApproval {
  /** `appr:<uuid>`. */
  approvalId: string;
  tenantId: string;
  /** The roster member that proposed the action. */
  rosterId: string;
  persona: string;
  /** The workflow the member proposes to run. */
  workflowId: string;
  /** The board card the proposal originated from (the "cited source"). */
  boardId?: string;
  cardId?: string;
  cardTitle?: string;
  /** Human-readable one-liner, e.g. "Run intake-triage on 'New family: Garcia'". */
  proposal: string;
  status: ApprovalStatus;
  createdAt: string;
  /** Set when claimed or rejected. */
  resolvedAt?: string;
  /** The run a CLAIM started (absent until claimed). */
  runId?: string;
  /** Optional reviewer note captured at claim/reject time. */
  note?: string;
}

const approvals = new DurableCollection<PendingApproval>('approval', (a) => a.approvalId);

function nowIso(): string {
  return new Date().toISOString();
}

export async function createApproval(input: {
  tenantId: string;
  rosterId: string;
  persona: string;
  workflowId: string;
  boardId?: string;
  cardId?: string;
  cardTitle?: string;
  proposal: string;
}): Promise<PendingApproval> {
  const approval: PendingApproval = {
    approvalId: `appr:${randomUUID()}`,
    tenantId: input.tenantId,
    rosterId: input.rosterId,
    persona: input.persona,
    workflowId: input.workflowId,
    boardId: input.boardId,
    cardId: input.cardId,
    cardTitle: input.cardTitle,
    proposal: input.proposal,
    status: 'pending',
    createdAt: nowIso(),
  };
  await approvals.put(approval);
  return approval;
}

export async function getApproval(approvalId: string): Promise<PendingApproval | null> {
  return approvals.get(approvalId);
}

/** Tenant-scoped list, newest first; optionally filtered by status. */
export async function listApprovals(tenantId: string, status?: ApprovalStatus): Promise<PendingApproval[]> {
  return (await approvals.list())
    .filter((a) => a.tenantId === tenantId && (status ? a.status === status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** True when this card already has a pending approval — used by the heartbeat
 *  to avoid re-proposing the same card on every poll. */
export async function hasPendingApprovalForCard(tenantId: string, cardId: string): Promise<boolean> {
  return (await approvals.list()).some(
    (a) => a.tenantId === tenantId && a.status === 'pending' && a.cardId === cardId,
  );
}

/** Resolve an approval (claim → approved+runId, reject → rejected). Idempotent
 *  guard: only a `pending` approval can be resolved. Returns null if missing,
 *  or the unchanged entry if it was already resolved. */
export async function resolveApproval(
  approvalId: string,
  outcome: { status: 'approved' | 'rejected'; runId?: string; note?: string },
): Promise<PendingApproval | null> {
  const approval = await approvals.get(approvalId);
  if (!approval) return null;
  if (approval.status !== 'pending') return approval;
  approval.status = outcome.status;
  approval.resolvedAt = nowIso();
  if (outcome.runId) approval.runId = outcome.runId;
  if (outcome.note !== undefined) approval.note = outcome.note;
  await approvals.put(approval);
  return approval;
}

/** Test-only: drop all approvals. */
export async function __resetApprovalStore(): Promise<void> {
  await approvals.__clear();
}
