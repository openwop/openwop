/**
 * `ctx.chat` host surface (`host.chat`, `spec/v1/host-capabilities.md`
 * §host.chat) — bridges the `vendor.myndhyve.chat` pack to the demo's REAL chat
 * store (the `Storage` chat tables the `/v1/host/sample/chat` routes + the SPA
 * read/write). A message a workflow sends with `core.chat.sendMessage` shows up
 * in the same chat session the UI renders.
 *
 * The main app `Storage` isn't a module singleton (unlike the host-ext stores),
 * so it's injected once at boot via `setChatStorage()` from `createApp`.
 *
 * Scope note: the three chat *gate* nodes (phaseInputGate/approvalGate/
 * clarificationGate) call `ctx.suspend()` — a suspend/resume method the sample
 * host does not implement — so they remain non-functional regardless of
 * host.chat. This surface covers the three `ctx.chat.*` nodes: sendMessage,
 * progressCard (emitCard), updateCard.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../observability/logger.js';
import type { BundleScope } from './inMemorySurfaces.js';
import type { Storage } from '../storage/storage.js';

const log = createLogger('host.chat');

let _storage: Storage | null = null;
/** Injected once from createApp after the app Storage is opened. */
export function setChatStorage(storage: Storage): void {
  _storage = storage;
}

type StorageRole = 'user' | 'assistant' | 'system' | 'workflow_run';
function mapRole(role: unknown): StorageRole {
  // The pack speaks 'agent' | 'user' | 'system'; the store/UI use
  // 'assistant' for an agent turn.
  if (role === 'user' || role === 'system') return role;
  if (role === 'workflow_run' || role === 'assistant') return role;
  return 'assistant';
}

/** Deterministic, pattern-valid (/^[A-Za-z0-9_-]{1,64}$/) message id from the
 *  pack's idempotencyKey, so a re-run produces the same id → the append's
 *  duplicate-key rejection makes sendMessage idempotent. */
function messageIdFrom(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 64);
}

interface ChatCard { cardId: string; cardType: string; payload: Record<string, unknown>; emittedAt: string; updatedAt: string }
// In-process card store (emitCard/updateCard). The chat MESSAGE stream is
// durable via Storage; the card index is demo-grade in-process.
const _cards = new Map<string, ChatCard>();

export interface ChatSurface {
  sendMessage(args: { role?: string; content: string; citations?: unknown; sessionId?: string; idempotencyKey: string }): Promise<{ messageId: string; sentAt: string }>;
  emitCard(args: { cardId: string; cardType: string; payload: Record<string, unknown>; idempotencyKey: string }): Promise<{ cardId: string; emittedAt: string }>;
  updateCard(args: { cardId: string; patch: Record<string, unknown>; patchType?: 'merge' | 'replace'; idempotencyKey: string }): Promise<{ cardId: string; updatedAt: string; found: boolean }>;
}

function requireStorage(): Storage {
  if (!_storage) throw Object.assign(new Error('host.chat storage not initialized'), { code: 'host_capability_missing' });
  return _storage;
}

export function createChatSurface(scope: BundleScope): ChatSurface {
  const tenantId = scope.tenantId;
  const cardKey = (cardId: string): string => `${tenantId}::${cardId}`;

  /** Ensure a chat session exists, creating a per-run default when the pack
   *  omits sessionId. */
  async function ensureSession(storage: Storage, sessionId: string, now: string): Promise<void> {
    const existing = await storage.getChatSession(tenantId, sessionId);
    if (existing) return;
    await storage.createChatSession({ sessionId, tenantId, title: 'Workflow activity', createdAt: now, updatedAt: now, messageCount: 0 });
  }

  /** Append a UI-renderable message. `content` is stored as the JSON-encoded
   *  ChatMessage-minus-id the SPA round-trips via `JSON.parse(content)`. */
  async function append(storage: Storage, sessionId: string, role: StorageRole, text: string, messageId: string, meta: string | null, now: string): Promise<void> {
    await ensureSession(storage, sessionId, now);
    const content = JSON.stringify({ role, content: text, ...(meta ? { meta: JSON.parse(meta) } : {}) });
    try {
      await storage.appendChatMessage({ messageId, sessionId, role, content, meta, createdAt: now });
    } catch (err) {
      // Duplicate messageId (deterministic from idempotencyKey) → idempotent
      // replay; swallow. Mirrors the route's duplicate detection across sqlite
      // (UNIQUE/PRIMARYKEY) and Postgres (23505). Anything else re-throws.
      const code = (err as { code?: string } | null)?.code ?? '';
      const msg = String((err as Error | null)?.message ?? '');
      const isDuplicate =
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === '23505' ||
        /unique constraint|already exists/i.test(msg);
      if (!isDuplicate) throw err;
    }
  }

  return {
    async sendMessage({ role, content, citations, sessionId, idempotencyKey }) {
      const storage = requireStorage();
      const now = new Date().toISOString();
      const sid = sessionId ?? `workflow-${tenantId}`;
      const messageId = messageIdFrom(idempotencyKey);
      const meta = citations !== undefined ? JSON.stringify({ citations }) : null;
      await append(storage, sid, mapRole(role), content, messageId, meta, now);
      return { messageId, sentAt: now };
    },

    async emitCard({ cardId, cardType, payload, idempotencyKey }) {
      const storage = requireStorage();
      const now = new Date().toISOString();
      _cards.set(cardKey(cardId), { cardId, cardType, payload, emittedAt: now, updatedAt: now });
      // Surface a visible workflow_run bubble so the card's existence shows in
      // the session stream (the structured payload lives in the card store).
      const sid = `workflow-${tenantId}`;
      await append(storage, sid, 'workflow_run', `[${cardType}] ${cardId}`, messageIdFrom(`card:${idempotencyKey}`), JSON.stringify({ card: { cardId, cardType, payload } }), now);
      log.info('chat card emitted', { cardId, cardType });
      return { cardId, emittedAt: now };
    },

    async updateCard({ cardId, patch, patchType = 'merge' }) {
      const now = new Date().toISOString();
      const existing = _cards.get(cardKey(cardId));
      if (!existing) return { cardId, updatedAt: now, found: false };
      existing.payload = patchType === 'replace' ? { ...patch } : { ...existing.payload, ...patch };
      existing.updatedAt = now;
      return { cardId, updatedAt: now, found: true };
    },
  };
}

export function _clearChatCardsForTest(): void { _cards.clear(); }
