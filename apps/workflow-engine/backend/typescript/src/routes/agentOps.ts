/**
 * Agent operations — host-extension routes (sample-grade, non-normative).
 *
 * Two demo-experience surfaces (PRD §14, §17):
 *   POST /v1/host/sample/demo/seed            — idempotently seed the built-in
 *                                                demo agents for the caller's
 *                                                tenant ("Load demo agents")
 *   POST /v1/host/sample/roster/{rosterId}/check
 *                                              — the agent "heartbeat": pick the
 *                                                first eligible To Do card on the
 *                                                agent's board and start its
 *                                                workflow ("Check now")
 *
 * The heartbeat is an MVP pull model (PRD §14): a manual/poll "check now" that
 * claims the first To Do card carrying a resolvable workflow, starts a run
 * attributed to the named agent, and moves the card to Working. A real
 * background daemon (claim cadence, concurrency, dead-letter) is deferred.
 *
 * @see src/host/demoSeed.ts — the idempotent seed
 * @see src/host/runStarter.ts — the shared run dispatch
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Storage } from '../storage/storage.js';
import { seedDemoAgents } from '../host/demoSeed.js';
import { getRosterEntry } from '../host/rosterService.js';
import { runHeartbeatOnce } from '../host/heartbeatService.js';
import { projectAgentActivity } from '../host/agentActivity.js';

/** Bound the per-tenant run scan that backs the in-memory attribution filter
 *  (the runs store has no per-roster/agent index). `truncated` is reported when
 *  hit so the UI never implies "no older activity". */
const ACTIVITY_SCAN_LIMIT = 500;

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

export function registerAgentOpsRoutes(app: Express, deps: Deps): void {
  // "Load demo agents" — idempotent per-tenant seed.
  app.post('/v1/host/sample/demo/seed', async (req, res, next) => {
    try {
      const result = await seedDemoAgents(tenantOf(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Agent heartbeat "Check now" — claim the first eligible To Do card and run it.
  app.post('/v1/host/sample/roster/:rosterId/check', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const entry = await getRosterEntry(req.params.rosterId);
      if (!entry || entry.tenantId !== tenantId) {
        throw new OpenwopError('not_found', 'Agent not found.', 404, { rosterId: req.params.rosterId });
      }
      if (!entry.enabled) {
        res.status(200).json({ picked: false, reason: 'paused' });
        return;
      }

      // Shared with the autonomous heartbeat daemon so the two can't drift —
      // including the review-mode "agents propose, humans dispose" branch.
      const result = await runHeartbeatOnce(deps, entry);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Per-agent activity feed — recent runs attributed to this agent (heartbeat
  // pick-ups, schedule fires, board-card triggers), each with a real timestamp,
  // outcome, and links. Derived from the durable runs store, so it carries the
  // run status + completion time the board-state-derived fleet feed can't.
  app.get('/v1/host/sample/roster/:rosterId/activity', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const entry = await getRosterEntry(req.params.rosterId);
      if (!entry || entry.tenantId !== tenantId) {
        throw new OpenwopError('not_found', 'Agent not found.', 404, { rosterId: req.params.rosterId });
      }
      const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '25'), 10) || 25));
      const optionalStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
      const runs = await deps.storage.listRuns({ tenantId, limit: ACTIVITY_SCAN_LIMIT });
      const truncated = runs.length >= ACTIVITY_SCAN_LIMIT;
      const items = projectAgentActivity(runs, { rosterId: entry.rosterId, status: optionalStatus }).slice(0, limit);
      res.status(200).json({ rosterId: entry.rosterId, items, truncated });
    } catch (err) {
      next(err);
    }
  });

  // Fleet-wide activity feed — recent agent-attributed runs across the whole
  // roster, each carrying its rosterId/persona so the dashboard can show a
  // single timeline + a failures view (`?status=failed`). Same scan-and-filter
  // posture + honest `truncated` as the per-agent feed. Optional `?rosterId=`
  // narrows to one member without the path param.
  app.get('/v1/host/sample/fleet/activity', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const rosterId = typeof req.query.rosterId === 'string' ? req.query.rosterId : undefined;
      const runs = await deps.storage.listRuns({ tenantId, limit: ACTIVITY_SCAN_LIMIT });
      const truncated = runs.length >= ACTIVITY_SCAN_LIMIT;
      const items = projectAgentActivity(runs, { status, rosterId }).slice(0, limit);
      res.status(200).json({ items, truncated });
    } catch (err) {
      next(err);
    }
  });
}
