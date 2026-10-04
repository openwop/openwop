/**
 * v2 — locale negotiation (`spec/v2/core/i18n.md` §`Accept-Language`,
 * §Fallback, §Error envelopes, §The `i18n` record). The v1 twin is
 * `i18n-negotiation`; the legs live in `lib/i18n-negotiation-witness.ts`, and
 * what differs between majors (the unversioned run path, the `~`-projected
 * bound id, presence-as-advertisement) is the profile row.
 *
 *   shape        the `i18n` record validates against the v2 capabilities
 *                schema, and `supportedLocales` contains `defaultLocale`;
 *   unsupported  an unsupported `Accept-Language` is answered exactly as the
 *                same request without it; `Content-Language`, when sent, is a
 *                BCP 47 tag naming the default locale;
 *   malformed    a malformed `Accept-Language` never yields `400`;
 *   error code   the `error` code and the `details` keys are identical under
 *                the default and a negotiated locale.
 *
 * The probe reads a run id no host minted (`GET /runs/{bound id}`). Its answer
 * is not pinned — `404 not_found`, or `403 id_tenant_mismatch` because the
 * tenant segment is not the caller's — since every leg compares against the
 * same request with no `Accept-Language`.
 *
 * Dispositions: no target ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`;
 * `i18n` not advertised ⇒ `inapplicable` (gated with the record's presence,
 * never a strict-mode failure); a probe that answers no 4xx envelope ⇒
 * `blocked` (no baseline).
 *
 * Proven against a scratch double in `lib/i18n-negotiation-witness.test.ts`.
 *
 * @see spec/v2/core/i18n.md
 * @see schemas/v2/capabilities.schema.json §i18n
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { errorCodeLeg, i18nAdverts, malformedLeg, shapeLeg, unsupportedLeg, type I18nAdverts } from '../lib/i18n-negotiation-witness.js';

const PROFILE = majorProfile(2);
const ID_SHAPE = 'openwop.requirement.i18n.record-shape';
const ID_UNSUPPORTED = 'openwop.requirement.i18n.unsupported-locale-falls-back';
const ID_MALFORMED = 'openwop.requirement.i18n.malformed-accept-language-not-400';
const ID_CODE = 'openwop.requirement.i18n.error-code-locale-invariant';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];
const validRecord = v2RefValidator('capabilities.schema.json#/properties/i18n');

type Ready = { ok: true; a: I18nAdverts } | { ok: false; skip: () => undefined };
async function ready(): Promise<Ready> {
  if (HTTP_SKIP) return { ok: false, skip: () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset') };
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, skip: () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0') };
  if ((await familyAdvertised('i18n')) === null) return { ok: false, skip: () => softSkip('inapplicable', 'the host does not advertise i18n — it serves one locale and ignores Accept-Language (i18n.md §The i18n record)') };
  return { ok: true, a: i18nAdverts(PROFILE, doc) };
}

describe('v2 i18n negotiation (i18n.md §Accept-Language, §Fallback, §Error envelopes)', () => {
  it('the advertised i18n record is well-formed and lists its default locale', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const v = validRecord(r.a.record);
    const out = shapeLeg(r.a);
    expect(v.ok, req(ID_SHAPE, 'schemas/v2/capabilities.schema.json §i18n', `the i18n record MUST validate: ${v.errors}`)).toBe(true);
    if (out.kind === 'observed') for (const x of out.findings) expect(x.ok, req(ID_SHAPE, x.doc, x.message)).toBe(true);
  });

  it('an unsupported Accept-Language falls back and Content-Language never lies', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await unsupportedLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_UNSUPPORTED, x.doc, x.message)).toBe(true);
  });

  it('a malformed Accept-Language does not cause 400', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await malformedLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_MALFORMED, x.doc, x.message)).toBe(true);
  });

  it('the error code and details keys are identical under every negotiated locale', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await errorCodeLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_CODE, x.doc, x.message)).toBe(true);
  });
});
