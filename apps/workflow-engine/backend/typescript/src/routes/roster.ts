/**
 * Standing agent roster — host-extension routes (sample-grade, non-normative).
 *
 * The reference implementation of RFCS/0086 §B (roster discovery). Surface
 * under `/v1/host/sample/roster`:
 *   GET    /                     list the caller's roster (tenant-scoped)
 *   POST   /                     create a named agent (persona + agentRef + workflows[])
 *   GET    /:rosterId            one entry
 *   PATCH  /:rosterId            update persona / portfolio / enabled
 *   DELETE /:rosterId            remove
 *
 * The run attribution (RFC 0086 §C) lives in routes/kanban.ts: a board
 * bound to a `rosterId` attributes its card→run triggers to the member.
 * Tenant-scoped per entry ownership (the RFC 0074 carry-forward) — a caller
 * only sees + mutates its own roster.
 *
 * @see src/host/rosterService.ts
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md §A/§B
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import {
  createRosterEntry,
  deleteRosterEntry,
  getRosterEntry,
  listRoster,
  updateRosterEntry,
  type RosterAgentRef,
} from '../host/rosterService.js';

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

function parseAgentRef(value: unknown): RosterAgentRef {
  if (!value || typeof value !== 'object') {
    throw new OpenwopError('validation_error', 'Field `agentRef` is required and MUST be an object.', 400, {
      field: 'agentRef',
    });
  }
  const ref = value as { agentId?: unknown; version?: unknown; channel?: unknown };
  if (typeof ref.agentId !== 'string' || ref.agentId.length === 0) {
    throw new OpenwopError('validation_error', 'Field `agentRef.agentId` is required and MUST be a non-empty string.', 400, {
      field: 'agentRef.agentId',
    });
  }
  if (ref.version !== undefined && ref.channel !== undefined) {
    // RFC 0082 §A: version XOR channel.
    throw new OpenwopError('validation_error', '`agentRef.version` and `agentRef.channel` are mutually exclusive.', 400, {
      field: 'agentRef',
    });
  }
  return {
    agentId: ref.agentId,
    version: typeof ref.version === 'string' ? ref.version : undefined,
    channel: typeof ref.channel === 'string' ? ref.channel : undefined,
  };
}

/** Max length of the stored `avatarUrl` data-URI string. The editor exports a
 *  256×256 JPEG (~20–60 KB ⇒ ~30–80 KB base64); 700 KB leaves generous head-
 *  room (~512 KB decoded) while keeping the durable roster row small and
 *  refusing oversized uploads. */
const AVATAR_URL_MAX_LEN = 700_000;
const AVATAR_DATA_URI_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Parse + validate the optional `avatarUrl` field shared by POST + PATCH.
 *  Returns `undefined` (no change / omit), `null` (clear), or the validated
 *  data-URI string. Only inline `data:image/*;base64` URIs are accepted — no
 *  remote URLs, so the host never fetches caller-controlled origins (SSRF) and
 *  the bytes are self-contained on the durable row. */
function parseAvatarUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new OpenwopError('validation_error', 'Field `avatarUrl` MUST be a string, null, or omitted.', 400, {
      field: 'avatarUrl',
    });
  }
  if (value.length > AVATAR_URL_MAX_LEN) {
    throw new OpenwopError(
      'validation_error',
      `Field \`avatarUrl\` exceeds the ${AVATAR_URL_MAX_LEN}-character limit. Crop or shrink the image.`,
      400,
      { field: 'avatarUrl', maxLength: AVATAR_URL_MAX_LEN },
    );
  }
  if (!AVATAR_DATA_URI_RE.test(value)) {
    throw new OpenwopError(
      'validation_error',
      'Field `avatarUrl` MUST be a `data:image/(png|jpeg|webp);base64,…` URI.',
      400,
      { field: 'avatarUrl' },
    );
  }
  return value;
}

