/**
 * v2 — the `selfHostedRunner` advertisement (`spec/v2/core/execution.md`
 * §selfHostedRunner; RFC 0122). The v1 twin is the advertisement leg of
 * `self-hosted-runner`; the legs live in `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its seat in
 *                  `schemas/v2/capabilities.schema.json` (no v1 `supported` seat);
 *   dispatchKinds  `dispatchKinds` lists `model`, `tool` or both, each once.
 *
 * Not here: registration, subject isolation, at-most-once and liveness need a
 * runner seam; the frame shapes are the corpus gate `coherence/v2-self-hosted-runner-frames-static`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `selfHostedRunner` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/execution.md §selfHostedRunner
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { recordSchemaLeg, selfHostedRunnerDispatchKindsLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'execution.md §selfHostedRunner';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.self-hosted-runner.advert-record-schema';
const ID_DISPATCH_KINDS = 'openwop.requirement.self-hosted-runner.dispatch-kinds';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 selfHostedRunner advertisement (execution.md §selfHostedRunner)', () => {
  it('the selfHostedRunner record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'selfHostedRunner', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('selfHostedRunner.dispatchKinds lists model, tool or both', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = selfHostedRunnerDispatchKindsLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_DISPATCH_KINDS, x.doc, x.message)).toBe(true);
  });
});
