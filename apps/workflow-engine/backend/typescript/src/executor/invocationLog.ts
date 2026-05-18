/**
 * Engine-side invocation log. Cross-attempt cache keyed by
 * (runId, nodeId, attempt, providerKey). Two retries of the same
 * external call return the same result.
 *
 * Async as of P3.3.
 */

import type { Storage } from '../storage/storage.js';

let backend: Storage | null = null;

export function setInvocationBackend(storage: Storage): void {
  backend = storage;
}

export function getInvocationLog() {
  if (!backend) throw new Error('InvocationLog backend not installed');
  const b = backend;
  return {
    async get(key: { runId: string; nodeId: string; attempt: number; providerKey: string }): Promise<unknown> {
      return await b.getInvocation(key);
    },
    async put(key: { runId: string; nodeId: string; attempt: number; providerKey: string }, result: unknown): Promise<void> {
      await b.putInvocation(key, result);
    },
  };
}
