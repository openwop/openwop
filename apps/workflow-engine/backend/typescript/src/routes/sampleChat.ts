/**
 * Sample-extension chat-session history routes (Phase 2C.1).
 *
 *   GET    /v1/host/sample/chat/sessions               — list (tenant-scoped, latest first)
 *   POST   /v1/host/sample/chat/sessions               — { title? } → 201 { sessionId, title, ... }
 *   GET    /v1/host/sample/chat/sessions/:id           — full session header
 *   PATCH  /v1/host/sample/chat/sessions/:id           — { title } → 200 updated
 *   DELETE /v1/host/sample/chat/sessions/:id           — 204, cascade deletes messages
 *   GET    /v1/host/sample/chat/sessions/:id/messages  — full message thread
 *   POST   /v1/host/sample/chat/sessions/:id/messages  — { messageId, role, content, meta? } → 201
 *
 * Namespace: these routes live under `/v1/host/sample/*` per
 * `spec/v1/host-extensions.md` §"Canonical prefixes" — they are NOT
 * part of the OpenWOP v1 wire contract.
 *
 * Storage: backed by `chat_sessions` + `chat_messages` (sqlite v7 /
 * postgres v5 migrations). Tenant-scoped: each session belongs to one
 * tenant (the `tenantId` from the auth middleware). Sample-grade — no
 * per-user concept beyond tenant.
 *
 * Auth: every route requires a valid Bearer token / session cookie
 * (handled by the global auth middleware). Bearer-authed callers
 * (`tenants: ['*']`) use the `_anon` tenant bucket so legacy unauth
 * sample probes still group consistently.
 */

import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { OpenwopError } from '../types.js';
import type { Storage } from '../storage/storage.js';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_TITLE_BYTES = 256;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_META_BYTES = 64 * 1024;

function tenantFromReq(req: Request): string {
  // Auth middleware sets req.tenantId on session-cookied requests.
  // Bearer-authed sample probes have tenants: ['*'] but no req.tenantId
  // — bucket them under `_anon` so they don't trample real sessions.
  return req.tenantId ?? '_anon';
}

interface CreateSessionRequest {
  title?: unknown;
  /** Optional client-chosen id. Must match `[A-Za-z0-9_-]{1,64}`;
   *  defaults to a fresh UUID when omitted. */
  sessionId?: unknown;
}

interface PatchSessionRequest {
  title?: unknown;
}

interface AppendMessageRequest {
  messageId?: unknown;
  role?: unknown;
  content?: unknown;
  meta?: unknown;
}

const VALID_ROLES = ['user', 'assistant', 'system', 'workflow_run'] as const;

