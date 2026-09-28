/**
 * Per-attempt dispatch budgets — `GET /v1/host/sample/test/mock-ai/dispatch-budgets`
 * (host-sample-test-seams.md §28; v2 `api/seams-v2.yaml` `getMockDispatchBudgets`).
 *
 * The companion `last-dispatch-budget` seam reports only the most recent call's
 * `maxTokens`, so a retry's budget cannot be compared with the attempt before
 * it. This seam returns every call's budget in call order. OPTIONAL: an
 * unserved seam (404/405/501) is `unserved`, so the caller falls back to its
 * pre-seam partial witness; a served seam that answers anything else is
 * `broken`, which the caller records as `blocked`.
 */

import { driver } from './driver.js';

export type DispatchBudgets =
  | { ok: true; attempts: Array<number | null> }
  | { ok: false; unserved: true; reason: string }
  | { ok: false; unserved: false; reason: string };

const UNSERVED = new Set([404, 405, 501]);

export async function readDispatchBudgets(nodeId: string): Promise<DispatchBudgets> {
  const res = await driver.get(`/v1/host/sample/test/mock-ai/dispatch-budgets?nodeId=${encodeURIComponent(nodeId)}`);
  if (UNSERVED.has(res.status)) {
    return { ok: false, unserved: true, reason: `the dispatch-budgets seam is not served (${res.status})` };
  }
  const attempts = (res.json as { attempts?: unknown } | undefined)?.attempts;
  if (res.status !== 200 || !Array.isArray(attempts)) {
    return { ok: false, unserved: false, reason: `the dispatch-budgets seam answered ${res.status} without an attempts[] array (host-sample-test-seams.md §28)` };
  }
  const out: Array<number | null> = [];
  for (const a of attempts) {
    const m = (a as { maxTokens?: unknown } | null)?.maxTokens;
    if (m !== null && !(typeof m === 'number' && Number.isInteger(m))) {
      return { ok: false, unserved: false, reason: `the dispatch-budgets seam returned an entry whose maxTokens is ${JSON.stringify(m)}, not an integer or null (host-sample-test-seams.md §28)` };
    }
    out.push(m);
  }
  return { ok: true, attempts: out };
}

/**
 * RFC 0033 §B: a host MAY retry a truncated emission, and the new output budget
 * SHOULD be greater than the previous one. A SHOULD is recorded, not failed: the
 * caller asserts only on `met`, and records `unmet` as `inapplicable` with the
 * observed budgets. The comparison is between the attempts the provider actually
 * received (the dispatch-budgets seam), never against the fixture's configured value.
 */
export type TruncationBudgetVerdict =
  | { kind: 'met'; first: number; retry: number }
  | { kind: 'unmet'; first: number; retry: number }
  | { kind: 'skip'; skip: 'inapplicable' | 'blocked'; reason: string };

export async function truncationBudgetVerdict(nodeId: string): Promise<TruncationBudgetVerdict> {
  const budgets = await readDispatchBudgets(nodeId);
  if (!budgets.ok && budgets.unserved) {
    return { kind: 'skip', skip: 'inapplicable', reason: `partial witness — the §B budget SHOULD is not observed: ${budgets.reason}, so the retry's budget cannot be compared with the first attempt's` };
  }
  if (!budgets.ok) return { kind: 'skip', skip: 'blocked', reason: budgets.reason };
  const [first, retry] = budgets.attempts;
  if (budgets.attempts.length < 2) return { kind: 'skip', skip: 'inapplicable', reason: `the host made no truncation retry (RFC 0033 §B: MAY retry); per-attempt budgets ${JSON.stringify(budgets.attempts)}` };
  if (typeof first !== 'number' || typeof retry !== 'number') {
    return { kind: 'skip', skip: 'inapplicable', reason: `partial witness — a call carried no output budget (per-attempt budgets ${JSON.stringify(budgets.attempts)}), so the §B SHOULD cannot be compared` };
  }
  return retry > first ? { kind: 'met', first, retry } : { kind: 'unmet', first, retry };
}
