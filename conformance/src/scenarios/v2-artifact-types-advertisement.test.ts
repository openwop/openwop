/**
 * v2 — the `artifactTypes` advertisement
 * (`spec/v2/core/artifact-type-packs.md`; RFCs 0071, 0075, 0145). The v1 twin
 * is the advertisement legs of `artifact-type-registration-source` and
 * `artifact-type-store-emission`; the legs live in
 * `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   global         `store` and `render` are booleans, `export` a list of format ids;
 *   per-type       each `types` entry is closed, with `validation` open | closed,
 *                  `schemaVersion` ≥ 0 and `registrationSource` pack | host.
 *
 * Not here: store-implies-emit and the emitted-vs-advertised `registrationSource`
 * match need a fixture run; the event shape is the corpus gate `coherence/v2-artifact-created-static`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `artifactTypes` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/artifact-type-packs.md §The capability
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { artifactTypesGlobalFacetsLeg, artifactTypesPerTypeLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'artifact-type-packs.md §The capability';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.artifact-types.advert-record-schema';
const ID_GLOBAL_FACETS_SHAPE = 'openwop.requirement.artifact-types.global-facets-shape';
const ID_PER_TYPE_ENTRY_SHAPE = 'openwop.requirement.artifact-types.per-type-entry-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 artifactTypes advertisement (artifact-type-packs.md §The capability)', () => {
  it('the artifactTypes record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'artifactTypes', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('artifactTypes.store, render and export are well-formed', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = artifactTypesGlobalFacetsLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_GLOBAL_FACETS_SHAPE, x.doc, x.message)).toBe(true);
  });

  it('every artifactTypes.types entry validates against its seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = artifactTypesPerTypeLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_PER_TYPE_ENTRY_SHAPE, x.doc, x.message)).toBe(true);
  });
});
