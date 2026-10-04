/**
 * The locale-negotiation witness (`i18n.md` §`Accept-Language`, §Fallback,
 * §Error envelopes, §The `i18n` record), shared by every major that states
 * those rules. What differs between majors (the run path, how an id becomes a
 * path segment, how a family is advertised) is the profile row.
 *
 * Four legs:
 *   shape        the advertised `i18n` record: BCP 47 tags, and
 *                `supportedLocales` contains `defaultLocale`;
 *   unsupported  an `Accept-Language` the host does not support is answered
 *                exactly as the same request without it, and a
 *                `Content-Language`, when sent, names the default locale;
 *   malformed    a malformed `Accept-Language` never yields `400` and is
 *                answered exactly as the same request without it;
 *   errorCode    the `error` code and the `details` keys are identical under
 *                the default and a negotiated locale.
 *
 * The probe is a read of a run id no host minted. Its answer is not pinned
 * (`404 not_found`, or at major 2 `403 id_tenant_mismatch` when the tenant
 * segment is not the caller's): every live leg compares against the same
 * request sent with no `Accept-Language`, so what is witnessed is that the
 * header changes nothing a client routes on.
 *
 * Each leg OBSERVES and returns findings; it asserts nothing. The scenario maps
 * findings to requirement ids, and `i18n-negotiation-witness.test.ts` proves
 * every leg against `i18n-double.ts` with one defect turned on.
 */

import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import type { MajorProfile } from './major-profile.js';

export interface I18nFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type I18nOutcome =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly findings: readonly I18nFinding[] };

/** BCP 47 well-formedness as `capabilities.schema.json` §i18n pins it. */
export const BCP47 = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$/;
/** A registered code (snake_case) or a vendor code (`errors.md`; the v2 envelope's vendor grammar). */
const ERROR_CODE = /^(?:[a-z][a-z0-9_]*|(?!openwop\.)[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9_]*)$/;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): I18nFinding => ({ ok, doc, message });
const lower = (s: string): string => s.toLowerCase();
const primary = (tag: string): string => lower(tag.split('-')[0] ?? tag);

export interface I18nAdverts {
  readonly record: Record<string, unknown> | null;
  /** `i18n.defaultLocale`, or `en` when omitted (`i18n.md` §The `i18n` record). */
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
}

export function i18nAdverts(profile: MajorProfile, doc: unknown): I18nAdverts {
  const record = profile.family(doc, 'i18n');
  const dl = record?.['defaultLocale'];
  const sl = record?.['supportedLocales'];
  return {
    record,
    defaultLocale: typeof dl === 'string' ? dl : 'en',
    supportedLocales: Array.isArray(sl) ? sl.filter((t): t is string => typeof t === 'string') : [],
  };
}

