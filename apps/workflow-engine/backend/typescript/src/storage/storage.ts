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
  AnnotationRecord,
  ChatMessageRecord,
  ChatSessionRecord,
  EventRecord,
  IdempotencyRecord,
  InterruptRecord,
  NotificationRecord,
  NotificationStatus,
  PushSubscriptionRecord,
  RunRecord,
  UserAgentRecord,
  WebhookSubscriptionRecord,
} from '../types.js';
import type {
  ChatEgressEnvelope,
  DeliveryLogRecord,
  MessagingConnectorRecord,
  MessagingIdentityRecord,
  MessagingPolicyRecord,
  MessagingAllowlistEntry,
  MessagingPairingRecord,
  MessagingRoutingRuleRecord,
  MessagingSessionRecord,
  MessagingTurnRecord,
  RelayDeviceRecord,
} from '../messaging/types.js';

export interface Storage {
  // ── runs ──
  insertRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: Partial<RunRecord>): Promise<void>;
  listRuns(filter: { tenantId?: string; status?: string; limit?: number }): Promise<readonly RunRecord[]>;
  /** Permanently remove a run + its events / interrupts / invocation-log
   *  rows (no FK cascade in this schema, so the delete is explicit).
   *  Returns true if a run row existed. Tenant authorization is enforced at
   *  the route, not here. */
  deleteRun(runId: string): Promise<boolean>;

  // ── annotations (RFC 0056 — per-run side-store, NOT the event log) ──
  insertAnnotation(record: AnnotationRecord): Promise<void>;
  listAnnotations(runId: string): Promise<readonly AnnotationRecord[]>;

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

  // ── Tenant-scoped BYOK secrets (KMS-encrypted, signed-in users) ──
  /** Persist a tenant-scoped encrypted secret. Caller MUST encrypt before calling. */
  upsertTenantSecret(tenantId: string, credentialRef: string, encryptedRecordJson: string, now: string): Promise<void>;
  /** Read back a tenant-scoped encrypted record. Returns null if absent. */
  getTenantSecret(tenantId: string, credentialRef: string): Promise<string | null>;
  /** Remove a tenant-scoped secret. */
  deleteTenantSecret(tenantId: string, credentialRef: string): Promise<void>;
  /** List a tenant's credentialRefs (NEVER values). */
  listTenantSecretRefs(tenantId: string): Promise<readonly string[]>;
  /** Remove every secret owned by a tenant. Used for account deletion. */
  deleteAllTenantSecrets(tenantId: string): Promise<number>;

  // ── tenant hard delete (account deletion) ──
  /**
   * Hard-delete every row owned by `tenantId`. Returns per-table row
   * counts. Used by the account-deletion flow (P3.6.5).
   *
   * Cascade order:
   *   1. events  — deleted by runId for every run owned by the tenant
   *   2. interrupts — same
   *   3. runs — direct DELETE
   *   4. workflows — direct DELETE
   *   5. byok_tenant_secrets — direct DELETE (KMS-wrapped DEKs become
   *      orphan; the plaintext is unrecoverable)
   *
   * Note: this does NOT touch the audit log — security-relevant events
   * persist past account deletion by design.
   */
  deleteAllTenantData(tenantId: string): Promise<{
    runs: number;
    events: number;
    interrupts: number;
    workflows: number;
    secrets: number;
    notifications: number;
    pushSubscriptions: number;
  }>;

  // ── tenant reassignment (anon → user migration) ──
  /**
   * Reassign every row owned by `fromTenant` to `toTenant`. Used when
   * an anonymous visitor signs up — their `anon:<sid>` work becomes
   * persistent under their new `user:<sha>` tenant id. Returns per-
   * table row counts so the caller can attribute audit entries.
   *
   * Idempotent: re-calling with no remaining rows returns zeros. Does
   * NOT touch BYOK secrets (handled out-of-band by the resolver —
   * anon secrets are ephemeral-only).
   */
  reassignTenant(fromTenant: string, toTenant: string): Promise<{ runs: number; workflows: number }>;

  // ── managed-provider per-day usage ──
  /**
   * Increment a tenant's token usage for a managed (server-held-key)
   * provider on a given UTC date. Upserts; first call for a (tenant,
   * date, provider) inserts a row with the supplied counts.
   *
   * Used by `src/providers/managedProvider.ts` to enforce per-user
   * daily caps against the operator's shared MiniMax (etc.) key.
   */
  incrementManagedUsage(
    tenantId: string,
    providerId: string,
    dateUtc: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void>;
  /** Read a tenant's accumulated tokens for a managed provider on a UTC date.
   *  Returns `{ inputTokens: 0, outputTokens: 0 }` when no row exists. */
  getManagedUsage(
    tenantId: string,
    providerId: string,
    dateUtc: string,
  ): Promise<{ inputTokens: number; outputTokens: number }>;

  // ── envelope-correlation cache (cross-process replay safety) ──
  /**
   * Read back a previously-accepted envelope outcome for a given
   * (runId, correlationId). Returns null if no record exists. Backs
   * the persisted-dedup-state seam for `host.aiEnvelope.correlationReplay`
   * cross-process semantics: if a process dies between accepting the
   * first emission and persisting downstream side-effects, a recovered
   * process that re-emits the same correlationId reads back the
   * original outcome from this surface instead of re-running the
   * acceptor (which could now decide differently if e.g. capability
   * flags changed). Outcome JSON carries the already-redacted payload
   * — never the raw envelope — so SR-1 redaction-carry-forward holds
   * across the persistence boundary.
   */
  getEnvelopeCorrelation(
    runId: string,
    correlationId: string,
  ): Promise<{ outcome: unknown; envelopeType: string; recordedAt: string } | null>;
  /**
   * Persist (runId, correlationId) → outcome. Insert-or-replace.
   *
   * `recordedAt` MUST be an ISO-8601 UTC string (the `Z` form, e.g.
   * `new Date().toISOString()`). The sqlite backend stores it as TEXT
   * verbatim while the postgres backend stores it as TIMESTAMPTZ and
   * round-trips through `Date.toISOString()` on read — both round-trip
   * cleanly only for ISO-8601-Z input. Non-UTC-Z timestamps would
   * silently diverge between backends.
   */
  putEnvelopeCorrelation(
    runId: string,
    correlationId: string,
    outcome: unknown,
    envelopeType: string,
    recordedAt: string,
  ): Promise<void>;

  // ── chat sessions (Phase 2C.1) ──
  /**
   * Sample-namespaced chat-session history backing the new
   * `/v1/host/sample/chat/sessions/*` routes. Two tables: session
   * headers (this method family) + per-session messages (below).
   * Sessions are tenant-scoped; the in-memory adapter holds them in
   * a Map keyed by tenantId; sqlite/postgres back them with the
   * `chat_sessions` + `chat_messages` tables added in their next
   * migration.
   */
  listChatSessions(tenantId: string, limit?: number): Promise<readonly ChatSessionRecord[]>;
  /** Insert-or-throw (caller picks the sessionId; collision is a
   *  programming error, not a wire-level conflict). */
  createChatSession(record: ChatSessionRecord): Promise<void>;
  getChatSession(tenantId: string, sessionId: string): Promise<ChatSessionRecord | null>;
  /** Patch the mutable fields (title, updatedAt, messageCount).
   *  `sessionId`/`tenantId`/`createdAt` are immutable. */
  updateChatSession(
    tenantId: string,
    sessionId: string,
    patch: Partial<Pick<ChatSessionRecord, 'title' | 'updatedAt' | 'messageCount'>>,
  ): Promise<void>;
  /** Cascade-delete: drops both the session header AND all messages.
   *  Returns true if a row was removed, false if absent (idempotent). */
  deleteChatSession(tenantId: string, sessionId: string): Promise<boolean>;
  /** Load every message for a session in insertion order. */
  listChatSessionMessages(sessionId: string): Promise<readonly ChatMessageRecord[]>;
  /** Append a single message. Caller updates `chat_sessions.message_count`
   *  via `updateChatSession()` in the same logical operation. */
  appendChatMessage(record: ChatMessageRecord): Promise<void>;

  // ── notifications (PR #143) ──
  /**
   * Per-tenant inbox of action-needed signals. Emitted by the executor
   * + suspend manager when a HITL interrupt opens, a run fails, etc.
   * The /v1/notifications routes back the bell + panel in the FE app.
   *
   * Status lifecycle: `unread` → `read` (via updateNotificationStatus)
   *                          → `archived` (via updateNotificationStatus)
   *                          → deleted (via deleteNotification).
   * `read_at` / `archived_at` columns are set by the storage adapter on
   * transition; callers pass the target status.
   */
  insertNotification(record: NotificationRecord): Promise<void>;
  listNotifications(filter: {
    tenantId: string;
    status?: NotificationStatus | readonly NotificationStatus[];
    /** Exclude `archived` rows by default — the inbox view doesn't
     *  surface them. Pass `includeArchived: true` from the Archived tab. */
    includeArchived?: boolean;
    /** Oldest-first when true; default newest-first. */
    ascending?: boolean;
    limit?: number;
  }): Promise<readonly NotificationRecord[]>;
  getNotification(notificationId: string): Promise<NotificationRecord | null>;
  /**
   * Move a notification to a new status. The adapter sets `read_at` /
   * `archived_at` automatically based on the target status. Returns
   * the updated record, or null if the row was absent.
   */
  updateNotificationStatus(
    notificationId: string,
    status: NotificationStatus,
    now: string,
  ): Promise<NotificationRecord | null>;
  /** Mark every unread row for the tenant as read. Returns the count touched. */
  markAllNotificationsRead(tenantId: string, now: string): Promise<number>;
  deleteNotification(notificationId: string): Promise<boolean>;
  /** Drop every notification owned by a tenant (used by account-delete). */
  deleteAllTenantNotifications(tenantId: string): Promise<number>;

  // ── Web Push subscriptions (PR #174) ──
  /**
   * Per-tenant push subscription rows. One per browser/device, identified
   * by the `endpoint` URL the browser hands us at `pushManager.subscribe()`
   * time. The same endpoint re-subscribing (e.g., key rotation, user
   * re-enabled permission) UPSERTs by endpoint — keeps the row count
   * matched to active browsers, not historical subscription attempts.
   */
  insertPushSubscription(record: PushSubscriptionRecord): Promise<void>;
  /** List every active subscription owned by a tenant. Used by the
   *  notification emitter to fan out a push delivery on emit. */
  listPushSubscriptions(tenantId: string): Promise<readonly PushSubscriptionRecord[]>;
  /** Look up a subscription by endpoint — used to detect duplicates
   *  and to delete one specific browser's row on permission-revoke. */
  getPushSubscriptionByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
  /** Drop a single subscription. Returns true when a row was removed. */
  deletePushSubscription(subscriptionId: string): Promise<boolean>;
  /** Drop every subscription owned by a tenant — wired into the
   *  account-delete cascade. */
  deleteAllTenantPushSubscriptions(tenantId: string): Promise<number>;

  // ── user-authored agents (phase E1, 2026-05-28) ──
  // Pack-installed agents come through the AgentRegistry from RFC 0003
  // pack manifests. These rows back `POST /v1/host/sample/agents` —
  // the Agents-tab authoring form. On boot the app reads every row and
  // registers it with the AgentRegistry; the existing GET /v1/agents
  // surface then merges both sources without consumers distinguishing.
  insertUserAgent(record: UserAgentRecord): Promise<void>;
  /** List every user-authored agent owned by a tenant. Used by the
   *  agents-tab list view (filtered to the caller's tenant). */
  listUserAgents(tenantId: string): Promise<readonly UserAgentRecord[]>;
  /** Cross-tenant listing — used by the boot-time registry loader so
   *  every user-authored agent is registered in the process-local
   *  `AgentRegistry` without first enumerating tenants. The registry
   *  itself is not tenant-scoped; tenant-isolation lives at the
   *  storage + route layers. */
  listAllUserAgents(): Promise<readonly UserAgentRecord[]>;
  /** Read one user-authored agent. Returns null when not present —
   *  the agents tab's delete handler uses this to confirm ownership
   *  before issuing the DELETE. */
  getUserAgent(agentId: string): Promise<UserAgentRecord | null>;
  /** Remove one user-authored agent. Returns true when a row was
   *  removed. Pack-installed agents aren't reachable through this
   *  surface (different storage). */
  deleteUserAgent(agentId: string): Promise<boolean>;

  // ── messaging relay-gateway (demo host-extension; NON-normative) ──
  // Device tokens are persisted as a SHA-256 hash only (see RelayDeviceRecord).
  upsertRelayDevice(record: RelayDeviceRecord): Promise<void>;
  getRelayDevice(relayId: string): Promise<RelayDeviceRecord | null>;
  /** Look up an active device by the SHA-256 hash of its presented token. */
  getRelayDeviceByTokenHash(tokenHash: string): Promise<RelayDeviceRecord | null>;
  /** Append an egress to a relay's outbound queue. */
  enqueueRelayOutbound(record: ChatEgressEnvelope): Promise<void>;
  /** Pull pending egress for a relay, oldest first. */
  listRelayOutbound(relayId: string, limit: number): Promise<readonly ChatEgressEnvelope[]>;
  /** Delete acked egress rows; returns the count removed. */
  ackRelayOutbound(relayId: string, egressIds: readonly string[]): Promise<number>;
  /** Drop a relay's whole queue (on revoke). */
  deleteRelayOutbound(relayId: string): Promise<void>;
  upsertMessagingConnector(record: MessagingConnectorRecord): Promise<void>;
  getMessagingConnector(connectorId: string): Promise<MessagingConnectorRecord | null>;
  listMessagingConnectors(tenantId: string | undefined): Promise<readonly MessagingConnectorRecord[]>;
  upsertMessagingSession(record: MessagingSessionRecord): Promise<void>;
  getMessagingSession(sessionKey: string): Promise<MessagingSessionRecord | null>;
  listMessagingSessions(tenantId: string | undefined): Promise<readonly MessagingSessionRecord[]>;
  deleteMessagingSession(sessionKey: string): Promise<boolean>;
  // policies (per-connector access control) / routing / identity / delivery log
  upsertMessagingPolicy(record: MessagingPolicyRecord): Promise<void>;
  getMessagingPolicy(connectorId: string): Promise<MessagingPolicyRecord | null>;
  upsertMessagingRoutingRule(record: MessagingRoutingRuleRecord): Promise<void>;
  listMessagingRoutingRules(tenantId: string | undefined): Promise<readonly MessagingRoutingRuleRecord[]>;
  deleteMessagingRoutingRule(ruleId: string): Promise<boolean>;
  upsertMessagingIdentity(record: MessagingIdentityRecord): Promise<void>;
  getMessagingIdentity(identityId: string): Promise<MessagingIdentityRecord | null>;
  listMessagingIdentities(tenantId: string | undefined): Promise<readonly MessagingIdentityRecord[]>;
  deleteMessagingIdentity(identityId: string): Promise<boolean>;
  appendDeliveryLog(record: DeliveryLogRecord): Promise<void>;
  listDeliveryLog(filter: {
    tenantId: string | undefined;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    status?: string;
    limit?: number;
  }): Promise<readonly DeliveryLogRecord[]>;
  appendMessagingTurn(record: MessagingTurnRecord): Promise<void>;
  /**
   * Return the most-recent `limit` turns for a session, oldest → newest.
   * `tenantId` is required defense-in-depth so a collision of
   * `${channel}:${conversationId}` across tenants cannot leak turns.
   */
  listMessagingTurns(sessionKey: string, limit: number, tenantId: string): Promise<readonly MessagingTurnRecord[]>;

  // ── pairing + allowlist (per-connector access gates) ──
  appendMessagingPairing(record: MessagingPairingRecord): Promise<void>;
  getMessagingPairingByCode(connectorId: string, code: string): Promise<MessagingPairingRecord | null>;
  listMessagingPairings(connectorId: string | undefined): Promise<readonly MessagingPairingRecord[]>;
  deleteMessagingPairing(pairingId: string): Promise<boolean>;
  addMessagingAllowlist(entry: MessagingAllowlistEntry): Promise<void>;
  getMessagingAllowlist(connectorId: string, channel: string, peerId: string): Promise<MessagingAllowlistEntry | null>;
  listMessagingAllowlist(connectorId: string | undefined): Promise<readonly MessagingAllowlistEntry[]>;
  deleteMessagingAllowlist(connectorId: string, channel: string, peerId: string): Promise<boolean>;

  // ── host-extension durability (generic key→JSON store) ──
  // A single small table backing the sample host-extension stores (Kanban
  // boards, agent roster, org-chart) so they survive a restart on the file /
  // Postgres backends. Generic on purpose — a host-ext service serializes its
  // whole collection to one key, rather than the core Storage interface
  // fanning out a method per entity. NOT a normative protocol surface.
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  /** Read-through scan of every (key,value) whose key starts with `keyPrefix`.
   *  Backs the per-entity host-ext collections (one row per board/card/roster
   *  entry/...), so a list reads live rows rather than a per-instance cache. */
  kvList(keyPrefix: string): Promise<ReadonlyArray<{ key: string; value: string }>>;
  /** Delete one key. Returns true if a row existed. */
  kvDelete(key: string): Promise<boolean>;

  // ── cross-instance pub/sub (host-ext live fan-out) ──
  // Publishes a small payload to a logical channel and delivers it to every
  // subscriber across ALL host instances. Backs the Kanban SSE board-change
  // fan-out so a mutation on one instance reaches SSE clients on every
  // instance. On Postgres this is LISTEN/NOTIFY; on sqlite (single node) it is
  // an in-process emitter. NOT a normative protocol surface.
  /** Publish `payload` to a logical `channel` (delivered cross-instance). */
  publish(channel: string, payload: string): Promise<void>;
  /** Subscribe to a logical `channel`. Returns an async unsubscribe. */
  subscribe(channel: string, handler: (payload: string) => void): Promise<() => Promise<void>>;

  // ── lifecycle ──
  close(): Promise<void>;
}
