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
