/**
 * Notification emitter — process-local fanout of newly-inserted
 * notifications to SSE subscribers, plus a single chokepoint helper
 * (`emitNotification`) that the executor + suspend manager call when
 * an action-needed event happens.
 *
 * Two-step shape mirrors `executor/eventLog.ts`:
 *   1. caller hands a NotificationRecord (already shaped + tenanted)
 *   2. emitter inserts into Storage then fans out to any subscribers
 *
 * Subscribers receive only their own tenant's notifications. Filtering
 * happens in the route layer so the emitter stays storage-only and
 * doesn't need to know about principal/tenant context.
 *
 * Process-local only: in a multi-instance Cloud Run deployment, a
 * notification inserted on instance A will not push to a client SSE'd
 * to instance B. The client polls `GET /v1/notifications` periodically
 * (or on tab focus) to backfill — same pattern as the run-event SSE
 * uses against the same Cloud Run service.
 */

import { randomBytes } from 'node:crypto';
import type { Storage } from '../storage/storage.js';
import type { NotificationRecord } from '../types.js';
import { pushNotification } from './webPush.js';

let backend: Storage | null = null;
const subscribers = new Set<(n: NotificationRecord) => void>();

export function setNotificationBackend(storage: Storage): void {
  backend = storage;
}

export function getNotificationEmitter() {
  if (!backend) throw new Error('Notification backend not installed');
  const b = backend;
  return {
    async emit(input: Omit<NotificationRecord, 'notificationId' | 'createdAt' | 'status'> & {
      notificationId?: string;
      createdAt?: string;
      status?: NotificationRecord['status'];
    }): Promise<NotificationRecord> {
      const record: NotificationRecord = {
        notificationId: input.notificationId ?? randomBytes(16).toString('hex'),
        tenantId: input.tenantId,
        type: input.type,
        priority: input.priority,
        status: input.status ?? 'unread',
        title: input.title,
        message: input.message,
        runId: input.runId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        interruptId: input.interruptId,
        actionUrl: input.actionUrl,
        metadata: input.metadata,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      await b.insertNotification(record);
      for (const sub of subscribers) {
        try { sub(record); } catch { /* subscriber failures don't abort the emit */ }
      }
      // Fan out to every Web Push subscription owned by the tenant.
      // Best-effort + concurrent — push delivery latency must not
      // block the emit return. `pushNotification` swallows per-sub
      // errors and prunes 404/410 endpoints on its own.
      void pushNotification(b, record);
      return record;
    },
    subscribe(fn: (n: NotificationRecord) => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