const gate = (a: I18nAdverts): I18nOutcome | null =>
  a.record === null ? { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise i18n — it serves one locale and ignores Accept-Language (i18n.md §The i18n record)' } : null;

/** Leg 1, shape: judged from the discovery record alone. */
export function shapeLeg(a: I18nAdverts): I18nOutcome {
  const g = gate(a); if (g) return g;
  const rec = a.record!;
  const doc = 'i18n.md §Language tags + §The i18n record';
  const findings: I18nFinding[] = [];
  const dl = rec['defaultLocale'];
  const sl = rec['supportedLocales'];
  if (dl !== undefined) findings.push(f(typeof dl === 'string' && BCP47.test(dl), doc, `i18n.defaultLocale MUST be a BCP 47 tag (got ${JSON.stringify(dl)})`));
  if (sl !== undefined) {
    findings.push(f(Array.isArray(sl), doc, 'i18n.supportedLocales MUST be an array when present'));
    for (const t of Array.isArray(sl) ? sl : []) findings.push(f(typeof t === 'string' && BCP47.test(t), doc, `every i18n.supportedLocales entry MUST be a BCP 47 tag (got ${JSON.stringify(t)})`));
    // The schema states the containment "when both are present"; tags compare case-insensitively.
    if (typeof dl === 'string' && Array.isArray(sl)) {
      findings.push(f(sl.some((t) => typeof t === 'string' && lower(t) === lower(dl)), doc, `i18n.supportedLocales MUST contain defaultLocale ${dl} (got ${JSON.stringify(sl)})`));
    }
  }
  if (findings.length === 0) return { kind: 'skip', disposition: 'inapplicable', reason: 'the i18n record carries neither defaultLocale nor supportedLocales — nothing to judge' };
  return { kind: 'observed', findings };
}

/** A read of a run id no host minted. */
export function probePath(profile: MajorProfile): string {
  const opaque = `never-minted-${randomBytes(8).toString('hex')}`;
  return `${profile.runsPath}/${profile.idSegment(profile.major >= 2 ? `conformance-i18n/${opaque}` : `openwop-conformance-i18n-${opaque}`)}`;
}

/** A syntactically valid tag the host does not list. */
export function unsupportedTag(supported: readonly string[]): string {
  const have = new Set(supported.map(lower));
  return ['tlh', 'kl-GL', 'mi-NZ', 'eu-ES'].find((c) => !have.has(lower(c)) && !have.has(primary(c))) ?? 'tlh';
}

const get = (path: string, acceptLanguage?: string): Promise<OpenWOPResponse> =>
  driver.get(path, acceptLanguage === undefined ? {} : { headers: { 'Accept-Language': acceptLanguage } });

/** The baseline answer must be an error a client can route on, or nothing can be compared. */
function baselineSkip(base: OpenWOPResponse): I18nOutcome | null {
  if (base.status >= 400 && base.status < 500 && readErrorCode(base.json) !== undefined) return null;
  return { kind: 'skip', disposition: 'blocked', reason: `the probe read answered ${base.status} without a 4xx error envelope, so there is no baseline to compare a negotiated answer against` };
}

/** Leg 2, unsupported: an unsupported locale changes nothing a client routes on, and Content-Language never lies. */
export async function unsupportedLeg(profile: MajorProfile, a: I18nAdverts): Promise<I18nOutcome> {
  const g = gate(a); if (g) return g;
  const path = probePath(profile);
  const base = await get(path);
  const b = baselineSkip(base); if (b) return b;
  const tag = unsupportedTag(a.supportedLocales);
  const res = await get(path, tag);
  const findings: I18nFinding[] = [
    f(res.status === base.status && res.status !== 400 && res.status !== 406, 'i18n.md §Accept-Language ("MUST NOT reject a request because it does not support the requested locale")', `Accept-Language: ${tag} (unsupported) MUST be answered as the same request without it (${base.status}); got ${res.status}`),
    f(readErrorCode(res.json) === readErrorCode(base.json), 'i18n.md §Accept-Language + §Error envelopes', `the unsupported-locale answer MUST carry the same error code (${String(readErrorCode(base.json))}); got ${String(readErrorCode(res.json))}`),
  ];
  const cl = res.headers.get('content-language');
  if (cl !== null) {
    findings.push(
      f(BCP47.test(cl.trim()), 'i18n.md §Language tags', `Content-Language MUST be a BCP 47 tag (got ${JSON.stringify(cl)})`),
      f(primary(cl.trim()) === primary(a.defaultLocale), 'i18n.md §Fallback rules 3–4', `for an unsupported Accept-Language the host uses its default; Content-Language MUST name the locale actually used (${a.defaultLocale}), never another (got ${cl})`),
    );
  }
  return { kind: 'observed', findings };
}

/** Leg 3, malformed: a malformed header never fails the request. */
export async function malformedLeg(profile: MajorProfile, a: I18nAdverts): Promise<I18nOutcome> {
  const g = gate(a); if (g) return g;
  const path = probePath(profile);
  const base = await get(path);
  const b = baselineSkip(base); if (b) return b;
  const res = await get(path, ';;;not===a,,language q=;');
  return { kind: 'observed', findings: [
    f(res.status !== 400, 'i18n.md §Accept-Language ("A malformed value MUST NOT cause 400")', `a malformed Accept-Language MUST NOT cause 400 (got ${res.status})`),
    f(res.status === base.status && readErrorCode(res.json) === readErrorCode(base.json), 'i18n.md §Accept-Language ("the host proceeds in its default locale")', `a malformed Accept-Language MUST be answered as the request without it (${base.status} ${String(readErrorCode(base.json))}); got ${res.status} ${String(readErrorCode(res.json))}`),
  ] };
}

/** `details` keys, less `locale`, which a host MAY add when it localizes the message. */
const detailsKeys = (json: unknown): string[] => {
  const d = isRecord(json) ? json['details'] : undefined;
  return isRecord(d) ? Object.keys(d).filter((k) => k !== 'locale').sort() : [];
};

/** Leg 4, errorCode: the machine-readable parts of an error envelope are locale-invariant. */
export async function errorCodeLeg(profile: MajorProfile, a: I18nAdverts): Promise<I18nOutcome> {
  const g = gate(a); if (g) return g;
  const path = probePath(profile);
  const base = await get(path, a.defaultLocale);
  const b = baselineSkip(base); if (b) return b;
  const negotiated = a.supportedLocales.find((t) => lower(t) !== lower(a.defaultLocale)) ?? a.defaultLocale;
  const res = await get(path, negotiated);
  const code = readErrorCode(res.json);
  const doc = 'i18n.md §Error envelopes';
  const findings: I18nFinding[] = [
    f(res.status === base.status, doc, `the status MUST NOT change with the negotiated locale (${a.defaultLocale} → ${base.status}; ${negotiated} → ${res.status})`),
    f(typeof code === 'string' && ERROR_CODE.test(code), doc, `the error code is a registered identifier, never translated (got ${String(code)} under ${negotiated})`),
    f(code === readErrorCode(base.json), doc, `the error code MUST be the same identifier in every locale (${a.defaultLocale} → ${String(readErrorCode(base.json))}; ${negotiated} → ${String(code)})`),
    f(JSON.stringify(detailsKeys(res.json)) === JSON.stringify(detailsKeys(base.json)), doc, `details keys are schema field names and are not localized (${a.defaultLocale} → ${JSON.stringify(detailsKeys(base.json))}; ${negotiated} → ${JSON.stringify(detailsKeys(res.json))})`),
  ];
  const d = isRecord(res.json) ? res.json['details'] : undefined;
  const loc = isRecord(d) ? d['locale'] : undefined;
  if (loc !== undefined) findings.push(f(typeof loc === 'string' && BCP47.test(loc), 'i18n.md §Language tags ("every locale field — is a BCP 47 tag")', `details.locale MUST be a BCP 47 tag (got ${JSON.stringify(loc)})`));
  return { kind: 'observed', findings };
}
