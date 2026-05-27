/**
 * Channel-plugin contract for the relay device (A4). A plugin owns one
 * platform connection and does two things: deliver outbound messages, and
 * (B4) stream inbound platform messages back as normalized envelopes.
 *
 * The platform boundary (signal-cli / chat.db / Baileys) is isolated behind
 * `startReceive` + the pure normalizers in `normalize.ts`, so the parsing +
 * forwarding logic is unit-testable without a live platform.
 */

export type RelayChannel = 'whatsapp' | 'signal' | 'imessage';

/** Normalized inbound message — matches the host's /device/inbound body. */
export interface InboundMessage {
  platformMessageId: string;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  text: string;
  timestamp: string;
  media?: Array<{ url: string; mimeType?: string }>;
}

/** Outbound message handed to a plugin to deliver. */
export interface OutboundMessage {
  conversationId: string;
  text: string;
  replyToMessageId?: string;
}

export interface ChannelAvailability {
  channel: RelayChannel;
  available: boolean;
  detail: string;
}

export interface ChannelPlugin {
  channel: RelayChannel;
  /** Can this channel run on this host right now? (tooling/OS/deps present.) */
  isAvailable(env?: NodeJS.ProcessEnv): ChannelAvailability;
  /** Deliver one outbound message to the platform. Throws on failure. */
  deliver(msg: OutboundMessage): Promise<void>;
  /**
   * Start streaming inbound platform messages. Calls `onInbound` for each new
   * message; resolves to a stop function. Implementations MUST be resilient to
   * the platform tooling being absent (throw a clear error from here).
   */
  startReceive(
    onInbound: (msg: InboundMessage) => Promise<void>,
    opts?: { env?: NodeJS.ProcessEnv; signal?: AbortSignal },
  ): Promise<() => void>;
}
