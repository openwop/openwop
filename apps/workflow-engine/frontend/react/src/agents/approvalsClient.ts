/**
 * Approval-inbox client — the "agents propose, humans dispose" queue.
 *
 *   GET  /v1/host/sample/approvals[?status=pending]   — the queue
 *   POST /v1/host/sample/approvals/{id}/claim          — sign off + start the run
 *   POST /v1/host/sample/approvals/{id}/reject         — dismiss the proposal
 *
 * Tenant scoping is the backend's job (caller's principal); the client never
 * sends a tenantId.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface PendingApproval {
  approvalId: string;
  rosterId: string;
  persona: string;
  workflowId: string;
  boardId?: string;
  cardId?: string;
  cardTitle?: string;
  proposal: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  runId?: string;
  note?: string;
}

const base = `${config.baseUrl}/v1/host/sample/approvals`;
const jsonHeaders = (): HeadersInit => authedHeaders({ 'content-type': 'application/json' });

export async function listApprovals(status?: ApprovalStatus): Promise<PendingApproval[]> {
  const url = status ? `${base}?status=${encodeURIComponent(status)}` : base;
  const res = await fetch(url, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`listApprovals returned ${res.status}`);
  return ((await res.json()) as { items: PendingApproval[] }).items;
}

/** Affirmative sign-off — starts the proposed run. Returns the new runId. */
export async function claimApproval(approvalId: string, note?: string): Promise<{ runId: string }> {
  const res = await fetch(`${base}/${encodeURIComponent(approvalId)}/claim`, fetchOpts({
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(note ? { note } : {}),
  }));
  if (!res.ok) throw new Error(`claimApproval returned ${res.status}`);
  return (await res.json()) as { runId: string };
}

/** Dismiss the proposal; the card is parked in the board's terminal column. */
export async function rejectApproval(approvalId: string, note?: string): Promise<void> {
  const res = await fetch(`${base}/${encodeURIComponent(approvalId)}/reject`, fetchOpts({
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(note ? { note } : {}),
  }));
  if (!res.ok) throw new Error(`rejectApproval returned ${res.status}`);
}
