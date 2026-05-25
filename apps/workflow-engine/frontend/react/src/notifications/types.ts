/**
 * Notification types — mirrors the BE wire shape from
 * `apps/workflow-engine/backend/typescript/src/types.ts`.
 *
 * Wire shape is open (BE accepts any dotted-namespace string), but the
 * FE renders unknown types via the fallback icon + color so old clients
 * forward-compat with new BE-emitted types without a rebuild.
 */

export type NotificationType =
  | 'workflow.approval_needed'
  | 'workflow.input_needed'
  | 'workflow.failed'
  | 'workflow.completed'
  | 'system.alert'
  | string;

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationStatus = 'unread' | 'read' | 'archived';

export interface Notification {
  notificationId: string;
  type: NotificationType;
  priority: NotificationPriority;
  status: NotificationStatus;
  title: string;
  message: string;
  runId?: string;
  workflowId?: string;
  nodeId?: string;
  interruptId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
}

/** Types that mean "the user needs to act before the workflow advances."
 *  The /inbox page filters to this set; the bell panel shows everything. */
export const ACTION_NEEDED_TYPES = new Set<NotificationType>([
  'workflow.approval_needed',
  'workflow.input_needed',
]);

export function isActionNeeded(n: Notification): boolean {
  return ACTION_NEEDED_TYPES.has(n.type);
}
