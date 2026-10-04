/**
 * v2 — the `portability` advertisement (`spec/v2/core/portability.md`; RFC
 * 0098). The v1 twin is the advertisement leg of `export-bundle-portability`;
 * the legs live in `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   import⇒dryRun  "A host advertising `import` MUST advertise `dryRun: true`",
 *                  read as the schema reads it: `import: true` ⇒ `dryRun: true`;
 *   kinds          unique export-bundle item kinds.
 *
 * Not here: import refusal of credential material, dry-run no-write and
 * idempotence: v2 defines no import route ("a host serves them on routes of its
 * own"). The bundle shape is `v2-export-bundle-static`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `portability` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/portability.md §The portability record
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { portabilityImportDryRunLeg, portabilityKindsLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'portability.md §The portability record';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.portability.advert-record-schema';
const ID_IMPORT_REQUIRES_DRY_RUN = 'openwop.requirement.portability.import-requires-dry-run';
const ID_KINDS_SHAPE = 'openwop.requirement.portability.kinds-shape';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 portability advertisement (portability.md §The portability record)', () => {
  it('the portability record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'portability', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('a host advertising portability.import advertises dryRun: true', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = portabilityImportDryRunLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_IMPORT_REQUIRES_DRY_RUN, x.doc, x.message)).toBe(true);
  });

  it('portability.kinds lists unique export-bundle item kinds', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = portabilityKindsLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_KINDS_SHAPE, x.doc, x.message)).toBe(true);
  });
});
