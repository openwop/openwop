/**
 * High-level notification emit helpers — called from the suspend
 * manager (when an interrupt opens) and the executor (when a run
 * fails). Centralizes the type → title/message/priority mapping so
 * the FE bell + panel get consistent shapes regardless of caller.
 *
 * Secret-safety: notification text MUST NOT carry raw provider error
 * strings (which can embed an API key in some upstream responses).
 * Callers pass the **already-classified** `userMessage` from
 * `observability/errorRecovery.ts` (operator-curated, redacted) or a
 * statically-known title; arbitrary metadata is run through
 * `stripSecretsFromPersisted` before persistence as defense-in-depth.
 *
 * Best-effort: the helpers swallow emission failures so an executor
 * doesn't lose data integrity if the notifications table is unreachable
 * (e.g., partial migration). The run-event log remains the source of
 * truth for replay; notifications are a derived, ephemeral surface.
 */

import type { InterruptRecord, NotificationRecord, RunRecord } from '../types.js';
import type { Storage } from '../storage/storage.js';
import { stripSecretsFromPersisted } from '../byok/ephemeralRunSecrets.js';
import { sanitizeFreeText } from '../byok/textRedaction.js';
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
    // Workflow names from `run.metadata` can themselves contain
    // user-supplied text — run through redaction. `workflowId` is
    // engine-controlled so it's safe.
    const workflowLabel = sanitizeForNotification(
      (run.metadata?.workflowName as string | undefined) || run.workflowId,
    );
    await getNotificationEmitter().emit({
      tenantId: run.tenantId,
      type: KIND_TYPE[interrupt.kind] ?? 'workflow.approval_needed',
      priority: interrupt.kind === 'approval' || interrupt.kind === 'cancellation' ? 'high' : 'normal',
      title,
      message: `${workflowLabel} is waiting at node "${sanitizeForNotification(interrupt.nodeId)}"`,
      runId: interrupt.runId,
      workflowId: run.workflowId,
      nodeId: interrupt.nodeId,
      interruptId: interrupt.interruptId,
      actionUrl: `/inbox`,
      metadata: stripSecretsFromPersisted({ kind: interrupt.kind }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Emit a "your run failed" notification.
 *
 * The caller MUST pass the classified `userMessage` from
 * `classifyDispatchError()` — the raw `error.message` can carry a
 * provider's verbatim response string, which sometimes embeds the
 * API key (some upstreams echo the rejected key back in 401 text).
 * `userMessage` is the operator-curated, redacted form documented in
 * `observability/errorRecovery.ts §"the ONLY string that should be
 * surfaced to a user-facing UI"`.
 */
export async function emitRunFailureNotification(
  storage: Storage,
  runId: string,
  error: { code: string; userMessage: string },
): Promise<void> {
  try {
    const run = await storage.getRun(runId);
    if (!run) return;
    const workflowLabel = sanitizeForNotification(
      (run.metadata?.workflowName as string | undefined) || run.workflowId,
    );
    await getNotificationEmitter().emit({
      tenantId: run.tenantId,
      type: 'workflow.failed',
      priority: 'high',
      title: 'Workflow failed',
      // userMessage is the curated, redacted form — safe to surface.
      message: `${workflowLabel}: ${truncate(error.userMessage, 240)}`,
      runId,
      workflowId: run.workflowId,
      actionUrl: `/runs/${runId}`,
      metadata: stripSecretsFromPersisted({ errorCode: error.code }),
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
    const workflowLabel = sanitizeForNotification(
      (run.metadata?.workflowName as string | undefined) || run.workflowId,
    );
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

// Notification text uses the shared `sanitizeFreeText` primitive from
// `byok/textRedaction.ts`. Aliased here for readability at call sites.
const sanitizeForNotification = sanitizeFreeText;

function truncate(s: string, max: number): string {
  const sanitized = sanitizeForNotification(s);
  return sanitized.length > max ? `${sanitized.slice(0, max - 1)}…` : sanitized;
}
