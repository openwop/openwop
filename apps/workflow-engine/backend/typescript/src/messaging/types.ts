/**
 * Shared types for the demo messaging relay-gateway (NON-normative,
 * sample-extension). Kept dependency-free so both the Storage layer and the
 * route handlers can import them without a cycle (routes → storage → types).
 */

export const RELAY_CHANNELS = ['whatsapp', 'signal', 'imessage', 'discord'] as const;
export type RelayChannel = (typeof RELAY_CHANNELS)[number];

/** A media attachment carried in either direction. */
export interface ChatAttachment {
  url: string;
  mimeType?: string;
  filename?: string;
}

/** Inbound event kind (envelope v2); plain `message` is the default. */
export type ChatInboundKind = 'message' | 'reaction' | 'edit' | 'command';

/** An interactive component offered with an outbound message (quick-reply / link button). */
export interface ChatOutboundComponent {
  id: string;
  label: string;
  style?: 'reply' | 'link';
  url?: string;
}

/** Canonical inbound envelope (platform → host). Request-shaped, not stored as-is. */
export interface ChatIngressEnvelope {
  channel: RelayChannel;
  platformMessageId: string;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  text: string;
  media?: ReadonlyArray<ChatAttachment>;
  timestamp: string;
  // ── envelope v2 (all additive/optional; a message-only host ignores them) ──
  kind?: ChatInboundKind;
  quotedMessageId?: string;
  reaction?: { emoji: string; targetMessageId: string };
  command?: { name: string; args?: string };
  /**
   * Per-channel platform IDs of users the inbound message @mentioned (Signal
   * mentions[].uuid, WhatsApp contextInfo.mentionedJid, Discord mentions, …).
   * The host's `requireMention` policy gate uses this — channels that can't
   * populate it (or older clients) cause the gate to fall back to a text check.
   */
  mentions?: ReadonlyArray<string>;
  /** Opaque per-channel metadata (guildId/threadId/…); never interpreted by the protocol. */
  channelMeta?: Record<string, unknown>;
}

/** Canonical outbound envelope (host → platform). Persisted in the outbound queue. */
export interface ChatEgressEnvelope {
  egressId: string;
  relayId: string;
  channel: RelayChannel;
  conversationId: string;
  text: string;
  media?: ReadonlyArray<ChatAttachment>;
  replyToMessageId?: string;
  enqueuedAt: string;
  // ── envelope v2 (all additive/optional) ──
  components?: ReadonlyArray<ChatOutboundComponent>;
  /** Emoji to react with on `replyToMessageId` instead of sending a message. */
  reactions?: ReadonlyArray<string>;
}

/**
 * Serialize the envelope-v2 outbound fields (media/components/reactions) to a
 * JSON string for the `relay_outbound.extra` column, or null when none are
 * present. The core columns (text, replyToMessageId, …) stay first-class; only
 * the rich, sparsely-used fields ride in the blob so the queue stays simple.
 */
