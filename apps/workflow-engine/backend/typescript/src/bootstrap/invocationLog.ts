/**
 * Invocation log — engine-side idempotency. Cross-instance retries of
 * the same (runId, nodeId, attempt, providerKey) tuple agree on a single
 * external-call result via storage-side receipts.
 *
 * Sample-grade: single-process, but the invariant is the same shape as
 * the postgres reference host's pattern.
 */

import { setInvocationBackend } from '../executor/invocationLog.js';
import type { Storage } from '../storage/storage.js';

export function ensureInvocationLogInstalled(storage: Storage): void {
  setInvocationBackend(storage);
}
