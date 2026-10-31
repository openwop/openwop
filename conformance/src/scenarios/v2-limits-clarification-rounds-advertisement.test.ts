/**
 * v2 — `limits.clarificationRounds` (`spec/v2/core/runs.md` §Limits: "`limits`
 * always carries `clarificationRounds` (per task)"). The two envelope caps that
 * sat beside it, `schemaRounds` and `envelopesPerTurn`, were deleted with the AI
 * Envelope (RFC 0255 §C); `maxToolRounds` and `maxRepairRounds` replace them as
 * OPTIONAL facets. The leg lives in `lib/family-advert-witness.ts`. The other
 * `limits` facets (`maxRunDurationMs`, `maxLoopIterations`) are `v2-run-execution-bounds`.
 *
 * The cap MUST be present and validate against its subschema in
 * `schemas/v2/capabilities.schema.json` (a non-negative integer).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `limits` absent ⇒
 * `inapplicable` (at v2 presence of the record is the claim; the root schema
 * requires only `protocolVersions` and `preferredVersion`).
 *
 * @see spec/v2/core/runs.md §Limits
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { limitsCapLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_CLARIFICATION = 'openwop.requirement.limits.clarification-rounds-advertised';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 limits.clarificationRounds (runs.md §Limits)', () => {
  it('limits.clarificationRounds is present and a non-negative integer', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = limitsCapLeg(PROFILE, doc, 'clarificationRounds');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_CLARIFICATION, x.doc, x.message)).toBe(true);
  });
});
