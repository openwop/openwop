/**
 * Narrow storage interface used by the workflow-engine sample.
 *
 * Backends implement these methods atomically. The sqlite default impl
 * uses transactions where multiple writes must be atomic (e.g., event
 * append + sequence increment).
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
  insertRun(run: RunRecord): void;
  getRun(runId: string): RunRecord | null;
  updateRun(runId: string, patch: Partial<RunRecord>): void;
  listRuns(filter: { tenantId?: string; status?: string; limit?: number }): readonly RunRecord[];

  // ── events ──
  /** Atomic append: assigns next sequence per (runId), returns sequence. */
  appendEvent(input: Omit<EventRecord, 'sequence'>): EventRecord;
  listEvents(runId: string, opts?: { fromSeq?: number; limit?: number }): readonly EventRecord[];
  getMaxSequence(runId: string): number;

  // ── interrupts ──
  insertInterrupt(record: InterruptRecord): void;
  getInterrupt(interruptId: string): InterruptRecord | null;
  getInterruptByToken(token: string): InterruptRecord | null;
  getInterruptByNode(runId: string, nodeId: string): InterruptRecord | null;
  resolveInterrupt(interruptId: string, resolvedValue: unknown, resolvedAt: string): void;
  listOpenInterrupts(runId: string): readonly InterruptRecord[];

  // ── webhooks ──
  insertWebhook(record: WebhookSubscriptionRecord): void;
  getWebhook(subscriptionId: string): WebhookSubscriptionRecord | null;
  deleteWebhook(subscriptionId: string): void;
  listWebhooks(filter: { eventType?: string; tags?: readonly string[] }): readonly WebhookSubscriptionRecord[];

  // ── idempotency ──
  /** Returns the cached record for `key`, or null if absent. */
  lookupIdempotency(key: string): IdempotencyRecord | null;
  /**
   * Atomically: if `key` is unknown, insert a `__pending__` placeholder and
   * return `{ claimed: true, existing: null }`. If `key` is already present,
   * return `{ claimed: false, existing: <the record> }`.
   *
   * Concurrent callers see exactly one `claimed: true`; the rest get the
   * existing record (which may itself be `__pending__` if the holder is
   * still building the response — caller MUST handle that case).
   */
  claimIdempotency(key: string, createdAt: string): { claimed: boolean; existing: IdempotencyRecord | null };
  /** Insert-or-replace the cached record (used to upgrade `__pending__` → final). */
  putIdempotency(record: IdempotencyRecord): void;

  // ── audit log ──
  appendAudit(input: {
    timestamp: string;
    principalId?: string;
    action: string;
    resource?: string;
    outcome?: string;
    payload?: unknown;
  }): void;

  // ── invocation log (engine-side idempotency) ──
  /**
   * Returns the cached result for (runId, nodeId, attempt, providerKey)
   * if present, else null. Callers MUST supply a non-empty providerKey
   * derived from the external call shape.
   */
  getInvocation(key: { runId: string; nodeId: string; attempt: number; providerKey: string }): unknown | null;
  putInvocation(key: { runId: string; nodeId: string; attempt: number; providerKey: string }, result: unknown): void;

  // ── BYOK secrets (encrypted at rest) ──
  /** Persist an encrypted secret record. Caller MUST encrypt before calling. */
  upsertEncryptedSecret(credentialRef: string, encryptedRecordJson: string, now: string): void;
  /** Read back the encrypted record (caller decrypts). Returns null if absent. */
  getEncryptedSecret(credentialRef: string): string | null;
  /** Remove a secret entirely. */
  deleteSecret(credentialRef: string): void;
  /** List all stored credentialRefs (NEVER values). */
  listSecretRefs(): readonly string[];

  // ── lifecycle ──
  close(): void;
}