/** Validate the optional `autonomyLevel` field (POST + PATCH). `undefined`
 *  leaves it unchanged; only `'auto'` / `'review'` are accepted. */
function parseAutonomyLevel(value: unknown): 'auto' | 'guided' | 'review' | undefined {
  if (value === undefined) return undefined;
  if (value === 'auto' || value === 'guided' || value === 'review') return value;
  throw new OpenwopError('validation_error', 'Field `autonomyLevel` MUST be "auto", "guided", or "review".', 400, {
    field: 'autonomyLevel',
    allowed: ['auto', 'guided', 'review'],
  });
}

export function registerRosterRoutes(app: Express): void {
  app.get('/v1/host/sample/roster', async (req, res, next) => {
    try {
      res.json({ roster: await listRoster(tenantOf(req)) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/roster', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        persona?: unknown;
        agentRef?: unknown;
        workflows?: unknown;
        label?: unknown;
        description?: unknown;
        enabled?: unknown;
        avatarUrl?: unknown;
        autonomyLevel?: unknown;
      };
      if (typeof body.persona !== 'string' || body.persona.trim().length === 0) {
        throw new OpenwopError('validation_error', 'Field `persona` is required and MUST be a non-empty string.', 400, {
          field: 'persona',
        });
      }
      const agentRef = parseAgentRef(body.agentRef);
      if (body.workflows !== undefined && !Array.isArray(body.workflows)) {
        throw new OpenwopError('validation_error', 'Field `workflows` MUST be an array of workflow ids.', 400, {
          field: 'workflows',
        });
      }
      // On create, a `null`/clear is meaningless (there's nothing to clear yet)
      // — coalesce to undefined so the new row simply has no photo.
      const avatarUrl = parseAvatarUrl(body.avatarUrl) ?? undefined;
      const entry = await createRosterEntry({
        tenantId: tenantOf(req),
        persona: body.persona,
        agentRef,
        workflows: Array.isArray(body.workflows) ? body.workflows.filter((w): w is string => typeof w === 'string') : undefined,
        label: typeof body.label === 'string' ? body.label : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        avatarUrl,
        autonomyLevel: parseAutonomyLevel(body.autonomyLevel),
      });
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/roster/:rosterId', async (req, res, next) => {
    try {
      const entry = await getRosterEntry(req.params.rosterId);
      if (!entry || entry.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Roster entry not found.', 404, { rosterId: req.params.rosterId });
      }
      res.json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/roster/:rosterId', async (req, res, next) => {
    try {
      const existing = await getRosterEntry(req.params.rosterId);
      if (!existing || existing.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Roster entry not found.', 404, { rosterId: req.params.rosterId });
      }
      const body = (req.body ?? {}) as {
        persona?: unknown;
        workflows?: unknown;
        enabled?: unknown;
        label?: unknown;
        description?: unknown;
        avatarUrl?: unknown;
        autonomyLevel?: unknown;
      };
      if (body.workflows !== undefined && !Array.isArray(body.workflows)) {
        throw new OpenwopError('validation_error', 'Field `workflows` MUST be an array of workflow ids.', 400, {
          field: 'workflows',
        });
      }
      const updated = await updateRosterEntry(req.params.rosterId, {
        persona: typeof body.persona === 'string' ? body.persona : undefined,
        workflows: Array.isArray(body.workflows) ? body.workflows.filter((w): w is string => typeof w === 'string') : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        label: typeof body.label === 'string' ? body.label : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        avatarUrl: parseAvatarUrl(body.avatarUrl),
        autonomyLevel: parseAutonomyLevel(body.autonomyLevel),
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/roster/:rosterId', async (req, res, next) => {
    try {
      const entry = await getRosterEntry(req.params.rosterId);
      if (!entry || entry.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Roster entry not found.', 404, { rosterId: req.params.rosterId });
      }
      await deleteRosterEntry(entry.rosterId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