export function registerSampleChatRoutes(app: Express, deps: { storage: Storage }): void {
  const { storage } = deps;

  // ── sessions collection ────────────────────────────────────────────
  app.get('/v1/host/sample/chat/sessions', async (req, res, next) => {
    try {
      const sessions = await storage.listChatSessions(tenantFromReq(req));
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/chat/sessions', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as CreateSessionRequest;
      if (typeof body !== 'object' || body === null) {
        throw new OpenwopError('validation_error', 'Request body MUST be a JSON object.', 400);
      }

      let sessionId: string;
      if (body.sessionId !== undefined) {
        if (typeof body.sessionId !== 'string' || !ID_PATTERN.test(body.sessionId)) {
          throw new OpenwopError(
            'validation_error',
            'sessionId MUST match /^[A-Za-z0-9_-]{1,64}$/.',
            400,
          );
        }
        sessionId = body.sessionId;
      } else {
        sessionId = randomUUID();
      }

      let title = 'New chat';
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || body.title.length === 0) {
          throw new OpenwopError('validation_error', 'title MUST be a non-empty string when present.', 400);
        }
        if (Buffer.byteLength(body.title, 'utf8') > MAX_TITLE_BYTES) {
          throw new OpenwopError('validation_error', `title MUST be ${MAX_TITLE_BYTES} bytes or fewer.`, 400);
        }
        title = body.title;
      }

      const now = new Date().toISOString();
      const tenantId = tenantFromReq(req);
      try {
        await storage.createChatSession({
          sessionId,
          tenantId,
          title,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
        });
      } catch (err) {
        // Treat unique-violation as a 409 so the FE can surface "id
        // already taken" instead of a 500.
        const code = (err as { code?: string }).code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === '23505') {
          throw new OpenwopError(
            'idempotency_key_conflict',
            `chat_session "${sessionId}" already exists.`,
            409,
          );
        }
        throw err;
      }

      res.status(201).json({
        sessionId,
        tenantId,
        title,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── session item ───────────────────────────────────────────────────
  app.get('/v1/host/sample/chat/sessions/:sessionId', async (req, res, next) => {
    try {
      const tenantId = tenantFromReq(req);
      const session = await storage.getChatSession(tenantId, req.params.sessionId);
      if (!session) {
        throw new OpenwopError('not_found', `chat_session "${req.params.sessionId}" not found.`, 404);
      }
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/chat/sessions/:sessionId', async (req, res, next) => {
    try {
      const tenantId = tenantFromReq(req);
      const existing = await storage.getChatSession(tenantId, req.params.sessionId);
      if (!existing) {
        throw new OpenwopError('not_found', `chat_session "${req.params.sessionId}" not found.`, 404);
      }
      const body = (req.body ?? {}) as PatchSessionRequest;
      if (typeof body !== 'object' || body === null) {
        throw new OpenwopError('validation_error', 'Request body MUST be a JSON object.', 400);
      }
      const patch: { title?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || body.title.length === 0) {
          throw new OpenwopError('validation_error', 'title MUST be a non-empty string when present.', 400);
        }
        if (Buffer.byteLength(body.title, 'utf8') > MAX_TITLE_BYTES) {
          throw new OpenwopError('validation_error', `title MUST be ${MAX_TITLE_BYTES} bytes or fewer.`, 400);
        }
        patch.title = body.title;
      }
      await storage.updateChatSession(tenantId, req.params.sessionId, patch);
      const updated = await storage.getChatSession(tenantId, req.params.sessionId);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/chat/sessions/:sessionId', async (req, res, next) => {
    try {
      const tenantId = tenantFromReq(req);
      const removed = await storage.deleteChatSession(tenantId, req.params.sessionId);
      if (!removed) {
        throw new OpenwopError('not_found', `chat_session "${req.params.sessionId}" not found.`, 404);
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ── messages sub-collection ────────────────────────────────────────
  app.get('/v1/host/sample/chat/sessions/:sessionId/messages', async (req, res, next) => {
    try {
      const tenantId = tenantFromReq(req);
      const session = await storage.getChatSession(tenantId, req.params.sessionId);
      if (!session) {
        throw new OpenwopError('not_found', `chat_session "${req.params.sessionId}" not found.`, 404);
      }
      const messages = await storage.listChatSessionMessages(req.params.sessionId);
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/chat/sessions/:sessionId/messages', async (req, res, next) => {
    try {
      const tenantId = tenantFromReq(req);
      const session = await storage.getChatSession(tenantId, req.params.sessionId);
      if (!session) {
        throw new OpenwopError('not_found', `chat_session "${req.params.sessionId}" not found.`, 404);
      }
      const body = (req.body ?? {}) as AppendMessageRequest;
      if (typeof body !== 'object' || body === null) {
        throw new OpenwopError('validation_error', 'Request body MUST be a JSON object.', 400);
      }
      if (typeof body.messageId !== 'string' || !ID_PATTERN.test(body.messageId)) {
        throw new OpenwopError(
          'validation_error',
          'messageId MUST match /^[A-Za-z0-9_-]{1,64}$/.',
          400,
        );
      }
      if (typeof body.role !== 'string' || !VALID_ROLES.includes(body.role as (typeof VALID_ROLES)[number])) {
        throw new OpenwopError(
          'validation_error',
          `role MUST be one of: ${VALID_ROLES.join(', ')}.`,
          400,
        );
      }
      if (typeof body.content !== 'string') {
        throw new OpenwopError('validation_error', 'content MUST be a JSON string.', 400);
      }
      if (Buffer.byteLength(body.content, 'utf8') > MAX_CONTENT_BYTES) {
        throw new OpenwopError('validation_error', `content MUST be ${MAX_CONTENT_BYTES} bytes or fewer.`, 400);
      }
      let metaStr: string | null = null;
      if (body.meta !== undefined && body.meta !== null) {
        if (typeof body.meta !== 'string') {
          throw new OpenwopError('validation_error', 'meta MUST be a JSON string when present.', 400);
        }
        if (Buffer.byteLength(body.meta, 'utf8') > MAX_META_BYTES) {
          throw new OpenwopError('validation_error', `meta MUST be ${MAX_META_BYTES} bytes or fewer.`, 400);
        }
        metaStr = body.meta;
      }

      const now = new Date().toISOString();
      try {
        // `appendChatMessage` atomically bumps the parent session's
        // `message_count` + `updated_at` in the same transaction so
        // concurrent appends don't lose increments. Previously the
        // route did read-then-write on `session.messageCount`, which
        // raced under load.
        await storage.appendChatMessage({
          messageId: body.messageId,
          sessionId: req.params.sessionId,
          role: body.role as (typeof VALID_ROLES)[number],
          content: body.content,
          meta: metaStr,
          createdAt: now,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === '23505') {
          throw new OpenwopError(
            'idempotency_key_conflict',
            `chat_message "${body.messageId}" already exists.`,
            409,
          );
        }
        throw err;
      }

      res.status(201).json({
        messageId: body.messageId,
        sessionId: req.params.sessionId,
        role: body.role,
        content: body.content,
        meta: metaStr,
        createdAt: now,
      });
    } catch (err) {
      next(err);
    }
  });
}
