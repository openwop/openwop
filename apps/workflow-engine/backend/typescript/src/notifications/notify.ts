/**
 * High-level notification emit helpers — called from the suspend
 * manager (when an interrupt opens) and the executor (when a run
 * fails). Centralizes the type → title/message/priority mapping so
 * the FE bell + panel get consistent shapes regardless of caller.
 *
 * Best-effort: the helpers swallow emission failures so an executor
 * doesn't lose data integrity if the notifications table is unreachable
 * (e.g., partial migration). The run-event log remains the source of
 * truth for replay; notifications are a derived, ephemeral surface.
 */

import type { InterruptRecord, NotificationRecord, RunRecord } from '../types.js';
import type { Storage } from '../storage/storage.js';
import { getNotificationEmitter } from './emitter.js';

const KIND_LABEL: Record<InterruptRecord['kind'], string> = {
  approval: 'Approval needed',
  clarification: 'Clarification needed',
  refinement: 'Refinement requested',
  cancellation: 'Cancellation confirmation needed',
  'external-event': 'Waiting on external event',
};

const KIND_TYPE: Record<InterruptRecord['kind'], NotificationRecord['type']> = {
  approval: 'workflow.approval_needed',
  clarification: 'workflow.input_needed',
  refinement: 'workflow.input_needed',
  cancellation: 'workflow.approval_needed',
  'external-event': 'workflow.input_needed',
};

export async function emitInterruptNotification(
  storage: Storage,
  interrupt: InterruptRecord,
): Promise<void> {
  try {
    const run = await storage.getRun(interrupt.runId);
    if (!run) return;
    const title = KIND_LABEL[interrupt.kind] ?? 'Action needed';
    const workflowLabel = (run.metadata?.workflowName as string | undefined) || run.workflowId;
    await getNotificationEmitter().emit({
      tenantId: run.tenantId,
      type: KIND_TYPE[interrupt.kind] ?? 'workflow.approval_needed',
      priority: interrupt.kind === 'approval' || interrupt.kind === 'cancellation' ? 'high' : 'normal',
      title,
      message: `${workflowLabel} is waiting at node "${interrupt.nodeId}"`,
      runId: interrupt.runId,
      workflowId: run.workflowId,
      nodeId: interrupt.nodeId,
      interruptId: interrupt.interruptId,
      actionUrl: `/inbox`,
      metadata: { kind: interrupt.kind },
    });
  } catch {
    /* best-effort */
  }
}

export async function emitRunFailureNotification(
  storage: Storage,
  runId: string,
  error: { code: string; message: string },
): Promise<void> {
  try {
    const run = await storage.getRun(runId);
    if (!run) return;
    const workflowLabel = (run.metadata?.workflowName as string | undefined) || run.workflowId;
    await getNotificationEmitter().emit({
      tenantId: run.tenantId,
      type: 'workflow.failed',
      priority: 'high',
      title: 'Workflow failed',
      message: `${workflowLabel}: ${truncate(error.message, 200)}`,
      runId,
      workflowId: run.workflowId,
      actionUrl: `/runs/${runId}`,
      metadata: { errorCode: error.code },
    });
  } catch {
    /* best-effort */
  }
}

export async function emitRunCompletedNotification(
  _storage: Storage,
  run: RunRecord,
): Promise<void> {
  try {
    const workflowLabel = (run.metadata?.workflowName as string | undefined) || run.workflowId;
    await getNotificationEmitter().emit({
      tenantId: run.tenantId,
      type: 'workflow.completed',
      priority: 'low',
      title: 'Workflow completed',
      message: `${workflowLabel} finished`,
      runId: run.runId,
      workflowId: run.workflowId,
      actionUrl: `/runs/${run.runId}`,
    });
  } catch {
    /* best-effort */
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
