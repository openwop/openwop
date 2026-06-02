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

      // Shared with the autonomous heartbeat daemon so the two can't drift.
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
      // listRuns has no per-attribution filter, so we scan the most-recent tenant
      // runs and filter in memory. Bound the scan, but report when it was hit so
      // the UI can say "older activity may exist" rather than imply "none" — no
      // silent truncation. `truncated` ⇒ the agent could have older runs beyond
      // the scan window.
      const SCAN_LIMIT = 500;
      const runs = await deps.storage.listRuns({ tenantId, limit: SCAN_LIMIT });
      const truncated = runs.length >= SCAN_LIMIT;
      const items = runs
        .map((run) => {
          const md = (run.metadata ?? {}) as Record<string, unknown>;
          // A run carries one attribution block (heartbeat / schedule / kanban);
          // keep it only if that block names this roster member.
          const candidates: Array<{ source: string; block: Record<string, unknown> }> = [];
          for (const key of ['heartbeat', 'schedule', 'kanban'] as const) {
            const block = md[key];
            if (block && typeof block === 'object') candidates.push({ source: key, block: block as Record<string, unknown> });
          }
          const mine = candidates.find((c) => c.block.rosterId === entry.rosterId);
          if (!mine) return null;
          return {
            runId: run.runId,
            workflowId: run.workflowId,
            status: run.status,
            source: mine.source,
            cardId: typeof mine.block.cardId === 'string' ? mine.block.cardId : undefined,
            // Prefer the terminal time; fall back to last-update / creation.
            timestamp: run.completedAt ?? run.updatedAt ?? run.createdAt,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit);
      res.status(200).json({ rosterId: entry.rosterId, items, truncated });
    } catch (err) {
      next(err);
    }
  });
}
