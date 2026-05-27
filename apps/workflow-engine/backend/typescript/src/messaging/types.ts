/**
 * Shared types for the demo messaging relay-gateway (NON-normative,
 * sample-extension). Kept dependency-free so both the Storage layer and the
 * route handlers can import them without a cycle (routes → storage → types).
 */

export const RELAY_CHANNELS = ['whatsapp', 'signal', 'imessage'] as const;
export type RelayChannel = (typeof RELAY_CHANNELS)[number];

/** Canonical inbound envelope (platform → host). Request-shaped, not stored as-is. */
export interface ChatIngressEnvelope {
  channel: RelayChannel;
  platformMessageId: string;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  text: string;
  media?: ReadonlyArray<{ url: string; mimeType?: string }>;
  timestamp: string;
}

/** Canonical outbound envelope (host → platform). Persisted in the outbound queue. */
export interface ChatEgressEnvelope {
  egressId: string;
  relayId: string;
  channel: RelayChannel;
  conversationId: string;
  text: string;
  media?: ReadonlyArray<{ url: string; mimeType?: string }>;
  replyToMessageId?: string;
  enqueuedAt: string;
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
