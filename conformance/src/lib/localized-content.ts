/**
 * The `resolveSection` reference algorithm of `spec/v1/localized-content.md`
 * §C, shared verbatim with conforming hosts (RFC 0103; amended by RFC 0206
 * §B.4). One copy, so the major-1 scenario and the corpus coherence test
 * cannot drift apart (RFC 0206 register G5).
 *
 * `resolveSectionRfc0103` is the algorithm exactly as RFC 0103 shipped it,
 * FROZEN: it exists only so the RFC 0206 §B.5 identity property can be
 * checked (the amended algorithm returns what this one returns on every
 * section that was valid before RFC 0206). Never edit it.
 *
 * @see spec/v1/localized-content.md §C
 * @see RFCS/0206-locale-keys-accept-negotiated-bcp47.md §B
 */

export type Section = {
  data: Record<string, unknown>;
  localizations: Record<string, Record<string, unknown>>;
};

/** RFC 0206 §A.1 — the case-canonical BCP 47 subset every stored locale key matches. */
export const LOCALE_KEY_PATTERN = '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$';
/** RFC 0103's subset, superseded by RFC 0206 (kept for the superset and identity properties). */
export const LOCALE_KEY_PATTERN_RFC0103 = '^[a-z]{2}(-[A-Z]{2})?$';

/** §C as amended by RFC 0206 §B.4: exact → script-family → language-family → base. */
export function resolveSection(section: Section, negotiatedLocale: string, baseLocale: string): Record<string, unknown> {
  const loc = section.localizations ?? {};
  if (negotiatedLocale === baseLocale || Object.keys(loc).length === 0) return section.data;
  if (loc[negotiatedLocale]) return { ...section.data, ...loc[negotiatedLocale] };
  const parts = negotiatedLocale.split('-');
  if (parts.length >= 3 && /^[A-Za-z]{4}$/.test(parts[1]!)) {
    const ls = `${parts[0]}-${parts[1]}`;
    if (loc[ls]) return { ...section.data, ...loc[ls] };
  }
  if (parts.length >= 2) {
    const lang = parts[0]!;
    if (loc[lang]) return { ...section.data, ...loc[lang] };
  }
  return section.data;
}

/** §C exactly as RFC 0103 shipped it — FROZEN (the RFC 0206 §B.5 identity oracle). */
export function resolveSectionRfc0103(section: Section, negotiatedLocale: string, baseLocale: string): Record<string, unknown> {
  const loc = section.localizations ?? {};
  if (negotiatedLocale === baseLocale || Object.keys(loc).length === 0) return section.data;
  if (loc[negotiatedLocale]) return { ...section.data, ...loc[negotiatedLocale] };
  if (negotiatedLocale.includes('-')) {
    const lang = negotiatedLocale.split('-')[0]!;
    if (loc[lang]) return { ...section.data, ...loc[lang] };
  }
  return section.data;
}
