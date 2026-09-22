/**
 * locale-key-grammar — RFC 0206 (corpus coherence).
 *
 * Localized-content locale keys (section `localizations` keys, the admin-write
 * `locale`, the language-settings locales, the page SEO locales) match the
 * case-canonical BCP 47 subset of RFC 0206 §A.1 instead of RFC 0103's
 * `ll(-RR)`. Every row here is a property of the corpus — the schemas, the two
 * OpenAPI documents and the suite's shared copy of the §C `resolveSection`
 * reference algorithm — so none needs a host.
 *
 * Runs in the corpus gate (scripts/check-spec-coherence.mjs), never in a host
 * bundle, so evidence/corpus-ledger.json carries the six `(corpus)` ids the
 * RFC's falsifiability table names:
 *
 *   key-grammar            `zh-Hans`, `zh-Hant-TW`, `es-419`, `fil` (and the
 *                          old-valid `en`, `pt-BR`) validate as section keys,
 *                          settings locales and page SEO locales — v1 and v2.
 *   key-grammar-negatives  `EN`, `en_US`, `en-us`, `zh-hans`, `de-CH-1996`,
 *                          `en-US-x-foo`, `zh-yue` are rejected at every site —
 *                          v1 and v2.
 *   wire-agreement         all twelve locale-constraining `pattern`s in the
 *                          eight wire files (three v1 schemas, three v2 twins,
 *                          both OpenAPI `putContentSection` bodies) equal §A.1.
 *   superset               every `[a-z]{2}` and `[a-z]{2}-[A-Z]{2}` string (the
 *                          whole RFC 0103 language) matches the section-key
 *                          pattern the schemas carry, v1 and v2.
 *   script-family-fallback `zh-Hant-TW` on `{zh-Hant, zh}` overlays `zh-Hant`.
 *   old-sections-unchanged over every ≤4-key subset of old-legal keys and a
 *                          fixed set of negotiated tags, the amended algorithm
 *                          equals the frozen RFC 0103 copy.
 *
 * Sabotage, each run once when this file landed (RFC 0206 §Conformance):
 * restore `^[a-z]{2}(-[A-Z]{2})?$` in one v1 schema → key-grammar and
 * wire-agreement fail; substitute the case-insensitive capabilities pattern →
 * key-grammar-negatives fails (`EN`, `en-us`, `zh-hans` pass); leave
 * `api/openapi.yaml` on the old pattern → wire-agreement names the file; a
 * pattern requiring 3-letter languages → superset fails; delete the new step
 * from `resolveSection` → script-family-fallback fails (`简`); let the new step
 * try any 2-subtag prefix → old-sections-unchanged fails on `de-CH-1996`.
 *
 * @see RFCS/0206-locale-keys-accept-negotiated-bcp47.md
 * @see spec/v1/localized-content.md §B, §C, §D
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { API_DIR, SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import {
  LOCALE_KEY_PATTERN,
  LOCALE_KEY_PATTERN_RFC0103,
  resolveSection,
  resolveSectionRfc0103,
  type Section,
} from '../lib/localized-content.js';

const SECTION = 'RFC 0206 §A; localized-content.md §B';
const ID_GRAMMAR = 'openwop.requirement.0206.key-grammar';
const ID_NEGATIVES = 'openwop.requirement.0206.key-grammar-negatives';
const ID_WIRE = 'openwop.requirement.0206.wire-agreement';
const ID_SUPERSET = 'openwop.requirement.0206.superset';
const ID_SCRIPT = 'openwop.requirement.0206.script-family-fallback';
const ID_IDENTITY = 'openwop.requirement.0206.old-sections-unchanged';

/** §A.1, written out here rather than imported: the test must not agree with the corpus by construction. */
const NEW = '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$';

const POSITIVES = ['en', 'pt-BR', 'zh-Hans', 'zh-Hant-TW', 'sr-Latn-RS', 'es-419', 'fil', 'yue'] as const;
const NEGATIVES = ['EN', 'en_US', 'en-us', 'zh-hans', 'de-CH-1996', 'en-US-x-foo', 'zh-yue'] as const;

type Json = Record<string, unknown>;
const readJson = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;

const MAJORS = [
  { label: 'v1', dir: SCHEMAS_DIR },
  { label: 'v2', dir: join(SCHEMAS_DIR, 'v2') },
] as const;
const FILES = ['section', 'language-settings', 'page'].map((f) => `localized-content-${f}.schema.json`);

/** Every locale-constraining site of RFC 0206 §A.1, per schema file. */
const SCHEMA_SITES: Record<string, string[][]> = {
  'localized-content-section.schema.json': [['properties', 'localizations', 'propertyNames', 'pattern']],
  'localized-content-language-settings.schema.json': [
    ['properties', 'baseLocale', 'pattern'],
    ['properties', 'supportedLocales', 'items', 'pattern'],
  ],
  'localized-content-page.schema.json': [
    ['properties', 'seo', 'properties', 'hreflang', 'items', 'properties', 'locale', 'pattern'],
    ['properties', 'seo', 'properties', 'ogLocaleAlternates', 'items', 'pattern'],
  ],
};
const OPENAPI = [
  { label: 'api/openapi.yaml', path: join(API_DIR, 'openapi.yaml') },
  { label: 'api/v2/openapi.yaml', path: join(API_DIR, 'v2', 'openapi.yaml') },
] as const;

