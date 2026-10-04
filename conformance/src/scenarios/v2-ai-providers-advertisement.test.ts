/**
 * v2 — the `aiProviders` advertisement facets that survive at major 2
 * (`spec/v2/core/host-services.md` §aiProviders; migration C2.11 narrowed the
 * v1 facets). The v1 twins are the advertisement halves of
 * `aiproviders-selfhosted-shape`, `byok-auth-modes` and `media-url-inline-cap`;
 * the legs live in `lib/family-advert-witness.ts`.
 *
 *   record              the record validates against its seat in
 *                       `schemas/v2/capabilities.schema.json`;
 *   selfHosted          one boolean (the v1 `selfHosted[]` id list retired);
 *   authModes shape     one flat list (the v1 per-provider map retired);
 *   (not a leg) authModes vocabulary: the prose names `apiKey`, `oauth-pkce`,
 *                       `oauth-device`, `none`, `subscription`, but its only
 *                       MUSTs bind clients ("a client MUST ignore an unknown
 *                       mode"), and the v2 schema seat is `string[]` with no
 *                       enum. No host-side MUST exists, so a misspelt mode is an
 *                       interop defect the host should fix, not a failing row.
 *                       Restoring the v1 enum would need an RFC.
 *   maxInlineMediaBytes an integer ≥ 1;
 *   promptPrefixCache   one boolean (the v1 `{ supported, providers[] }` retired).
 *
 * The v1 rules C2.11 retired (`selfHosted[]` ⊆ `supported[]`, the per-provider
 * `authModes` keys/byok/`["none"]` rules) are not ported: they have no v2 seat.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `aiProviders` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/host-services.md §aiProviders
 * @see spec/v1/migrations.json openwop.migration.C2.11
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import {
  aiProvidersAuthModesShapeLeg, aiProvidersInlineMediaLeg, aiProvidersPromptPrefixCacheLeg, aiProvidersSelfHostedLeg,
  recordSchemaLeg,
} from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.ai-providers.advert-record-schema';
const ID_SELF_HOSTED = 'openwop.requirement.ai-providers.self-hosted-boolean';
const ID_AUTH_SHAPE = 'openwop.requirement.ai-providers.auth-modes-flat-list';
const ID_INLINE_MEDIA = 'openwop.requirement.ai-providers.max-inline-media-bytes';
const ID_PREFIX_CACHE = 'openwop.requirement.ai-providers.prompt-prefix-cache-boolean';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 aiProviders advertisement (host-services.md §aiProviders)', () => {
  it('the aiProviders record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'aiProviders', 'host-services.md §aiProviders');
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.selfHosted is one boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = aiProvidersSelfHostedLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SELF_HOSTED, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.authModes is one flat list of modes', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = aiProvidersAuthModesShapeLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_AUTH_SHAPE, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.maxInlineMediaBytes is an integer of at least 1', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = aiProvidersInlineMediaLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_INLINE_MEDIA, x.doc, x.message)).toBe(true);
  });

  it('aiProviders.promptPrefixCache is one boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = aiProvidersPromptPrefixCacheLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_PREFIX_CACHE, x.doc, x.message)).toBe(true);
  });
});
