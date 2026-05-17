/**
 * Sub-run dispatcher used by the chat responder when an LLM tool call
 * invokes a saved workflow. Posts to `/v1/runs` on this same host and
 * polls the snapshot endpoint until the run reaches a terminal status
 * (completed / failed / cancelled) or the budget elapses. Interrupts
 * count as "pending" — the budget is exhausted, the LLM gets a stub
 * tool_result, and the human can resume from /runs/:id.
 *
 * Localhost round-trip: ~1ms, so the cost is acceptable. The alternative
 * (importing executeRun + plumbing storage / hostSuite into nodes via
 * a new singleton) is intrusive enough that we defer it until there's
 * a non-sample driver for it.
 */

import { createLogger } from '../observability/logger.js';

const log = createLogger('subRunDispatcher');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const POLL_INTERVAL_MS = 250;

export interface SubRunRequest {
  workflowId: string;
  inputs: unknown;
  budgetMs: number;
  /** Tenant of the calling chat run. The sub-run inherits this so
   *  the LLM can't escalate across tenants by invoking another
   *  tenant's workflows. Real hosts MUST pass through the caller's
   *  principal+tenant; the sample's authorizer happens to allow `*`
   *  but that's not the contract. */
  tenantId: string;
  scopeId?: string;
}

export type SubRunResult =
  | { status: 'completed'; runId: string; output: unknown }
  | { status: 'failed'; runId: string; error: { code?: string; message?: string } }
  | { status: 'pending'; runId: string; budgetMs: number };

interface CreateRunResponse {
  runId: string;
  status: string;
  eventsUrl?: string;
  statusUrl?: string;
}

interface RunSnapshot {
  runId: string;
  status: string;
  error?: { code?: string; message?: string };
}

export async function dispatchSubRun(req: SubRunRequest): Promise<SubRunResult> {
  const baseUrl = process.env.OPENWOP_INTERNAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
  // Sample-grade: the auth middleware accepts any non-empty Bearer
  // and resolves it to a wildcard-tenant principal. Real hosts MUST
  // mint a service principal (or forward the caller's principal via
  // a signed delegation) instead of hardcoding a literal token —
  // otherwise OIDC/Firebase identity resolvers will reject this call
  // with 401 the moment they're wired in.
  const token = process.env.OPENWOP_INTERNAL_TOKEN ?? 'sample-token';

  const createRes = await fetch(`${baseUrl}/v1/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      workflowId: req.workflowId,
      tenantId: req.tenantId,
      ...(req.scopeId ? { scopeId: req.scopeId } : {}),
      inputs: req.inputs,
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    return {
      status: 'failed',
      runId: '',
      error: { code: 'sub_run_create_failed', message: `${createRes.status}: ${text.slice(0, 300)}` },
    };
  }
  const created = (await createRes.json()) as CreateRunResponse;
  const runId = created.runId;

  const deadline = Date.now() + req.budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let snap: RunSnapshot;
    try {
      const res = await fetch(`${baseUrl}/v1/runs/${runId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      snap = (await res.json()) as RunSnapshot;
    } catch (err) {
      log.warn('subrun_poll_failed', { runId, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!TERMINAL.has(snap.status)) continue;
    if (snap.status === 'completed') {
      // Fetch the final run.completed event to recover the output.
      try {
        const evRes = await fetch(`${baseUrl}/v1/runs/${runId}/events/poll?limit=1000`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (evRes.ok) {
          const body = (await evRes.json()) as { events: Array<{ type: string; payload: Record<string, unknown> }> };
          const completed = body.events.find((e) => e.type === 'run.completed');
          const output = completed?.payload?.output ?? null;
          return { status: 'completed', runId, output };
        }
      } catch {
        /* fall through to no-output completion */
      }
      return { status: 'completed', runId, output: null };
    }
    return {
      status: 'failed',
      runId,
      error: snap.error ?? { code: snap.status, message: `run terminated with status ${snap.status}` },
    };
  }
  // Budget exhausted; run may be still executing or paused on an interrupt.
  return { status: 'pending', runId, budgetMs: req.budgetMs };
}
