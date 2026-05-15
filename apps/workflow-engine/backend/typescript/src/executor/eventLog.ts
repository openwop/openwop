/**
 * Event log singleton. Wires the executor's emit calls to the storage
 * adapter's atomic-sequence appendEvent.
 */

import { randomUUID } from 'node:crypto';
import type { EventRecord } from '../types.js';
import type { Storage } from '../storage/storage.js';

let backend: Storage | null = null;

const subscribers = new Set<(event: EventRecord) => void>();

export function setEventLogBackend(storage: Storage): void {
  backend = storage;
}

export function getEventLog() {
  return {
    append(input: { runId: string; type: string; nodeId?: string; payload?: unknown; causationId?: string }): EventRecord {
      if (!backend) throw new Error('EventLog backend not installed');
      const record = backend.appendEvent({
        eventId: randomUUID(),
        runId: input.runId,
        type: input.type,
        nodeId: input.nodeId,
        payload: input.payload ?? null,
        timestamp: new Date().toISOString(),
        causationId: input.causationId,
      });
      // Best-effort fanout to in-process subscribers (SSE, webhooks).
      for (const sub of subscribers) {
        try {
          sub(record);
        } catch {
          /* swallow — subscriber failures must not abort the append */
        }
      }
      return record;
    },
    list(runId: string, opts?: { fromSeq?: number; limit?: number }): readonly EventRecord[] {
      if (!backend) throw new Error('EventLog backend not installed');
      return backend.listEvents(runId, opts);
    },
    getMaxSequence(runId: string): number {
      if (!backend) throw new Error('EventLog backend not installed');
      return backend.getMaxSequence(runId);
    },
    subscribe(fn: (event: EventRecord) => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
