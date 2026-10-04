/**
 * v2 — the prompt library read surface (`spec/v2/core/host-services.md`
 * §`prompts` + §Library; `api/v2/openapi.yaml` `listPromptTemplates`,
 * `getPromptTemplate`; RFC 0028 §A). The v1 twin is `prompt-list-and-fetch`;
 * the legs live in `lib/prompt-library-witness.ts`.
 *
 *   list        `GET /prompts` answers `{ items, nextCursor? }`; every item
 *               validates against the closed v2 PromptTemplate;
 *   filters     `?kind=system` and `?source=host` narrow;
 *   fetch       a listed template is fetched by id;
 *   etag        an ETag, when sent (a SHOULD), revalidates to `304`;
 *   unknown     an unknown id is `404` with the v2 error envelope;
 *   gate off    NEW at v2, unaided: with `prompts.endpointsSupported` not
 *               advertised (the record absent, or the facet not `true`),
 *               `GET /prompts` answers `404 not_found` (errors.md
 *               §Unadvertised operations).
 *
 * Dispositions: no target ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`;
 * `prompts` absent or `endpointsSupported` not `true` ⇒ the read legs are
 * `inapplicable` (gated by presence, never a strict-mode failure) and the
 * gate-off leg binds; an empty library ⇒ fetch/etag `inapplicable`.
 *
 * Proven against a scratch double in `lib/prompt-library-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §prompts
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { etagLeg, fetchLeg, filterLeg, gateOffReadLeg, listLeg, promptAdverts, unknownLeg, type PromptAdverts } from '../lib/prompt-library-witness.js';

const PROFILE = majorProfile(2);
const ID_LIST = 'openwop.requirement.prompts.list-shape';
const ID_FILTER = 'openwop.requirement.prompts.list-filters';
const ID_FETCH = 'openwop.requirement.prompts.fetch-by-id';
const ID_ETAG = 'openwop.requirement.prompts.etag-revalidation';
const ID_UNKNOWN = 'openwop.requirement.prompts.unknown-template-404';
const ID_GATE = 'openwop.requirement.prompts.endpoints-gate-off-404';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];
const template = v2Validator('prompt-template');
const envelope = v2Validator('error-envelope');

type Ready = { ok: true; a: PromptAdverts } | { ok: false; skip: () => undefined };
async function ready(): Promise<Ready> {
  if (HTTP_SKIP) return { ok: false, skip: () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset') };
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, skip: () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0') };
  return { ok: true, a: promptAdverts(PROFILE, doc) };
}

describe('v2 prompt library: read surface (host-services.md §prompts)', () => {
  it('GET /prompts answers items whose every entry validates', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await listLeg(r.a, template);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_LIST, x.doc, x.message)).toBe(true);
  });

  it('the kind and source filters narrow the list', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await filterLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_FILTER, x.doc, x.message)).toBe(true);
  });

  it('a listed template is fetched by id', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await fetchLeg(PROFILE, r.a, template);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_FETCH, x.doc, x.message)).toBe(true);
  });

  it('an ETag, when sent, revalidates to 304', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await etagLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_ETAG, x.doc, x.message)).toBe(true);
  });

  it('an unknown templateId answers 404 with the error envelope', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await unknownLeg(PROFILE, r.a, envelope);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_UNKNOWN, x.doc, x.message)).toBe(true);
  });

  it('with endpointsSupported unadvertised, GET /prompts answers 404 not_found', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await gateOffReadLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_GATE, x.doc, x.message)).toBe(true);
  });
});