function available(): string | null {
  if (V1_DIR === null) return 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';
  for (const m of MAJORS) for (const f of FILES) if (!existsSync(join(m.dir, f))) return `inapplicable to any host: ${m.label}/${f} is absent from this layout`;
  for (const o of OPENAPI) if (!existsSync(o.path)) return `inapplicable to any host: ${o.label} is absent from this layout`;
  return null;
}

function at(doc: unknown, path: string[]): unknown {
  let cur: unknown = doc;
  for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Json)[k] : undefined;
  return cur;
}

/**
 * The `locale` pattern of the `putContentSection` request body, read from the
 * YAML text (the suite carries no YAML parser): the first `pattern:` after the
 * body's `locale:` key inside that operation's block.
 */
function putContentSectionLocalePattern(yaml: string): string | null {
  const start = yaml.indexOf('operationId: putContentSection');
  if (start < 0) return null;
  const rest = yaml.slice(start);
  const end = rest.search(/\n {4}(get|put|post|patch|delete):|\n {2}\/\S/);
  const block = end < 0 ? rest : rest.slice(0, end);
  const m = /\n(\s+)locale:\s*\n(?:\1\s+.*\n)*?\1\s+pattern:\s*(.+)\n/.exec(block);
  if (!m) return null;
  return m[2]!.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

function validators(dir: string) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const c = (f: string) => ajv.compile(readJson(join(dir, `localized-content-${f}.schema.json`)));
  const section = c('section');
  const settings = c('language-settings');
  const page = c('page');
  return {
    section: (key: string) => section({ sectionId: 'hero', sectionType: 'hero', data: { h: 'x' }, localizations: { [key]: { h: 'y' } }, status: 'published', enabled: true, order: 0 }),
    settingsBase: (key: string) => settings({ baseLocale: key, supportedLocales: [], autoTranslateOnPublish: false }),
    settingsSupported: (key: string) => settings({ baseLocale: 'en', supportedLocales: [key], autoTranslateOnPublish: false }),
    hreflang: (key: string) => page({ pageId: 'home', slug: 'home', name: 'Home', status: 'published', sectionOrder: [], seo: { hreflang: [{ locale: key, href: 'https://example.com/' }] } }),
    ogAlternate: (key: string) => page({ pageId: 'home', slug: 'home', name: 'Home', status: 'published', sectionOrder: [], seo: { ogLocaleAlternates: [key] } }),
  };
}

