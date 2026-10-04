/**
 * v2 — the model-capability refusal, end to end (`spec/v2/core/host-services.md`
 * §modelCapabilities; RFC 0031 §B step 4 + §D). The v1 twin is the two fixture
 * legs of `model-capability-insufficient`; its four `evaluate-model-capability-gate`
 * seam legs are not ported. The legs live in
 * `lib/model-capability-insufficient-witness.ts`; what differs between majors
 * (the run path, the event name `model.capability-insufficient`) is the profile row.
 *
 * One run of the `conformance-model-capability-insufficient` fixture, whose one
 * node requires a capability no model offers and declares no fallback:
 *   refusal      the run ends `failed` / `capability_not_provided`; the log
 *                carries `model.capability-insufficient` before `node.failed`,
 *                its payload valid against
 *                `run-event-payloads#/$defs/modelCapabilityInsufficient`, with
 *                `fallbackAttempted` not true;
 *   no-dispatch  the log carries no `node.completed`, `provider.usage` or
 *                envelope-reliability event.
 *
 * Dispositions: `modelCapabilities` not advertised, or the fixture not
 * advertised ⇒ `inapplicable` (the fixture is the opt-in).
 *
 * Proven against a scratch double in `lib/model-capability-insufficient-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §modelCapabilities
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { drive, judgeNoDispatch, judgeRefusal, type InsufficientObservation, type InsufficientSkip } from '../lib/model-capability-insufficient-witness.js';

const PROFILE = majorProfile(2);
const ID_REFUSAL = 'openwop.requirement.model-capabilities.insufficient-refusal';
const ID_NO_DISPATCH = 'openwop.requirement.model-capabilities.insufficient-no-dispatch';

let run: Promise<InsufficientSkip | InsufficientObservation | null> | undefined;
/** One fixture run serves both legs. `null`: discovery unreadable. */
function observe(): Promise<InsufficientSkip | InsufficientObservation | null> {
  run ??= (async () => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    return doc === null ? null : drive(PROFILE, doc);
  })();
  return run;
}

describe('v2 model-capability-insufficient (host-services.md §modelCapabilities)', () => {
  it('a node requiring a capability no model offers fails capability_not_provided after model.capability-insufficient', async () => {
    const o = await observe();
    if (o === null) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if ('kind' in o) return softSkip(o.disposition, o.reason);
    for (const x of judgeRefusal(PROFILE, o)) expect(x.ok, req(ID_REFUSAL, x.doc, x.message)).toBe(true);
  }, 60_000);

  it('a refused dispatch emits no node completion, provider usage or envelope-reliability event', async () => {
    const o = await observe();
    if (o === null) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if ('kind' in o) return softSkip(o.disposition, o.reason);
    for (const x of judgeNoDispatch(PROFILE, o)) expect(x.ok, req(ID_NO_DISPATCH, x.doc, x.message)).toBe(true);
  }, 60_000);
});
