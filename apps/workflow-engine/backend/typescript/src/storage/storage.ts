/**
 * Narrow storage interface used by the workflow-engine sample.
 *
 * As of P3.3, every method returns a Promise. The sqlite + memory
 * backends wrap their sync `better-sqlite3` calls in `async` (cheap;
 * the Promise is resolved synchronously). The Postgres backend uses
 * `pg` natively. Callers `await` every call.
 *
 * Backends implement these methods atomically (per-method ACID where
 * the backing store supports it). The sqlite impl uses transactions
 * where multiple writes must be atomic (e.g., event append + sequence
 * increment); the Postgres impl uses `BEGIN`/`COMMIT` around the same
 * sequences.
 */

import type {
  EventRecord,
  IdempotencyRecord,
  InterruptRecord,
  RunRecord,
  WebhookSubscriptionRecord,
} from '../types.js';

export interface Storage {
  // ── runs ──
  insertRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: Partial<RunRecord>): Promise<void>;
  listRuns(filter: { tenantId?: string; status?: string; limit?: number }): Promise<readonly RunRecord[]>;

  // ── events ──
  /** Atomic append: assigns next sequence per (runId), returns sequence. */
  appendEvent(input: Omit<EventRecord, 'sequence'>): Promise<EventRecord>;
  listEvents(runId: string, opts?: { fromSeq?: number; limit?: number }): Promise<readonly EventRecord[]>;
  getMaxSequence(runId: string): Promise<number>;

  // ── interrupts ──
  insertInterrupt(record: InterruptRecord): Promise<void>;
  getInterrupt(interruptId: string): Promise<InterruptRecord | null>;
  getInterruptByToken(token: string): Promise<InterruptRecord | null>;
  getInterruptByNode(runId: string, nodeId: string): Promise<InterruptRecord | null>;
  resolveInterrupt(interruptId: string, resolvedValue: unknown, resolvedAt: string): Promise<void>;
  listOpenInterrupts(runId: string): Promise<readonly InterruptRecord[]>;

  // ── webhooks ──
  insertWebhook(record: WebhookSubscriptionRecord): Promise<void>;
  getWebhook(subscriptionId: string): Promise<WebhookSubscriptionRecord | null>;
  deleteWebhook(subscriptionId: string): Promise<void>;
  listWebhooks(filter: { eventType?: string; tags?: readonly string[] }): Promise<readonly WebhookSubscriptionRecord[]>;

  // ── idempotency ──
  /**
   * Atomically: if `key` is unknown, insert a `__pending__` placeholder and
   * return `{ claimed: true, existing: null }`. If `key` is already present,
   * return `{ claimed: false, existing: <the record> }`.
   *
   * Concurrent callers see exactly one `claimed: true`; the rest get the
   * existing record (which may itself be `__pending__` if the holder is
   * still building the response — caller MUST handle that case).
   */
  claimIdempotency(key: string, createdAt: string): Promise<{ claimed: boolean; existing: IdempotencyRecord | null }>;
  /** Insert-or-replace the cached record (used to upgrade `__pending__` → final). */
  putIdempotency(record: IdempotencyRecord): Promise<void>;

  // ── audit log ──
  appendAudit(input: {
    timestamp: string;
    principalId?: string;
    action: string;
    resource?: string;
    outcome?: string;
    payload?: unknown;
  }): Promise<void>;

  // ── invocation log (engine-side idempotency) ──
  /**
   * Returns the cached result for (runId, nodeId, attempt, providerKey)
   * if present, else null. Callers MUST supply a non-empty providerKey
   * derived from the external call shape.
   */
  getInvocation(key: { runId: string; nodeId: string; attempt: number; providerKey: string }): Promise<unknown | null>;
  putInvocation(key: { runId: string; nodeId: string; attempt: number; providerKey: string }, result: unknown): Promise<void>;

  // ── BYOK secrets (encrypted at rest) ──
  /** Persist an encrypted secret record. Caller MUST encrypt before calling. */
  upsertEncryptedSecret(credentialRef: string, encryptedRecordJson: string, now: string): Promise<void>;
  /** Read back the encrypted record (caller decrypts). Returns null if absent. */
  getEncryptedSecret(credentialRef: string): Promise<string | null>;
  /** Remove a secret entirely. */
  deleteSecret(credentialRef: string): Promise<void>;
  /** List all stored credentialRefs (NEVER values). */
  listSecretRefs(): Promise<readonly string[]>;

  // ── lifecycle ──
  close(): Promise<void>;
}
