/**
 * Agent heartbeat — shared logic + background daemon (RFC 0086, sample-grade).
 *
 * The heartbeat is the agent "pull": pick the first eligible To Do card on the
 * member's board(s) and start its workflow, attributing the run to the named
 * agent. `runHeartbeatOnce` is the single implementation used by BOTH the
 * manual "Check now" route (routes/agentOps.ts) and the background daemon, so
 * the two can never drift.
 *
 * Previously the heartbeat was manual-only (a "Check now" POST). The daemon
 * makes it autonomous for members that opt in via `heartbeatIntervalMs > 0`:
 * each instance polls, and a per-(roster, slot) `claimIdempotency` guard makes
 * the pull fire once across the max=10 fleet (same posture as scheduleDaemon).
 * Members with no interval set are untouched — manual pull only, as before.
 *
 * @see src/routes/agentOps.ts — the manual "Check now" surface
 * @see src/host/scheduleDaemon.ts — the sibling time-based daemon
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 */

import type { StartRunDeps } from './runStarter.js';
import { startWorkflowRun } from './runStarter.js';
import { listRoster, recordHeartbeat, autonomyOf, type RosterEntry } from './rosterService.js';
import { listBoards, listCards, moveCard, setCardLastRun, notifyBoardChanged } from './kanbanService.js';
import { createApproval, hasPendingApprovalForCard } from './approvalService.js';
import { checkAutonomousRunBudget } from './runBudgetService.js';
import { getInstanceId } from './instanceId.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('heartbeatService');

const POLL_INTERVAL_MS = 30_000;
/** Most members auto-checked per pass (backstop against a large fleet flooding
 *  the dispatcher in one tick). */
const CHECK_BATCH = 50;
/** Per-(roster, slot) claim keys are only needed for the concurrent-poll
 *  window; prune older ones each tick so the idempotency table stays bounded. */
const CLAIM_KEY_PREFIX = 'heartbeat:';
const CLAIM_PRUNE_AGE_MS = 10 * 60_000;

export interface HeartbeatResult {
  picked: boolean;
  reason?: 'paused' | 'no_eligible_tasks';
  boardId?: string;
  cardId?: string;
  cardTitle?: string;
  runId?: string;
  persona?: string;
  lastHeartbeatAt?: string;
  /** review-mode: the run was NOT started — a pending approval was queued. */
  proposed?: boolean;
  approvalId?: string;
}

/**
 * Run one heartbeat for an already-resolved, enabled roster member: stamp the
 * last-checked time, then claim the first To Do card carrying a runnable
 * workflow, start its run (attributed to the agent), and move it to Working.
 * Returns what was picked (or why nothing was). The caller is responsible for
 * tenant/existence checks and the `enabled` gate.
 */
export async function runHeartbeatOnce(deps: StartRunDeps, entry: RosterEntry): Promise<HeartbeatResult> {
  // The heartbeat ran — stamp "last checked" regardless of whether a card gets
  // picked up, so the UI can show how recently the agent looked.
  const heartbeatEntry = await recordHeartbeat(entry.rosterId);
  const lastHeartbeatAt = heartbeatEntry?.lastHeartbeatAt;

  const boards = (await listBoards(entry.tenantId)).filter((b) => b.rosterId === entry.rosterId);
  for (const board of boards) {
    const todoColumn = board.columns.find((c) => c.id === 'todo' || c.name.toLowerCase() === 'to do');
    if (!todoColumn) continue;
    const cards = (await listCards(board.id)).filter((c) => c.columnId === todoColumn.id);
    for (const card of cards) {
      const workflowId = card.workflowId ?? todoColumn.triggerWorkflowId;
      if (!workflowId) continue;

      // "Agents propose, humans dispose": a review-mode member doesn't start the
      // run — it queues a pending approval for a human to claim. Skip cards that
      // already have one so a re-poll (or the daemon) doesn't duplicate the
      // proposal (it sits in To Do until the approval is resolved). This lives in
      // the SHARED helper so the autonomous daemon honors review mode too, not
      // just the manual "Check now" route.
      // `review` proposes EVERY pick; `guided` proposes only HIGH-priority
      // picks (routine work runs itself, high-stakes work asks first —
      // architect memo 2026-06-05; the only middle level composable from
      // real fields: card.priority + the existing approval path).
      const autonomy = autonomyOf(entry);
      const mustPropose = autonomy === 'review'
        || (autonomy === 'guided' && card.priority === 'high');
      if (mustPropose) {
        if (await hasPendingApprovalForCard(entry.tenantId, card.id)) continue;
        const approval = await createApproval({
          tenantId: entry.tenantId,
          rosterId: entry.rosterId,
          persona: entry.persona,
          workflowId,
          boardId: board.id,
          cardId: card.id,
          cardTitle: card.title,
          proposal: `Run ${workflowId} on “${card.title}”`,
        });
        return {
          picked: true,
          proposed: true,
          approvalId: approval.approvalId,
          boardId: board.id,
          cardId: card.id,
          cardTitle: card.title,
          persona: entry.persona,
          lastHeartbeatAt,
        };
      }

      const runId = await startWorkflowRun(deps, {
        tenantId: entry.tenantId,
        workflowId,
        metadata: {
          heartbeat: {
            rosterId: entry.rosterId,
            persona: entry.persona,
            agentId: entry.agentRef.agentId,
            boardId: board.id,
            cardId: card.id,
            source: 'heartbeat',
          },
        },
      });
      if (!runId) continue;
      await setCardLastRun(card.id, runId);
      // Move the picked card to Working (no re-trigger — Working has no trigger
      // workflow). Best-effort: a missing Working lane leaves the card in To Do
      // with its run already started.
      const working = board.columns.find((c) => c.id === 'working' || c.name.toLowerCase() === 'working');
      if (working) await moveCard(card.id, working.id);
      notifyBoardChanged(board.id);
      return {
        picked: true,
        boardId: board.id,
        cardId: card.id,
        cardTitle: card.title,
        runId,
        persona: entry.persona,
        lastHeartbeatAt,
      };
    }
  }
  return { picked: false, reason: 'no_eligible_tasks', lastHeartbeatAt };
}

