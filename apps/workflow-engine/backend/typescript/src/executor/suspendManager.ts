/**
 * Suspend manager singleton. Backs interrupt persistence onto the
 * storage adapter so a process restart between node-suspend and
 * resume doesn't drop the awaiting state.
 *
 * As of P3.3 every method is async — Storage is async-native.
 */

import { randomBytes } from 'node:crypto';
import type { InterruptRecord } from '../types.js';
import type { Storage } from '../storage/storage.js';
import { stripSecretsFromPersisted } from '../byok/ephemeralRunSecrets.js';
import { emitInterruptNotification } from '../notifications/notify.js';

let backend: Storage | null = null;

export function setSuspendBackend(storage: Storage): void {
  backend = storage;
}

export function getSuspendManager() {
  if (!backend) throw new Error('SuspendManager backend not installed');
  const b = backend;
  return {
    async createInterrupt(input: {
      runId: string;
      nodeId: string;
      kind: InterruptRecord['kind'];
      data: unknown;
      resumeSchema?: Record<string, unknown>;
    }): Promise<InterruptRecord> {
      const interruptId = randomBytes(16).toString('hex');
      const token = randomBytes(32).toString('base64url');
      const record: InterruptRecord = {
        interruptId,
        runId: input.runId,
        nodeId: input.nodeId,
        kind: input.kind,
        token,
        data: stripSecretsFromPersisted(input.data),
        resumeSchema: input.resumeSchema,
        createdAt: new Date().toISOString(),
      };
      await b.insertInterrupt(record);
      // Fan out a notification so the bell + /inbox surface the
      // action-needed signal without polling. Best-effort — emit
      // failures don't abort the suspend (the interrupt row is
      // already persisted and the run will still resume via the
      // normal /v1/interrupts surface).
      void emitInterruptNotification(b, record);
      return record;
    },
    async resolve(interruptId: string, value: unknown): Promise<void> {
      await b.resolveInterrupt(interruptId, value, new Date().toISOString());
    },
    async getByToken(token: string): Promise<InterruptRecord | null> {
      return await b.getInterruptByToken(token);
    },
    async getByNode(runId: string, nodeId: string): Promise<InterruptRecord | null> {
      return await b.getInterruptByNode(runId, nodeId);
    },
    async listOpen(runId: string): Promise<readonly InterruptRecord[]> {
      return await b.listOpenInterrupts(runId);
    },
  };
}
