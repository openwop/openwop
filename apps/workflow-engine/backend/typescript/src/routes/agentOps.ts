/**
 * Agent operations — host-extension routes (sample-grade, non-normative).
 *
 * Two demo-experience surfaces (PRD §14, §17):
 *   POST /v1/host/sample/demo/seed            — idempotently seed all built-in
 *                                                demo domains for the caller's
 *                                                tenant ("Load demo data")
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
 * @see src/host/seedEverything.ts — the idempotent seed orchestrator
 * @see src/host/runStarter.ts — the shared run dispatch
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Storage } from '../storage/storage.js';
import { seedEverything } from '../host/seedEverything.js';
import { SHOWCASE_TENANT } from '../host/workforceService.js';
import { createLogger } from '../observability/logger.js';
import { getRosterEntry } from '../host/rosterService.js';
import { runHeartbeatOnce } from '../host/heartbeatService.js';
import { projectAgentActivity } from '../host/agentActivity.js';

const log = createLogger('routes.agentOps');

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

export function registerAgentOpsRoutes(app: Express, deps: Deps): void {
  // "Load demo data" — idempotent per-tenant seed across registered domains.
  app.post('/v1/host/sample/demo/seed', async (req, res, next) => {
    try {
      // `heal: true` = the EXPLICIT "Load demo data" action — restores missing
      // boards/schedules/chart for existing personas. The silent auto-seed on
      // page entry omits it, so it can never resurrect deliberate deletions.
      const heal = (req.body as { heal?: unknown } | undefined)?.heal === true;
      const result = await seedEverything(tenantOf(req), deps.storage, { heal });
      // Always-on demo, tied to this same reseed button: a heal reseed also
      // (re)populates the read-only `__showcase__` tenant that the workforce
      // dashboards fall back to (see routes/workforces.ts dashboardRuns), so every
      // visitor sees populated telemetry without a per-visitor seed. Best-effort +
      // idempotent — a showcase failure must never fail the caller's reseed.
      if (heal && tenantOf(req) !== SHOWCASE_TENANT) {
        try {
          await seedEverything(SHOWCASE_TENANT, deps.storage, { heal: true });
        } catch (err) {
          log.warn('showcase_seed_failed', { reason: err instanceof Error ? err.message : String(err) });
        }
      }
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
      // Indexed lookup (agent_run_activity → runs join) — no recent-run scan, so
      // no truncation ceiling. The projector still derives source/persona/etc.
      const runs = await deps.storage.listAgentRunActivity({ tenantId, rosterId: entry.rosterId, status: optionalStatus, limit });
      const items = projectAgentActivity(runs, {}).slice(0, limit);
      res.status(200).json({ rosterId: entry.rosterId, items, truncated: false });
    } catch (err) {
      next(err);
    }
  });

  // Fleet-wide activity feed — recent agent-attributed runs across the whole
  // roster, each carrying its rosterId/persona so the dashboard can show a
  // single timeline + a failures view (`?status=failed`). Backed by the
  // attribution index (no recent-run scan). Optional `?rosterId=` narrows to one
  // member without the path param.
  app.get('/v1/host/sample/fleet/activity', async (req, res, next) => {
    try {
      const tenantId = tenantOf(req);
      const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const rosterId = typeof req.query.rosterId === 'string' ? req.query.rosterId : undefined;
      const runs = await deps.storage.listAgentRunActivity({ tenantId, status, rosterId, limit });
      const items = projectAgentActivity(runs, {}).slice(0, limit);
      res.status(200).json({ items, truncated: false });
    } catch (err) {
      next(err);
    }
  });
}