/** Whether a member is due for an autonomous heartbeat at `now`. Opt-in only
 *  (interval > 0); fires when it has never been checked or the interval elapsed
 *  since the last check. */
function isHeartbeatDue(entry: RosterEntry, now: number): boolean {
  if (!entry.enabled) return false;
  const interval = entry.heartbeatIntervalMs ?? 0;
  if (interval <= 0) return false;
  if (!entry.lastHeartbeatAt) return true;
  const last = Date.parse(entry.lastHeartbeatAt);
  if (Number.isNaN(last)) return true;
  return now - last >= interval;
}

/**
 * Run one autonomous-heartbeat pass across all tenants: every enabled member
 * with a positive `heartbeatIntervalMs` that is due gets its "Check now" run
 * once across the fleet (per-(roster, slot) claim). Returns the number this
 * instance ran. Exported for deterministic tests — pass a fixed `now`.
 *
 * `listTenants` enumerates tenant ids to scan (the roster store lists per
 * tenant). Injected so tests can scope it; the daemon derives it from the
 * roster store.
 */
export async function processDueHeartbeats(
  deps: StartRunDeps,
  listTenants: () => Promise<string[]>,
  now: number = Date.now(),
): Promise<number> {
  const tenants = await listTenants();
  const dueEntries: RosterEntry[] = [];
  for (const tenantId of tenants) {
    for (const entry of await listRoster(tenantId)) {
      if (isHeartbeatDue(entry, now)) dueEntries.push(entry);
    }
  }

  let ran = 0;
  for (const entry of dueEntries.slice(0, CHECK_BATCH)) {
    // Quantize to the interval so concurrent instances claim the same slot key.
    const interval = entry.heartbeatIntervalMs ?? POLL_INTERVAL_MS;
    const slot = Math.floor(now / interval);
    const claimKey = `${CLAIM_KEY_PREFIX}${entry.rosterId}:${slot}`;
    const claim = await deps.storage.claimIdempotency(claimKey, new Date(now).toISOString());
    if (!claim.claimed) continue; // another instance is running this slot
    // Autonomous-run budget: skip an auto-heartbeat that would exceed the
    // tenant's ceiling (manual "Check now" is never throttled). lastHeartbeatAt
    // isn't stamped, so it retries next window once budget frees.
    const budget = await checkAutonomousRunBudget(deps.storage, entry.tenantId, now);
    if (!budget.allowed) {
      log.warn('autonomous heartbeat skipped — tenant over run budget', {
        rosterId: entry.rosterId, tenantId: entry.tenantId, current: budget.current, limit: budget.limit,
      });
      continue;
    }
    try {
      const result = await runHeartbeatOnce(deps, entry);
      if (result.picked) {
        ran++;
        log.info('autonomous heartbeat picked a task', {
          rosterId: entry.rosterId,
          cardId: result.cardId,
          runId: result.runId,
        });
      }
    } catch (err) {
      log.error('autonomous heartbeat failed', {
        rosterId: entry.rosterId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return ran;
}

/** Delete this daemon's stale per-(roster, slot) claim keys so the idempotency
 *  table stays bounded. Best-effort. */
export async function pruneStaleHeartbeatClaims(deps: StartRunDeps, now: number = Date.now()): Promise<number> {
  try {
    return await deps.storage.pruneIdempotencyByPrefix(CLAIM_KEY_PREFIX, new Date(now - CLAIM_PRUNE_AGE_MS).toISOString());
  } catch (err) {
    log.warn('heartbeat claim prune failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

export interface HeartbeatDaemon {
  stop(): void;
}

/**
 * Start the polling heartbeat daemon. `listTenants` enumerates tenants with
 * roster members to scan. One pass at a time; `stop()` clears the timer.
 */
export function startHeartbeatDaemon(deps: StartRunDeps, listTenants: () => Promise<string[]>): HeartbeatDaemon {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await processDueHeartbeats(deps, listTenants);
      await pruneStaleHeartbeatClaims(deps);
    } catch (err) {
      log.warn('heartbeat daemon tick error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  log.info('heartbeat daemon started', { pollIntervalMs: POLL_INTERVAL_MS, instanceId: getInstanceId() });
  return { stop: () => clearInterval(timer) };
}
