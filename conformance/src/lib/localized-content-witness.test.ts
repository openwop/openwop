/**
 * The localized-content coherence judge at major 2, proven in both
 * directions: a coherent advertisement passes, and each incoherence fails
 * exactly the one finding that owns it. The judge is pure, so its inputs are
 * discovery documents; no double is needed.
 */

import { describe, expect, it } from 'vitest';
import { majorProfile } from './major-profile.js';
import { coherenceLeg, type ContentOutcome } from './localized-content-witness.js';

const V2 = majorProfile(2);
const rec = { status: 'experimental', since: '2.0', until: '2.9', witness: 'witnessable-gated' };
const i18n = (r: Record<string, unknown> = {}): Record<string, unknown> => ({ ...rec, defaultLocale: 'en', supportedLocales: ['en', 'es', 'pt-BR', 'fr'], ...r });
const content = (r: Record<string, unknown> = {}): Record<string, unknown> => ({ ...rec, baseLocale: 'en', supportedLocales: ['es', 'pt-BR'], ...r });
const failed = (o: ContentOutcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);

describe('localized-content coherence judge at major 2 (i18n.md §Localized content)', () => {
  it('a coherent advertisement passes, comparing tags case-insensitively', () => {
    expect(failed(coherenceLeg(V2, { i18n: i18n(), content: content() }))).toEqual([]);
    expect(failed(coherenceLeg(V2, { i18n: i18n(), content: content({ supportedLocales: ['ES', 'pt-br'] }) }))).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['content without i18n', { content: content() }, /MUST advertise i18n/],
    ['baseLocale != defaultLocale', { i18n: i18n(), content: content({ baseLocale: 'es', supportedLocales: ['fr'] }) }, /MUST equal i18n.defaultLocale/],
    ['a content locale outside i18n.supportedLocales', { i18n: i18n(), content: content({ supportedLocales: ['de'] }) }, /MUST be in i18n.supportedLocales/],
    ['baseLocale inside content.supportedLocales', { i18n: i18n(), content: content({ supportedLocales: ['en', 'es'] }) }, /MUST NOT contain baseLocale/],
    ['an omitted defaultLocale defaults to en', { i18n: i18n({ defaultLocale: undefined }), content: content({ baseLocale: 'es', supportedLocales: [] }) }, /MUST equal i18n.defaultLocale/],
  ])('%s fails exactly one finding', (_what, doc, want) => {
    const out = failed(coherenceLeg(V2, doc));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(want);
  });

  it('an i18n record without supportedLocales serves only its default', () => {
    expect(failed(coherenceLeg(V2, { i18n: { ...rec, defaultLocale: 'en' }, content: content({ supportedLocales: [] }) }))).toEqual([]);
    expect(failed(coherenceLeg(V2, { i18n: { ...rec, defaultLocale: 'en' }, content: content({ supportedLocales: ['es'] }) }))).toHaveLength(1);
  });

  it('no content record is inapplicable, never a false pass', () => {
    expect(coherenceLeg(V2, { i18n: i18n() })).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });
});
