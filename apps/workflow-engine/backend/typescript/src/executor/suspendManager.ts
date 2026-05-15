/**
 * Suspend manager singleton. Backs interrupt persistence onto the
 * storage adapter so a process restart between node-suspend and
 * resume doesn't drop the awaiting state.
 */

import { randomBytes } from 'node:crypto';
import type { InterruptRecord } from '../types.js';
import type { Storage } from '../storage/storage.js';
import { stripSecretsFromPersisted } from '../byok/ephemeralRunSecrets.js';

let backend: Storage | null = null;

export function setSuspendBackend(storage: Storage): void {
  backend = storage;
}

export function getSuspendManager() {
  if (!backend) throw new Error('SuspendManager backend not installed');
  const b = backend;
  return {
    createInterrupt(input: {
      runId: string;
      nodeId: string;
      kind: InterruptRecord['kind'];
      data: unknown;
      resumeSchema?: Record<string, unknown>;
    }): InterruptRecord {
      const interruptId = randomBytes(16).toString('hex');
      const token = randomBytes(32).toString('base64url');
      // Defense in depth: strip-on-persist also applies to interrupt
      // data so a node that puts a secret value in `interrupt.data`
      // doesn't leak via the `interrupts` table or the unauth
      // `GET /v1/interrupts/{token}` inspection endpoint.
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
      b.insertInterrupt(record);
      return record;
    },
    resolve(interruptId: string, value: unknown): void {
      b.resolveInterrupt(interruptId, value, new Date().toISOString());
    },
    getByToken(token: string): InterruptRecord | null {
      return b.getInterruptByToken(token);
    },
    getByNode(runId: string, nodeId: string): InterruptRecord | null {
      return b.getInterruptByNode(runId, nodeId);
    },
    listOpen(runId: string): readonly InterruptRecord[] {
      return b.listOpenInterrupts(runId);
    },
  };
}
