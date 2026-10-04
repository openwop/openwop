/**
 * v2 — `renderPromptTemplate` (`spec/v2/core/host-services.md` §`prompts` →
 * §Library, §Composition; `api/v2/openapi.yaml` `POST /prompts:render`; RFC
 * 0028 §A). The v1 twin is `prompt-render-deterministic`; the legs live in
 * `lib/prompt-library-witness.ts`. The render path is `prompts.library.
 * renderEndpoint` when advertised, else `/prompts:render`.
 *
 *   deterministic  identical (ref, variables) render the identical `hash` and
 *                  `variableHashes` (the hash MUST equal the dispatch-time
 *                  `prompt.composed` hash, so it cannot vary per call);
 *   varies         a changed required binding changes `hash` and its
 *                  `variableHashes` entry;
 *   shape          `hash` and every `variableHashes` value are
 *                  `sha256:<hex64>`; under `observability: full` `composed`
 *                  carries the body for every kind (a few-shot or schema-hint
 *                  template preferred), otherwise `composed` is absent —
 *                  bodies only under `full` (NEW at v2: the v1 file required a
 *                  body unconditionally);
 *   unbound        NEW at v2: a required variable left unbound is refused
 *                  `400 validation_error`.
 *
 * Dispositions: no target ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`;
 * `prompts` absent or `endpointsSupported` not `true` ⇒ `inapplicable` (gated
 * by presence); no renderable template (none listed, or each needs a secret
 * binding) or none with a required variable ⇒ `inapplicable`.
 *
 * Proven against a scratch double in `lib/prompt-library-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §Library
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { deterministicLeg, promptAdverts, renderShapeLeg, unboundRequiredLeg, variesLeg, type PromptAdverts } from '../lib/prompt-library-witness.js';

const PROFILE = majorProfile(2);
const ID_DETERMINISTIC = 'openwop.requirement.prompts.render-deterministic';
const ID_VARIES = 'openwop.requirement.prompts.render-binding-sensitive';
const ID_SHAPE = 'openwop.requirement.prompts.render-shape';
const ID_UNBOUND = 'openwop.requirement.prompts.render-unbound-required-refused';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];

type Ready = { ok: true; a: PromptAdverts } | { ok: false; skip: () => undefined };
async function ready(): Promise<Ready> {
  if (HTTP_SKIP) return { ok: false, skip: () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset') };
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, skip: () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0') };
  return { ok: true, a: promptAdverts(PROFILE, doc) };
}

describe('v2 prompt render (host-services.md §Library, §Composition)', () => {
  it('identical ref and variables render the identical hash and variableHashes', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await deterministicLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_DETERMINISTIC, x.doc, x.message)).toBe(true);
  });

  it('a changed binding changes the hash and its variableHash', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await variesLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_VARIES, x.doc, x.message)).toBe(true);
  });

  it('hashes are sha256 hex and the body is present only under observability full', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await renderShapeLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_SHAPE, x.doc, x.message)).toBe(true);
  });

  it('an unbound required variable is refused 400 validation_error', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await unboundRequiredLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_UNBOUND, x.doc, x.message)).toBe(true);
  });
});