export function egressExtraJson(record: ChatEgressEnvelope): string | null {
  const extra: Record<string, unknown> = {};
  if (record.media && record.media.length) extra.media = record.media;
  if (record.components && record.components.length) extra.components = record.components;
  if (record.reactions && record.reactions.length) extra.reactions = record.reactions;
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

/** Re-attach the envelope-v2 fields parsed from a `relay_outbound.extra` blob. */
export function applyEgressExtra(base: ChatEgressEnvelope, extra: string | null | undefined): ChatEgressEnvelope {
  if (!extra) return base;
  try {
    const e = JSON.parse(extra) as Partial<ChatEgressEnvelope>;
    return {
      ...base,
      ...(e.media ? { media: e.media } : {}),
      ...(e.components ? { components: e.components } : {}),
      ...(e.reactions ? { reactions: e.reactions } : {}),
    };
  } catch {
    return base;
  }
}

/**
 * A relay device. The device token is NEVER stored in the clear — only its
 * SHA-256 hash (`deviceTokenHash`) is persisted; the plaintext token is
 * returned once at activation and held client-side.
 */
export interface RelayDeviceRecord {
  relayId: string;
  tenantId: string;
  channel: RelayChannel;
  deviceName?: string;
  status: 'registered' | 'active' | 'revoked';
  deviceTokenHash?: string;
  tokenExpiresAt?: string;
  activationCode?: string;
  activationExpiresAt?: string;
  registeredAt: string;
  lastHeartbeatAt?: string;
  lastReportedStatus?: string;
}

export interface MessagingConnectorRecord {
  connectorId: string;
  tenantId: string;
  channel: RelayChannel;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessagingSessionRecord {
  sessionKey: string;
  tenantId: string;
  channel: RelayChannel;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  lastInboundAt: string;
  messageCount: number;
  lastRunId?: string;
}

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'allowlist' | 'open' | 'disabled';

/** Per-connector access policy (who may DM / activate in groups). */
export interface MessagingPolicyRecord {
  connectorId: string;
  tenantId: string;
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  requireMention: boolean;
  updatedAt: string;
}

/**
 * A routing rule mapping an inbound match → bound workflow OR agent. Exactly
 * one of `workflowId` / `agentId` is set; the bridge dispatches accordingly.
 */
export interface MessagingRoutingRuleRecord {
  ruleId: string;
  tenantId: string;
  channel?: RelayChannel;
  /** Match the conversationId/peerId against `pattern` (substring; '*' = any). */
  pattern: string;
  /** Bind the matched conversation to a workflow (default path). */
  workflowId?: string;
  /** OR bind to a manifest agent (RFC 0070 dispatch). Mutex with `workflowId`. */
  agentId?: string;
  priority: number;
  createdAt: string;
}

/** A cross-channel identity linking platform peers to one logical person. */
export interface MessagingIdentityRecord {
  identityId: string;
  tenantId: string;
  displayName?: string;
  peers: ReadonlyArray<{ channel: RelayChannel; peerId: string }>;
  createdAt: string;
  updatedAt: string;
}

/** One delivery-log row (inbound ingested or outbound delivered/queued). */
export interface DeliveryLogRecord {
  logId: string;
  tenantId: string;
  relayId?: string;
  channel: RelayChannel;
  direction: 'inbound' | 'outbound';
  conversationId: string;
  status: string;
  detail?: string;
  at: string;
}

/**
 * One turn in a messaging conversation thread — inbound user message or the
 * assistant reply produced by the bound workflow/agent. Threaded into the
 * next inbound run's `messages[]` so messaging gets chat-style continuity.
 */
export interface MessagingTurnRecord {
  turnId: string;
  sessionKey: string;
  tenantId: string;
  role: 'user' | 'assistant';
  content: string;
  /** The run (or agent dispatch) that produced an assistant turn. */
  runId?: string;
  at: string;
}

/**
 * A pending pairing request: an unknown peer messaged a `dmPolicy: 'pairing'`
 * connector and the host minted a short code for an operator to approve.
 * Code-keyed within `(connectorId, code)`; one row per (connector, peer).
 */
export interface MessagingPairingRecord {
  pairingId: string;
  connectorId: string;
  tenantId: string;
  channel: RelayChannel;
  peerId: string;
  code: string;
  /** ISO8601 — pairing requests are short-lived (default 1h) to bound the surface. */
  expiresAt: string;
  createdAt: string;
}

/**
 * An approved (connector, channel, peer) the host MAY deliver to / receive
 * from when the connector's dm/group policy is `allowlist` or `pairing`.
 */
export interface MessagingAllowlistEntry {
  entryId: string;
  connectorId: string;
  tenantId: string;
  channel: RelayChannel;
  peerId: string;
  addedAt: string;
}

/**
 * The inbound → run bridge seam. Injected from index.ts where the run
 * pipeline is available. When absent, inbound is recorded but no run created.
 */
export interface MessagingBridge {
  onInbound(params: {
    device: { relayId: string; tenantId: string; channel: RelayChannel };
    envelope: ChatIngressEnvelope;
    sessionKey: string;
  }): Promise<{ runId?: string } | void>;
}
