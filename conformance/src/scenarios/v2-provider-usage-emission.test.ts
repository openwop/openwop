/**
 * v2 — `provider.usage` emission (`spec/v2/core/events.md` §`providerUsage`:
 * "A host advertising `providerUsage` MUST emit exactly one `provider.usage`
 * per LLM provider invocation, before that node's `node.completed`"). The leg
 * lives in `lib/provider-usage-witness.ts`.
 *
 * A run of `conformance-context-budget-live` (a supervisor on the host's LIVE
 * model — the fixture catalog forbids advertising it with a mock) is created
 * with `POST /runs` and its log read with `events/poll`:
 *   - at least one `provider.usage` is on the log;
 *   - each precedes a `node.completed` of the node it names;
 *   - each payload validates against the v2 `providerUsage` def.
 * "Exactly one per invocation" is NOT asserted: the invocation count is not
 * observable from outside.
 *
 * Dispositions: `providerUsage` not advertised, or the fixture not in
 * `fixtures[]` ⇒ `inapplicable`; the live run ends without completing and with
 * no `provider.usage` ⇒ `blocked`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a double in `lib/provider-usage-witness.test.ts`.
 *
 * @see spec/v2/core/events.md §providerUsage
 * @see conformance/fixtures.md conformance-context-budget-live
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { driveUsage, judgeUsage } from '../lib/provider-usage-witness.js';

const PROFILE = majorProfile(2);
const ID_EMITTED = 'openwop.requirement.provider-usage.emitted-before-node-completed';
const validate = v2RefValidator('run-event-payloads.schema.json#/$defs/providerUsage');

describe('v2 providerUsage: emission on a live model call (events.md §providerUsage)', () => {
  it('a live-model run carries provider.usage, each before its node.completed and each payload valid', async () => {
    if (!process.env['OPENWOP_BASE_URL']) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    if (!(await familyAdvertised('providerUsage'))) return softSkip('inapplicable', 'the host does not advertise providerUsage');
    const o = await driveUsage(PROFILE, doc);
    if ('kind' in o) return softSkip(o.disposition, o.reason);
    const out = judgeUsage(o, validate);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_EMITTED, x.doc, x.message)).toBe(true);
  }, 330_000);
});
