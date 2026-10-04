/**
 * v2 — localized content (`spec/v2/core/i18n.md` §Localized content;
 * `schemas/v2/localized-content-*.schema.json`; RFCs 0103, 0206). The v1 twin
 * is `localized-content-delivery`.
 *
 * Two layers:
 *
 *   A. Server-free — the v2 `content` capability record (no `supported` seat;
 *      presence is the claim), the four v2 content schemas, and the section
 *      merge every host MUST resolve identically (exact tag → `ll-Ssss` script
 *      family → language → `data`, shallow overlay), against the suite's one
 *      reference copy in `lib/localized-content.ts`.
 *
 *   B. Live — the advertised `content` record is coherent with the advertised
 *      `i18n` record (`lib/localized-content-witness.ts`, a pure judge proven in
 *      `localized-content-witness.test.ts`). Gated by the presence of the v2
 *      `content` record: absent ⇒ `inapplicable`.
 *
 * Not ported here: the `/content/*` delivery legs (published-only, tenant
 * isolation, no enumeration); v1 never drove them either.
 *
 * @see spec/v2/core/i18n.md §Localized content
 * @see SECURITY/invariants.yaml id: content-published-cache-no-draft, content-response-tenant-scoped
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { familyAdvertised, v2Discovery, v2RefValidator, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { resolveSection, type Section } from '../lib/localized-content.js';
import { coherenceLeg } from '../lib/localized-content-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'spec/v2/core/i18n.md §Localized content';
const ID_RECORD = 'openwop.requirement.content.capability-record-shape';
const ID_SECTION = 'openwop.requirement.content.section-schema';
const ID_PAGE = 'openwop.requirement.content.page-schema';
const ID_SETTINGS = 'openwop.requirement.content.language-settings-schema';
const ID_RESPONSE = 'openwop.requirement.content.page-response-schema';
const ID_MERGE = 'openwop.requirement.content.section-merge';
const ID_COHERENT = 'openwop.requirement.content.advertisement-coherent';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];

const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8')) as { properties: Record<string, { required?: string[]; properties?: Record<string, unknown> }> };
const section = v2Validator('localized-content-section');
const page = v2Validator('localized-content-page');
const settings = v2Validator('localized-content-language-settings');
const response = v2Validator('localized-content-page-response');
const contentRecord = v2RefValidator('capabilities.schema.json#/properties/content');

const goodSection = {
  sectionId: 'hero', sectionType: 'hero', data: { heading: 'Welcome', cta: 'Get started' },
  localizations: { es: { heading: 'Bienvenido', cta: 'Empezar' }, 'pt-BR': { heading: 'Bem-vindo' } },
  status: 'published', enabled: true, order: 0,
};

describe('v2 localized content: the capability record (server-free)', () => {
  it('the v2 content record requires baseLocale and supportedLocales and has no supported seat', () => {
    const content = caps.properties['content'];
    expect(content?.required, req(ID_RECORD, 'schemas/v2/capabilities.schema.json §content', 'content MUST require baseLocale and supportedLocales')).toEqual(expect.arrayContaining(['baseLocale', 'supportedLocales']));
    expect(content?.properties?.['supported'], req(ID_RECORD, 'spec/v2/core/capabilities.md (presence is the claim)', 'the v2 content record MUST NOT declare a supported seat')).toBeUndefined();
    const base = { status: 'experimental', since: '2.0', until: '2.9', witness: 'witnessable-gated' };
    expect(contentRecord({ ...base, baseLocale: 'en', supportedLocales: ['es'] }).ok, req(ID_RECORD, 'schemas/v2/capabilities.schema.json §content', 'a conforming content record MUST validate')).toBe(true);
    expect(contentRecord({ ...base, supported: true, baseLocale: 'en', supportedLocales: ['es'] }).ok, req(ID_RECORD, 'schemas/v2/capabilities.schema.json §content', 'a content record carrying supported MUST be rejected (closed record)')).toBe(false);
  });
});

describe('v2 localized content: schema shapes (server-free)', () => {
  it('a conforming section validates; a non-canonical or underscore locale key, a missing status, or an unknown status is rejected', () => {
    expect(section(goodSection).ok, req(ID_SECTION, DOC, `a conforming section MUST validate: ${section(goodSection).errors}`)).toBe(true);
    for (const key of ['zh-Hans', 'zh-Hant-TW', 'es-419', 'fil']) {
      expect(section({ ...goodSection, localizations: { [key]: { heading: 'x' } } }).ok, req(ID_SECTION, 'RFC 0206 §A.1', `${key} MUST validate as a localizations key`)).toBe(true);
    }
    for (const key of ['EN', 'en_US', 'en-us', 'zh-hans', 'de-CH-1996']) {
      expect(section({ ...goodSection, localizations: { [key]: { heading: 'x' } } }).ok, req(ID_SECTION, 'RFC 0206 §A.1', `${key} MUST be rejected as a localizations key`)).toBe(false);
    }
    const { status: _omit, ...noStatus } = goodSection;
    expect(section(noStatus).ok, req(ID_SECTION, DOC, 'status is REQUIRED')).toBe(false);
    expect(section({ ...goodSection, status: 'archived' }).ok, req(ID_SECTION, DOC, 'status MUST be draft or published')).toBe(false);
    expect(section({ ...goodSection, extra: true }).ok, req(ID_SECTION, DOC, 'a section is a closed record')).toBe(false);
  });

  it('a conforming page validates and a bad slug is rejected', () => {
    const good = { pageId: 'home', slug: 'home', name: 'Home', status: 'published', sectionOrder: ['hero'] };
    expect(page(good).ok, req(ID_PAGE, DOC, `a conforming page MUST validate: ${page(good).errors}`)).toBe(true);
    expect(page({ ...good, slug: 'Home Page' }).ok, req(ID_PAGE, DOC, 'slug MUST match ^[a-z][a-z0-9-]*$')).toBe(false);
  });

  it('a conforming language-settings document validates', () => {
    const good = { baseLocale: 'en', supportedLocales: ['es', 'pt-BR', 'fr'], autoTranslateOnPublish: false };
    expect(settings(good).ok, req(ID_SETTINGS, DOC, `settings MUST validate: ${settings(good).errors}`)).toBe(true);
    expect(settings({ ...good, baseLocale: 'en_US' }).ok, req(ID_SETTINGS, DOC, 'baseLocale MUST be a canonical BCP 47 key')).toBe(false);
  });

  it('a conforming page response validates', () => {
    const good = {
      version: '1', generatedAt: '2026-06-17T00:00:00Z', locale: 'pt-BR', slug: 'home',
      page: { pageId: 'home', slug: 'home', name: 'Home' },
      sections: [{ sectionId: 'hero', sectionType: 'hero', data: { heading: 'Bem-vindo', cta: 'Get started' } }],
    };
    expect(response(good).ok, req(ID_RESPONSE, DOC, `a resolved response MUST validate: ${response(good).errors}`)).toBe(true);
    expect(response({ ...good, sections: [{ ...good.sections[0], localizations: {} }] }).ok, req(ID_RESPONSE, DOC, 'a delivered section carries resolved data, never its localizations')).toBe(false);
  });
});

describe('v2 localized content: the section merge every host resolves identically (server-free)', () => {
  it('exact tag, then script family, then language, then data — a shallow overlay', () => {
    const s: Section = { data: { heading: 'Welcome', cta: 'Get started' }, localizations: { es: { heading: 'Bienvenido', cta: 'Empezar' }, 'pt-BR': { heading: 'Bem-vindo' } } };
    expect(resolveSection(s, 'es', 'en'), req(ID_MERGE, DOC, 'an exact hit MUST overlay its fields onto data')).toEqual({ heading: 'Bienvenido', cta: 'Empezar' });
    expect(resolveSection(s, 'pt-BR', 'en'), req(ID_MERGE, DOC, 'a field the overlay lacks MUST fall through to data')).toEqual({ heading: 'Bem-vindo', cta: 'Get started' });
    expect(resolveSection({ data: { h: 'Hi' }, localizations: { pt: { h: 'Oi' } } }, 'pt-BR', 'en'), req(ID_MERGE, DOC, 'pt-BR MUST fall back to the pt language overlay')).toEqual({ h: 'Oi' });
    expect(resolveSection({ data: { h: 'x' }, localizations: { 'zh-Hant': { h: '繁' }, zh: { h: '简' } } }, 'zh-Hant-TW', 'en'), req(ID_MERGE, DOC, 'zh-Hant-TW MUST take the zh-Hant script family before zh')).toEqual({ h: '繁' });
    expect(resolveSection(s, 'de', 'en'), req(ID_MERGE, DOC, 'no overlay MUST resolve to data alone')).toEqual(s.data);
    expect(resolveSection(s, 'en', 'en'), req(ID_MERGE, DOC, 'baseLocale MUST resolve to data')).toEqual(s.data);
  });
});

describe('v2 localized content: live advertisement coherence (i18n.md §Localized content "Advertisement")', () => {
  it('the advertised content record is coherent with the advertised i18n record', async () => {
    if (HTTP_SKIP) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    const content = await familyAdvertised('content');
    if (content === null) return softSkip('inapplicable', 'the host does not advertise content');
    const out = coherenceLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    const v = contentRecord(content);
    expect(v.ok, req(ID_COHERENT, 'schemas/v2/capabilities.schema.json §content', `the content record MUST validate: ${v.errors}`)).toBe(true);
    for (const x of out.findings) expect(x.ok, req(ID_COHERENT, x.doc, x.message)).toBe(true);
  });
});
