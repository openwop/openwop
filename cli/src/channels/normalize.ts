/**
 * Pure normalizers: platform-specific inbound payload → canonical
 * InboundMessage. These are the unit-test target for B4 — they isolate the
 * fiddly per-platform parsing from the I/O (spawn / sqlite / socket), so the
 * receive path is verifiable without a live platform.
 *
 * Each returns null for payloads that aren't deliverable inbound text
 * (receipts, typing indicators, our own outgoing echoes, empty bodies).
 */

import type { InboundMessage } from './types.js';

/**
 * signal-cli `receive --json` / JSON-RPC envelope. Shape (subset):
 *   { envelope: { source, sourceName, timestamp, dataMessage: { message, groupInfo? } } }
 * Group messages route on the groupId; DMs route on the source number.
 */
export function parseSignalEnvelope(raw: unknown): InboundMessage | null {
  const env = (raw as any)?.envelope ?? (raw as any)?.params?.envelope;
  if (!env || typeof env !== 'object') return null;
  const data = env.dataMessage;
  if (!data || typeof data.message !== 'string' || data.message.length === 0) return null;
  const source: string | undefined = env.source ?? env.sourceNumber ?? env.sourceUuid;
  if (!source) return null;
  const groupId: string | undefined = data.groupInfo?.groupId;
  const conversationId = groupId ? `group:${groupId}` : source;
  const ts = typeof env.timestamp === 'number' ? env.timestamp : Date.now();
  return {
    platformMessageId: `${source}:${env.timestamp ?? ts}`,
    conversationId,
    peerId: source,
    ...(typeof env.sourceName === 'string' && env.sourceName ? { peerDisplay: env.sourceName } : {}),
    text: data.message,
    timestamp: new Date(ts).toISOString(),
  };
}

/**
 * A macOS Messages `chat.db` row joined across message + handle + chat. We poll
 * by a monotonic ROWID cursor; this maps one row. `is_from_me=1` rows are our
 * own sends — skipped. Apple's `date` is ns since 2001-01-01; callers may pass
 * an already-ISO `dateUtc` instead (the poller computes it), preferred when set.
 */
export function parseImessageRow(row: Record<string, unknown>): InboundMessage | null {
  if (Number(row.is_from_me) === 1) return null;
  const text = typeof row.text === 'string' ? row.text : '';
  if (text.length === 0) return null;
  const handle = (row.handle_id_str ?? row.handle ?? row.sender) as string | undefined;
  if (!handle) return null;
  const chatGuid = (row.chat_guid ?? row.cache_roomnames) as string | undefined;
  const conversationId = chatGuid ? `chat:${chatGuid}` : handle;
  const timestamp = typeof row.dateUtc === 'string' && row.dateUtc
    ? row.dateUtc
    : appleNsToIso(row.date);
  const rowid = row.ROWID ?? row.rowid ?? row.message_id ?? `${handle}:${timestamp}`;
  return {
    platformMessageId: String(rowid),
    conversationId,
    peerId: handle,
    text,
    timestamp,
  };
}

/**
 * A Baileys `messages.upsert` message object (WhatsApp Web). Shape (subset):
 *   { key: { remoteJid, fromMe, id }, message: { conversation? | extendedTextMessage:{text} },
 *     pushName?, messageTimestamp? }
 */
export function parseWhatsappMessage(raw: unknown): InboundMessage | null {
  const m = raw as any;
  if (!m?.key || m.key.fromMe) return null;
  const remoteJid: string | undefined = m.key.remoteJid;
  if (!remoteJid) return null;
  const text: string | undefined =
    m.message?.conversation ?? m.message?.extendedTextMessage?.text;
  if (typeof text !== 'string' || text.length === 0) return null;
  const tsSec = Number(m.messageTimestamp ?? 0);
  const timestamp = tsSec > 0 ? new Date(tsSec * 1000).toISOString() : new Date().toISOString();
  // The peer is the participant in groups (remoteJid is the group), else remoteJid.
  const peerId: string = m.key.participant ?? remoteJid;
  return {
    platformMessageId: String(m.key.id ?? `${remoteJid}:${tsSec}`),
    conversationId: remoteJid,
    peerId,
    ...(typeof m.pushName === 'string' && m.pushName ? { peerDisplay: m.pushName } : {}),
    text,
    timestamp,
  };
}

/** Apple Core Data timestamp (ns since 2001-01-01 UTC) → ISO string. */
function appleNsToIso(raw: unknown): string {
  const ns = Number(raw);
  if (!Number.isFinite(ns) || ns <= 0) return new Date().toISOString();
  const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
  return new Date(APPLE_EPOCH_MS + ns / 1_000_000).toISOString();
}
