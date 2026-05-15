/**
 * Engine-side invocation log. Cross-attempt cache keyed by
 * (runId, nodeId, attempt, providerKey). Two retries of the same
 * external call return the same result.
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
    get(key: { runId: string; nodeId: string; attempt: number; providerKey: string }): unknown {
      return b.getInvocation(key);
    },
    put(key: { runId: string; nodeId: string; attempt: number; providerKey: string }, result: unknown): void {
      b.putInvocation(key, result);
    },
  };
}
