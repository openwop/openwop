/**
 * v2 — the `modelCapabilities` advertisement (`spec/v2/core/host-services.md`
 * §modelCapabilities; RFC 0031 §C/§E, RFC 0055). The v1 twin is the
 * advertisement half of `model-capability-substituted`; the legs live in
 * `lib/family-advert-witness.ts`.
 *
 *   record        the record validates against its seat in
 *                 `schemas/v2/capabilities.schema.json` — at v2 there is no
 *                 `supported` seat, so a v1-shaped record fails here;
 *   advertised    every identifier is spec-reserved or host-private, prefixed
 *                 `x-host-<host>-` ("a host-private identifier MUST be prefixed");
 *   substitution  `substitutionSupported` is a boolean.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `modelCapabilities` absent,
 * or the facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §modelCapabilities
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { modelCapabilitiesAdvertisedLeg, modelCapabilitiesSubstitutionLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.model-capabilities.advert-record-schema';
const ID_ADVERTISED = 'openwop.requirement.model-capabilities.advertised-identifiers';
const ID_SUBSTITUTION = 'openwop.requirement.model-capabilities.substitution-supported-boolean';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 modelCapabilities advertisement (host-services.md §modelCapabilities)', () => {
  it('the modelCapabilities record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'modelCapabilities', 'host-services.md §modelCapabilities');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('modelCapabilities.advertised names only spec-reserved or x-host- prefixed identifiers', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = modelCapabilitiesAdvertisedLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_ADVERTISED, x.doc, x.message)).toBe(true);
  });

  it('modelCapabilities.substitutionSupported is a boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = modelCapabilitiesSubstitutionLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SUBSTITUTION, x.doc, x.message)).toBe(true);
  });
});
