/**
 * v2 — the three envelope caps on `limits` (`spec/v2/core/runs.md` §Limits:
 * "`limits` always carries `clarificationRounds` (per task), `schemaRounds`
 * (per envelope) and `envelopesPerTurn` (per chat turn)"). The v1 twin is the
 * advertisement half of `aiEnvelope.capBreached`; the legs live in
 * `lib/family-advert-witness.ts`. The other `limits` facets
 * (`maxRunDurationMs`, `maxLoopIterations`) are `v2-run-execution-bounds`.
 *
 * Each cap MUST be present and validate against its subschema in
 * `schemas/v2/capabilities.schema.json` (a non-negative integer).
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `limits` absent ⇒
 * `inapplicable` (at v2 presence of the record is the claim; the v1 rule that
 * `limits` itself is always present has no v2 seat — the root schema requires
 * only `protocolVersions` and `preferredVersion`).
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
const ID_SCHEMA = 'openwop.requirement.limits.schema-rounds-advertised';
const ID_ENVELOPES = 'openwop.requirement.limits.envelopes-per-turn-advertised';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 limits envelope caps (runs.md §Limits)', () => {
  it('limits.clarificationRounds is present and a non-negative integer', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = limitsCapLeg(PROFILE, doc, 'clarificationRounds');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_CLARIFICATION, x.doc, x.message)).toBe(true);
  });

  it('limits.schemaRounds is present and a non-negative integer', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = limitsCapLeg(PROFILE, doc, 'schemaRounds');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SCHEMA, x.doc, x.message)).toBe(true);
  });

  it('limits.envelopesPerTurn is present and a non-negative integer', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = limitsCapLeg(PROFILE, doc, 'envelopesPerTurn');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_ENVELOPES, x.doc, x.message)).toBe(true);
  });
});
