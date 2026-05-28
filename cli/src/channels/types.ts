/**
 * Channel-plugin contract for the relay device (A4). A plugin owns one
 * platform connection and does two things: deliver outbound messages, and
 * (B4) stream inbound platform messages back as normalized envelopes.
 *
 * The platform boundary (signal-cli / chat.db / Baileys) is isolated behind
 * `startReceive` + the pure normalizers in `normalize.ts`, so the parsing +
 * forwarding logic is unit-testable without a live platform.
 */

export type RelayChannel = 'whatsapp' | 'signal' | 'imessage' | 'discord';

/** A media attachment carried in either direction. */
export interface ChannelAttachment {
  url: string;
  mimeType?: string;
  filename?: string;
}

/**
 * The kind of inbound event. Plain `message` is the default; the richer kinds
 * (envelope v2) let channels that support them carry reactions, edits, and
 * slash/quick-reply commands across the relay→host hop instead of flattening
 * everything to text. A host/workflow that only understands `message` can
 * branch on `kind` and ignore the rest.
 */
export type InboundKind = 'message' | 'reaction' | 'edit' | 'command';

/** Normalized inbound message — matches the host's /device/inbound body. */
export interface InboundMessage {
  platformMessageId: string;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  text: string;
  timestamp: string;
  media?: ChannelAttachment[];
  /** v2 (all optional, backward-compatible): */
  kind?: InboundKind;
  /** The message this one replies to / quotes (threading). */
  quotedMessageId?: string;
  /** For `kind:'reaction'` — the emoji + the message it reacts to. */
  reaction?: { emoji: string; targetMessageId: string };
  /** For `kind:'command'` — a slash/quick-reply command + raw args. */
  command?: { name: string; args?: string };
  /** Opaque per-channel metadata (guildId, threadId, etc.); never interpreted by the protocol. */
  channelMeta?: Record<string, unknown>;
}

/** An interactive component offered with an outbound message (e.g. quick-reply buttons). */
export interface OutboundComponent {
  id: string;
  label: string;
  /** 'reply' posts the id back as an inbound command; 'link' opens a URL. */
  style?: 'reply' | 'link';
  url?: string;
}

/** Outbound message handed to a plugin to deliver. */
export interface OutboundMessage {
  conversationId: string;
  text: string;
  replyToMessageId?: string;
  /** v2 (all optional, backward-compatible): */
  media?: ChannelAttachment[];
  /** Quick-reply / link buttons; channels that can't render them fall back to text. */
  components?: OutboundComponent[];
  /** Emoji to react with on `replyToMessageId` instead of sending a message. */
  reactions?: string[];
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
