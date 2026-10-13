/**
 * v2 — `agents.fanOut` breadth and per-item input (RFC 0243 §A.3, §A.4; gap
 * G2). The facet (`spec/v2/facets/agents.schema.json` §fanOut) states both:
 * "children beyond [`maxFanOut`] are dispatched in waves and none is dropped",
 * and "without [`perItemInput: true`], a non-empty `nextWorkerInputs` MUST fail
 * the dispatch node with `validation_error` and dispatch no child".
 * `orchestrator-decision.schema.json` `nextWorkerInputs` adds the length rule.
 * The v1 twins are `dispatch-fanout-parallel` and `dispatch-per-item-input`,
 * which drive a v1 seam; these legs need none. Each fixture's supervisor
 * carries a `mockDispatchPlan`, and the legs live in `lib/fan-out-witness.ts`.
 *
 *   waves       `conformance-dispatch-fanout-waves`: three `conformance-delay`
 *               children under `maxConcurrency: 2` all complete, the
 *               fan-out and join events count three, and no more than
 *               `min(2, maxFanOut)` children are in flight at once;
 *   per-item    `conformance-dispatch-per-item`: at `perItemInput: true` each
 *               child receives its own item; otherwise the dispatch node
 *               fails `validation_error` and no child is dispatched;
 *   mismatch    `conformance-dispatch-per-item-mismatch`: one item for two
 *               children fails the dispatch node `validation_error`, no child.
 *
 * Dispositions: `agents.dispatch` not `true`, or a fixture (or its child) not
 * in `fixtures[]` ⇒ `inapplicable`; for waves, `agents.fanOut` absent or not
 * admitting `wait-all` with `collect` ⇒ `inapplicable`; discovery unreadable ⇒
 * `blocked`.
 *
 * Proven against doubles in `lib/fan-out-witness.test.ts`.
 *
 * @see spec/v2/facets/agents.schema.json §fanOut
 * @see schemas/v2/orchestrator-decision.schema.json §nextWorkerInputs
 * @see RFCS/0243-dispatch-fan-out-seat.md
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import type { Outcome, Skip } from '../lib/fixture-run-observer.js';
import {
  PER_ITEM_FIXTURE, PER_ITEM_MISMATCH_FIXTURE, drivePerItem, driveWaves, judgeLengthMismatch, judgePerItem, judgeWaves,
  type PerItemObservation, type WavesObservation,
} from '../lib/fan-out-witness.js';

const PROFILE = majorProfile(2);
const ID_WAVES = 'openwop.requirement.0243.max-fan-out-waves';
const ID_PER_ITEM = 'openwop.requirement.0243.per-item-input-gated';
const ID_MISMATCH = 'openwop.requirement.agents.dispatch-per-item-length-mismatch';

async function discovery(): Promise<Record<string, unknown> | (() => undefined)> {
  if (!process.env['OPENWOP_BASE_URL']) return () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  return doc ?? (() => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'));
}
function assert(id: string, out: Outcome): undefined {
  if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
  for (const x of out.findings) expect(x.ok, req(id, x.doc, x.message)).toBe(true);
  return undefined;
}
const unwrap = <T,>(o: Skip | T): T | (() => undefined) => (o !== null && typeof o === 'object' && 'kind' in o && (o as Skip).kind === 'skip' ? () => softSkip((o as Skip).disposition, (o as Skip).reason) : (o as T));

describe('v2 agents.fanOut: waves and per-item input (RFC 0243 §A.3, §A.4)', () => {
  it('children beyond the effective ceiling are dispatched in waves, and none is dropped', async () => {
    const doc = await discovery();
    if (typeof doc === 'function') return doc();
    const o = unwrap<WavesObservation>(await driveWaves(PROFILE, doc));
    if (typeof o === 'function') return o();
    return assert(ID_WAVES, judgeWaves(o));
  }, 90_000);

  it('nextWorkerInputs reaches each child at perItemInput: true, and fails closed without it', async () => {
    const doc = await discovery();
    if (typeof doc === 'function') return doc();
    const o = unwrap<PerItemObservation>(await drivePerItem(PROFILE, doc, PER_ITEM_FIXTURE));
    if (typeof o === 'function') return o();
    return assert(ID_PER_ITEM, judgePerItem(o));
  }, 90_000);

  it('a nextWorkerInputs length that differs from nextWorkerIds fails the dispatch node and dispatches no child', async () => {
    const doc = await discovery();
    if (typeof doc === 'function') return doc();
    const o = unwrap<PerItemObservation>(await drivePerItem(PROFILE, doc, PER_ITEM_MISMATCH_FIXTURE));
    if (typeof o === 'function') return o();
    return assert(ID_MISMATCH, judgeLengthMismatch(o));
  }, 90_000);
});
