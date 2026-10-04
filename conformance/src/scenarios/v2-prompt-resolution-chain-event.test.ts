/**
 * v2 — the resolution chain on the production wire
 * (`spec/v2/core/host-services.md` §`prompts` → §Resolution; RFC 0029). The v1
 * twin is `prompt-resolution-chain-event`; the judge lives in
 * `lib/prompt-events-witness.ts`.
 *
 * A run of `conformance-prompt-end-to-end` is created with `POST /runs` and its
 * durable log read with `GET /runs/{runId}/events/poll` — no seam. Every
 * `agent.prompt-resolved` (v1 `agent.promptResolved`) carries a non-empty
 * `chain[]`, one entry per layer tried, each naming a layer and a boolean
 * `applied`; at most one is applied, and `resolved` mirrors its `source` (or is
 * `null` with none applied).
 *
 * Stricter than v1: at v2 the emission is a MUST ("MUST emit
 * agent.prompt-resolved"), so a host advertising `prompts` that emits none
 * fails, where the v1 file soft-skipped `blocked`.
 *
 * Dispositions: `prompts` not advertised or the fixture not in `fixtures[]` ⇒
 * `inapplicable`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a scratch double in `lib/prompt-events-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §Resolution
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { END_TO_END_FIXTURE, driveFixture, judgeChain } from '../lib/prompt-events-witness.js';

const PROFILE = majorProfile(2);
const ID_CHAIN = 'openwop.requirement.prompts.resolution-chain-record';

describe('v2 prompt events: the resolution chain record (host-services.md §Resolution)', () => {
  it('every agent.prompt-resolved records the chain it walked, with one applied layer mirrored by resolved', async () => {
    if (!process.env['OPENWOP_BASE_URL']) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    const o = await driveFixture(PROFILE, doc, END_TO_END_FIXTURE);
    if ('kind' in o) return softSkip(o.disposition, o.reason);
    for (const x of judgeChain(o)) expect(x.ok, req(ID_CHAIN, x.doc, x.message)).toBe(true);
  }, 60_000);
});
