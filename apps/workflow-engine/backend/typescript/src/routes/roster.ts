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

export function registerRosterRoutes(app: Express): void {
  app.get('/v1/host/sample/roster', (req, res) => {
    res.json({ roster: listRoster(tenantOf(req)) });
  });

  app.post('/v1/host/sample/roster', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        persona?: unknown;
        agentRef?: unknown;
        workflows?: unknown;
        label?: unknown;
        description?: unknown;
        enabled?: unknown;
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
      const entry = createRosterEntry({
        tenantId: tenantOf(req),
        persona: body.persona,
        agentRef,
        workflows: Array.isArray(body.workflows) ? body.workflows.filter((w): w is string => typeof w === 'string') : undefined,
        label: typeof body.label === 'string' ? body.label : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      });
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/roster/:rosterId', (req, res, next) => {
    try {
      const entry = getRosterEntry(req.params.rosterId);
      if (!entry || entry.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Roster entry not found.', 404, { rosterId: req.params.rosterId });
      }
      res.json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/roster/:rosterId', (req, res, next) => {
    try {
      const existing = getRosterEntry(req.params.rosterId);
      if (!existing || existing.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Roster entry not found.', 404, { rosterId: req.params.rosterId });
      }
      const body = (req.body ?? {}) as {
        persona?: unknown;
        workflows?: unknown;
        enabled?: unknown;
        label?: unknown;
        description?: unknown;
      };
      if (body.workflows !== undefined && !Array.isArray(body.workflows)) {
        throw new OpenwopError('validation_error', 'Field `workflows` MUST be an array of workflow ids.', 400, {
          field: 'workflows',
        });
      }
      const updated = updateRosterEntry(req.params.rosterId, {
        persona: typeof body.persona === 'string' ? body.persona : undefined,
        workflows: Array.isArray(body.workflows) ? body.workflows.filter((w): w is string => typeof w === 'string') : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        label: typeof body.label === 'string' ? body.label : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/roster/:rosterId', (req, res, next) => {
    try {
      const entry = getRosterEntry(req.params.rosterId);
      if (!entry || entry.tenantId !== tenantOf(req)) {
        throw new OpenwopError('not_found', 'Roster entry not found.', 404, { rosterId: req.params.rosterId });
      }
      deleteRosterEntry(entry.rosterId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