describe('locale-key-grammar (RFC 0206, corpus)', () => {
  it('extended BCP 47 keys validate at every locale site, v1 and v2', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);
    for (const m of MAJORS) {
      const v = validators(m.dir);
      for (const key of POSITIVES) {
        for (const [site, fn] of Object.entries(v)) {
          expect(fn(key), req(ID_GRAMMAR, SECTION, `${m.label}: "${key}" MUST validate as ${site} (RFC 0206 §A.1 positive example)`)).toBe(true);
        }
      }
      // The RFC's composite example: a settings object and a section with several keys at once.
      const settings = new Ajv2020({ strict: false }).compile(readJson(join(m.dir, 'localized-content-language-settings.schema.json')));
      expect(settings({ baseLocale: 'en', supportedLocales: ['es-419', 'zh-Hant'], autoTranslateOnPublish: false }), req(ID_GRAMMAR, SECTION, `${m.label}: supportedLocales ["es-419","zh-Hant"] MUST validate`)).toBe(true);
    }
  });

  it('non-canonical and out-of-subset tags are rejected at every locale site, v1 and v2', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);
    for (const m of MAJORS) {
      const v = validators(m.dir);
      for (const key of NEGATIVES) {
        for (const [site, fn] of Object.entries(v)) {
          expect(fn(key), req(ID_NEGATIVES, SECTION, `${m.label}: "${key}" MUST be rejected as ${site} (RFC 0206 §A.1 negative example; EN / en_US unchanged from RFC 0103)`)).toBe(false);
        }
      }
    }
  });

  it('the eight wire files carry the section A.1 pattern at all twelve sites', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);
    const found: Array<{ site: string; pattern: unknown }> = [];
    for (const m of MAJORS) {
      for (const [file, sites] of Object.entries(SCHEMA_SITES)) {
        const doc = readJson(join(m.dir, file));
        for (const p of sites) found.push({ site: `schemas/${m.label === 'v2' ? 'v2/' : ''}${file} ${p.join('.')}`, pattern: at(doc, p) });
      }
    }
    for (const o of OPENAPI) found.push({ site: `${o.label} putContentSection body locale`, pattern: putContentSectionLocalePattern(readFileSync(o.path, 'utf8')) });
    expect(found.length, req(ID_WIRE, 'RFC 0206 §A.1', 'every one of the twelve locale-constraining sites is enumerated')).toBe(12);
    const disagree = found.filter((f) => f.pattern !== NEW).map((f) => `${f.site} = ${JSON.stringify(f.pattern)}`);
    expect(disagree, req(ID_WIRE, 'RFC 0206 §A.1', `every locale-constraining pattern MUST equal ${NEW}`)).toEqual([]);
    expect(LOCALE_KEY_PATTERN, req(ID_WIRE, 'RFC 0206 §A.1', 'the suite lib constant agrees with §A.1')).toBe(NEW);
  });

  it('the new grammar is a strict superset of the RFC 0103 subset', () => {
    const why = available();
    if (why !== null) return softSkip('inapplicable', why);
    const old = new RegExp(LOCALE_KEY_PATTERN_RFC0103);
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const langs: string[] = [];
    for (const a of letters) for (const b of letters) langs.push(a + b);
    const regions = langs.map((l) => l.toUpperCase());
    for (const m of MAJORS) {
      const pattern = at(readJson(join(m.dir, 'localized-content-section.schema.json')), SCHEMA_SITES['localized-content-section.schema.json']![0]!);
      expect(typeof pattern, req(ID_SUPERSET, 'RFC 0206 §A.3', `${m.label}: the section-key pattern is present`)).toBe('string');
      const re = new RegExp(pattern as string);
      const misses: string[] = [];
      let checked = 0;
      for (const l of langs) {
        checked += 1;
        if (!re.test(l)) misses.push(l);
        for (const r of regions) {
          const tag = `${l}-${r}`;
          checked += 1;
          if (!old.test(tag)) throw new Error(`enumeration bug: ${tag} is not RFC 0103-valid`);
          if (!re.test(tag) && misses.length < 20) misses.push(tag);
        }
      }
      expect(checked, req(ID_SUPERSET, 'RFC 0206 §A.3', `${m.label}: the enumeration is exhaustive (676 + 676×676)`)).toBe(676 + 676 * 676);
      expect(misses, req(ID_SUPERSET, 'RFC 0206 §A.3', `${m.label}: every string the RFC 0103 grammar admitted MUST still validate`)).toEqual([]);
    }
  });

  it('resolveSection reaches the script subtag before the language', () => {
    const s: Section = { data: { h: 'x' }, localizations: { 'zh-Hant': { h: '繁' }, zh: { h: '简' } } };
    expect(resolveSection(s, 'zh-Hant-TW', 'en'), req(ID_SCRIPT, 'RFC 0206 §B.4; localized-content.md §C', 'zh-Hant-TW MUST overlay the zh-Hant localization before zh')).toEqual({ h: '繁' });
    // Controls: the exact hit still wins, and a script-less region tag still falls to the language.
    expect(resolveSection({ ...s, localizations: { ...s.localizations, 'zh-Hant-TW': { h: '台' } } }, 'zh-Hant-TW', 'en'), req(ID_SCRIPT, 'RFC 0206 §B.4', 'an exact key still wins over the script family')).toEqual({ h: '台' });
    expect(resolveSection(s, 'zh-TW', 'en'), req(ID_SCRIPT, 'RFC 0206 §B.4', 'zh-TW (no script subtag) falls to the zh family')).toEqual({ h: '简' });
    expect(resolveSection(s, 'zh-Hant', 'en'), req(ID_SCRIPT, 'RFC 0206 §B.4', 'an exact ll-Ssss hit is the exact branch')).toEqual({ h: '繁' });
  });

  it('every section valid before RFC 0206 resolves exactly as RFC 0103 resolved it', () => {
    const keys = ['de', 'de-CH', 'zh', 'zh-TW', 'pt', 'pt-BR', 'en', 'sr'];
    const negotiated = ['de-CH-1996', 'zh-Hant-TW', 'pt-BR', 'sr-Latn-RS', 'de', 'zh-TW', 'en-US', 'x'];
    const base = 'fr';
    const subsets: string[][] = [[]];
    for (const k of keys) for (const s of [...subsets]) if (s.length < 4) subsets.push([...s, k]);
    expect(subsets.length, req(ID_IDENTITY, 'RFC 0206 §B.5', 'every subset of size ≤ 4 of the eight old-legal keys (163)')).toBe(163);
    const oldKey = new RegExp(LOCALE_KEY_PATTERN_RFC0103);
    const diffs: string[] = [];
    let cases = 0;
    for (const set of subsets) {
      const section: Section = { data: { base: 'b', h: 'x' }, localizations: Object.fromEntries(set.map((k) => [k, { h: k }])) };
      expect(set.every((k) => oldKey.test(k)), req(ID_IDENTITY, 'RFC 0206 §B.5', 'the key corpus is RFC 0103-valid')).toBe(true);
      for (const n of negotiated) {
        cases += 1;
        const a = resolveSection(section, n, base);
        const b = resolveSectionRfc0103(section, n, base);
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`{${set.join(',')}} × ${n}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
      }
    }
    expect(cases, req(ID_IDENTITY, 'RFC 0206 §B.5', '163 × 8 cases were compared')).toBe(163 * 8);
    expect(diffs, req(ID_IDENTITY, 'RFC 0206 §B.5; localized-content.md §C', 'the amended resolveSection MUST equal RFC 0103 on every previously valid section')).toEqual([]);
  });
});
