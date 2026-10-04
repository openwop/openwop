/**
 * v2 — prompt packs on the library surface (`spec/v2/core/host-services.md`
 * §`prompts` → §Library; `capabilities.schema.json` §prompts.packsSupported;
 * RFC 0028 §B–§C). The v1 twin is `prompt-pack-install`; the legs live in
 * `lib/prompt-library-witness.ts`.
 *
 *   listing     `GET /prompts?source=pack` answers 200 and lists only pack
 *               templates; NEW at v2, with `packsSupported` not advertised it
 *               lists none ("packs are not loaded"). With the operator flag
 *               `OPENWOP_TEST_PROMPT_PACK_INSTALLED=true` (client-side, as at
 *               v1) it MUST list at least one;
 *   stamps      every pack template carries `meta.packName` and a SemVer
 *               `meta.packVersion` and validates;
 *   reference   the in-tree reference pack `vendor.openwop.prompt-sample`:
 *               `writer-system` is fetched by id under its `libraryId` and
 *               keeps its pack provenance.
 *
 * Dispositions: no target ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`;
 * `prompts` absent or `endpointsSupported` not `true` ⇒ `inapplicable`;
 * `packsSupported` not `true` ⇒ stamps and reference `inapplicable`; no pack
 * installed ⇒ stamps `inapplicable` (zero packs is conformant); the reference
 * pack not installed ⇒ reference `inapplicable`, never `blocked`.
 *
 * Proven against a scratch double in `lib/prompt-library-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §Library
 * @see schemas/v2/prompt-pack-manifest.schema.json
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { packListLeg, packStampLeg, promptAdverts, referencePackLeg, type PromptAdverts } from '../lib/prompt-library-witness.js';

const PROFILE = majorProfile(2);
const ID_LIST = 'openwop.requirement.prompts.pack-listing';
const ID_STAMPS = 'openwop.requirement.prompts.pack-template-stamps';
const ID_REFERENCE = 'openwop.requirement.prompts.reference-pack-fetch';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];
const REQUIRE_INSTALLED = process.env['OPENWOP_TEST_PROMPT_PACK_INSTALLED'] === 'true';
const template = v2Validator('prompt-template');

type Ready = { ok: true; a: PromptAdverts } | { ok: false; skip: () => undefined };
async function ready(): Promise<Ready> {
  if (HTTP_SKIP) return { ok: false, skip: () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset') };
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, skip: () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0') };
  return { ok: true, a: promptAdverts(PROFILE, doc) };
}

describe('v2 prompt packs (host-services.md §Library)', () => {
  it('GET /prompts?source=pack lists only pack templates, and none unless packsSupported', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await packListLeg(r.a, { requireInstalled: REQUIRE_INSTALLED });
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_LIST, x.doc, x.message)).toBe(true);
  });

  it('every pack template carries meta.packName and meta.packVersion', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await packStampLeg(r.a, template);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_STAMPS, x.doc, x.message)).toBe(true);
  });

  it('the reference pack template is fetched by id and keeps its pack provenance', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await referencePackLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_REFERENCE, x.doc, x.message)).toBe(true);
  });
});
