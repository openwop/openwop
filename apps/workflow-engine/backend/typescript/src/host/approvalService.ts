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

// Per-approval in-process serialization. The durable store has no
// compare-and-swap, so two concurrent resolves could each read `pending` before
// either writes. Chaining each key's work serializes resolves within one
// process → exactly one winner. (Cross-INSTANCE races still need the
// conditional-write a production host provides; documented on resolveApproval.)
const resolveChains = new Map<string, Promise<unknown>>();
function withApprovalLock<T>(approvalId: string, fn: () => Promise<T>): Promise<T> {
  const prior = resolveChains.get(approvalId) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  resolveChains.set(approvalId, tail);
  // Drop the entry once this is the last queued work for the key (bounds the map).
  void tail.then(() => {
    if (resolveChains.get(approvalId) === tail) resolveChains.delete(approvalId);
  });
  return run;
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

/** Resolve an approval (claim → approved, reject → rejected). The `pending`
 *  guard is the lock: `changed` is true only for the call that performed the
 *  pending→resolved transition, so a caller can gate a side effect on it (e.g.
 *  only the winning claim dispatches the run). Returns null if missing.
 *
 *  The host-ext store has no compare-and-swap, so this is not a hard
 *  cross-instance lock — there is a sub-millisecond window between the read and
 *  the write. Resolve-before-dispatch (routes/approvals.ts) shrinks the
 *  double-dispatch window to that single get→put, sufficient for the sample's
 *  single-actor demo posture; a production host backs this with a conditional
 *  write. */
export function resolveApproval(
  approvalId: string,
  outcome: { status: 'approved' | 'rejected'; runId?: string; note?: string },
): Promise<{ approval: PendingApproval; changed: boolean } | null> {
  return withApprovalLock(approvalId, async () => {
    const approval = await approvals.get(approvalId);
    if (!approval) return null;
    if (approval.status !== 'pending') return { approval, changed: false };
    approval.status = outcome.status;
    approval.resolvedAt = nowIso();
    if (outcome.runId) approval.runId = outcome.runId;
    if (outcome.note !== undefined) approval.note = outcome.note;
    await approvals.put(approval);
    // Bound the store: resolved rows accumulate forever otherwise, growing the
    // per-heartbeat scan. Prune the tenant's oldest resolved entries past the cap.
    await pruneResolved(approval.tenantId);
    return { approval, changed: true };
  });
}

/** Attach the started run to an already-approved approval (post-dispatch). */
export async function attachRunId(approvalId: string, runId: string): Promise<void> {
  const approval = await approvals.get(approvalId);
  if (!approval) return;
  approval.runId = runId;
  await approvals.put(approval);
}

const RESOLVED_RETENTION = 100;

/** Keep only the most-recent `keep` resolved approvals for a tenant; delete the
 *  rest. Pending approvals are never pruned. */
async function pruneResolved(tenantId: string, keep = RESOLVED_RETENTION): Promise<void> {
  const resolved = (await approvals.list())
    .filter((a) => a.tenantId === tenantId && a.status !== 'pending')
    .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt));
  for (const stale of resolved.slice(keep)) {
    await approvals.delete(stale.approvalId);
  }
}

/** Test-only: drop all approvals. */
export async function __resetApprovalStore(): Promise<void> {
  await approvals.__clear();
}
