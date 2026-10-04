/**
 * The localized-content advertisement-coherence judge (`i18n.md` §Localized
 * content, "Advertisement"; `capabilities.schema.json` §content), shared by
 * every major that states it. Pure: it reads a discovery document and asserts
 * nothing; the scenario maps the findings to requirement ids and
 * `localized-content-witness.test.ts` proves each rule in both directions.
 *
 * A host advertising `content`:
 *   1. advertises `i18n`;
 *   2. has `content.baseLocale` equal to `i18n.defaultLocale` (`en` when omitted);
 *   3. lists every locale of `baseLocale ∪ content.supportedLocales` in
 *      `i18n.supportedLocales`;
 *   4. does not list `baseLocale` in `content.supportedLocales` (stated by the
 *      schema's `supportedLocales` description).
 *
 * Tags compare case-insensitively (`i18n.md` §Language tags).
 */

import type { MajorProfile } from './major-profile.js';

export interface ContentFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type ContentOutcome =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly findings: readonly ContentFinding[] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);
const f = (ok: boolean, doc: string, message: string): ContentFinding => ({ ok, doc, message });
const DOC = 'i18n.md §Localized content ("Advertisement")';

export function coherenceLeg(profile: MajorProfile, discovery: unknown): ContentOutcome {
  const content = profile.family(discovery, 'content');
  if (content === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise content' };
  const i18n = profile.family(discovery, 'i18n');
  const findings: ContentFinding[] = [f(i18n !== null, DOC, 'a host advertising content MUST advertise i18n')];
  if (i18n === null) return { kind: 'observed', findings };

  const base = typeof content['baseLocale'] === 'string' ? (content['baseLocale'] as string) : undefined;
  const supported = strings(content['supportedLocales']);
  const def = typeof i18n['defaultLocale'] === 'string' ? (i18n['defaultLocale'] as string) : 'en';
  // An i18n record without supportedLocales serves its default alone.
  const i18nSet = new Set((i18n['supportedLocales'] === undefined ? [def] : strings(i18n['supportedLocales'])).map((t) => t.toLowerCase()));

  findings.push(f(base !== undefined && base.toLowerCase() === def.toLowerCase(), DOC, `content.baseLocale MUST equal i18n.defaultLocale (got baseLocale ${String(base)}, defaultLocale ${def})`));
  const resolvable = [...(base === undefined ? [] : [base]), ...supported];
  const missing = resolvable.filter((t) => !i18nSet.has(t.toLowerCase()));
  findings.push(f(missing.length === 0, DOC, `every locale in baseLocale ∪ content.supportedLocales MUST be in i18n.supportedLocales (missing ${JSON.stringify(missing)})`));
  findings.push(f(base === undefined || !supported.some((t) => t.toLowerCase() === base.toLowerCase()), 'capabilities.schema.json §content.supportedLocales', `content.supportedLocales MUST NOT contain baseLocale ${String(base)} (got ${JSON.stringify(supported)})`));
  return { kind: 'observed', findings };
}
