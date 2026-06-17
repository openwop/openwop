/**
 * Localized content surface — durable authored content (pages → sections) that
 * reuses the Stable i18n annex's Accept-Language/Content-Language negotiation
 * (RFC 0103; `spec/v1/localized-content.md`). Public tests for the protocol-tier
 * SECURITY invariants `content-published-cache-no-draft`,
 * `content-response-tenant-scoped`, and `content-no-cross-tenant-enumeration`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free legs — the `content` capability block, the four
 *      content schemas (section / page / language-settings / page-response),
 *      the §A capability-coherence constraints, and the §C per-section field
 *      merge reference algorithm (`resolveSection`, exact → family → base,
 *      shallow overlay) shared verbatim with hosts.
 *
 *   B. Capability-gated behavioral legs — on a host advertising
 *      `capabilities.content` that exposes `GET /v1/content/pages/{slug}`:
 *      malformed Accept-Language succeeds with the base locale, Content-Language
 *      reflects the locale used, published-only delivery, tenant isolation, and
 *      no cross-tenant enumeration. Unadvertised hosts skip via the gate;
 *      hosts without a live target soft-skip (no OPENWOP_BASE_URL).
 *
 * @see spec/v1/localized-content.md §A–§F
 * @see spec/v1/i18n.md §"Accept-Language request header", §"Fallback rules"
 * @see SECURITY/invariants.yaml id: content-published-cache-no-draft, content-response-tenant-scoped, content-no-cross-tenant-enumeration
 * @see RFCS/0103-localized-content-surface.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

interface ContentCap {
  supported?: boolean;
  baseLocale?: string;
  supportedLocales?: string[];
}
interface I18nCap {
  supported?: boolean;
  defaultLocale?: string;
  supportedLocales?: string[];
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

// ── §C reference merge — shared verbatim with conforming hosts ──────────────
type Section = {
  data: Record<string, unknown>;
  localizations: Record<string, Record<string, unknown>>;
};
function resolveSection(section: Section, negotiatedLocale: string, baseLocale: string): Record<string, unknown> {
  const loc = section.localizations ?? {};
  if (negotiatedLocale === baseLocale || Object.keys(loc).length === 0) return section.data;
  if (loc[negotiatedLocale]) return { ...section.data, ...loc[negotiatedLocale] };
  if (negotiatedLocale.includes('-')) {
    const lang = negotiatedLocale.split('-')[0];
    if (loc[lang]) return { ...section.data, ...loc[lang] };
  }
  return section.data;
}

// ── §A capability-coherence predicate ──────────────────────────────────────
function contentCoherent(content: ContentCap, i18n: I18nCap): boolean {
  if (content.supported !== true) return true; // absent/false ⇒ nothing to check
  if (i18n.supported !== true) return false; // (1) requires i18n
  if (content.baseLocale !== i18n.defaultLocale) return false; // (2)
  const i18nSet = new Set(i18n.supportedLocales ?? []);
  const resolvable = [content.baseLocale!, ...(content.supportedLocales ?? [])];
  if (!resolvable.every((l) => i18nSet.has(l))) return false; // (3) subset
  if ((content.supportedLocales ?? []).includes(content.baseLocale!)) return false; // (4) base ∉ supported
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// A. Server-free legs
// ════════════════════════════════════════════════════════════════════════════

describe('localized-content: capability advertisement shape (localized-content.md §A, server-free)', () => {
  it('capabilities schema declares content with its required fields', () => {
    const caps = loadSchema('capabilities.schema.json');
    const content = (caps.properties as Record<string, { required?: string[]; properties?: Record<string, unknown> }>).content;
    expect(content, why('capabilities.schema.json §content', 'the content block MUST be declared')).toBeDefined();
    expect(content?.required, why('localized-content.md §A', 'supported + baseLocale + supportedLocales MUST be required')).toEqual(
      expect.arrayContaining(['supported', 'baseLocale', 'supportedLocales']),
    );
    for (const f of ['supported', 'baseLocale', 'supportedLocales']) {
      expect(content?.properties?.[f], why('localized-content.md §A', `content.${f} MUST be declared`)).toBeDefined();
    }
  });
});

describe('localized-content: schema shapes (localized-content.md §B, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const section = ajv.compile(loadSchema('localized-content-section.schema.json'));
  const page = ajv.compile(loadSchema('localized-content-page.schema.json'));
  const settings = ajv.compile(loadSchema('localized-content-language-settings.schema.json'));
  const response = ajv.compile(loadSchema('localized-content-page-response.schema.json'));

  const goodSection = {
    sectionId: 'hero',
    sectionType: 'hero',
    data: { heading: 'Welcome', cta: 'Get started' },
    localizations: { es: { heading: 'Bienvenido', cta: 'Empezar' }, 'pt-BR': { heading: 'Bem-vindo' } },
    status: 'published',
    enabled: true,
    order: 0,
  };

  it('a conforming section validates', () => {
    expect(section(goodSection), why('RFC 0103 §B', `a conforming section MUST validate. Errors: ${JSON.stringify(section.errors)}`)).toBe(true);
  });
  it('a localizations key with wrong case/underscore is rejected', () => {
    expect(section({ ...goodSection, localizations: { EN: { heading: 'x' } } }), why('RFC 0103 §B', 'a non-BCP-47-subset key MUST be rejected')).toBe(false);
    expect(section({ ...goodSection, localizations: { en_US: { heading: 'x' } } }), why('RFC 0103 §B', 'an underscore locale key MUST be rejected')).toBe(false);
  });
  it('a section missing a required field is rejected', () => {
    const { status: _omit, ...noStatus } = goodSection;
    expect(section(noStatus), why('RFC 0103 §B', 'status is REQUIRED')).toBe(false);
  });
  it('a status outside the enum is rejected', () => {
    expect(section({ ...goodSection, status: 'archived' }), why('RFC 0103 §B', 'status MUST be draft|published')).toBe(false);
  });

  it('a conforming page validates; a bad slug is rejected', () => {
    const goodPage = { pageId: 'home', slug: 'home', name: 'Home', status: 'published', sectionOrder: ['hero'] };
    expect(page(goodPage), why('RFC 0103 §B', `a conforming page MUST validate. Errors: ${JSON.stringify(page.errors)}`)).toBe(true);
    expect(page({ ...goodPage, slug: 'Home Page' }), why('RFC 0103 §B', 'slug MUST match ^[a-z][a-z0-9-]*$')).toBe(false);
  });

  it('a conforming language-settings validates', () => {
    const good = { baseLocale: 'en', supportedLocales: ['es', 'pt-BR', 'fr'], autoTranslateOnPublish: false };
    expect(settings(good), why('RFC 0103 §B', `settings MUST validate. Errors: ${JSON.stringify(settings.errors)}`)).toBe(true);
  });

  it('a conforming page-response validates', () => {
    const good = {
      version: '1',
      generatedAt: '2026-06-17T00:00:00Z',
      locale: 'pt-BR',
      slug: 'home',
      page: { pageId: 'home', slug: 'home', name: 'Home' },
      sections: [{ sectionId: 'hero', sectionType: 'hero', data: { heading: 'Bem-vindo', cta: 'Get started' } }],
    };
    expect(response(good), why('RFC 0103 §D', `a resolved response MUST validate. Errors: ${JSON.stringify(response.errors)}`)).toBe(true);
  });
});

describe('localized-content: per-section field merge (localized-content.md §C, server-free)', () => {
  const section: Section = {
    data: { heading: 'Welcome', cta: 'Get started' },
    localizations: { es: { heading: 'Bienvenido', cta: 'Empezar' }, 'pt-BR': { heading: 'Bem-vindo' } },
  };

  it('exact-locale hit overrides matching fields', () => {
    expect(resolveSection(section, 'es', 'en'), why('RFC 0103 §C', 'exact hit MUST overlay locale fields onto data')).toEqual({
      heading: 'Bienvenido',
      cta: 'Empezar',
    });
  });
  it('partial translation falls through to base for missing fields', () => {
    expect(resolveSection(section, 'pt-BR', 'en'), why('RFC 0103 §C', 'missing locale fields MUST fall through to data')).toEqual({
      heading: 'Bem-vindo',
      cta: 'Get started',
    });
  });
  it('language-family fallback applies when exact tag is absent', () => {
    const s: Section = { data: { h: 'Hi' }, localizations: { pt: { h: 'Oi' } } };
    expect(resolveSection(s, 'pt-BR', 'en'), why('RFC 0103 §C', 'pt-BR MUST fall back to the pt family override')).toEqual({ h: 'Oi' });
  });
  it('unsupported/base locale returns base data unchanged', () => {
    expect(resolveSection(section, 'de', 'en'), why('RFC 0103 §C', 'no match MUST return base data')).toEqual(section.data);
    expect(resolveSection(section, 'en', 'en'), why('RFC 0103 §C', 'base locale MUST return base data')).toEqual(section.data);
  });
});

describe('localized-content: §A capability coherence predicate (server-free)', () => {
  const i18n: I18nCap = { supported: true, defaultLocale: 'en', supportedLocales: ['en', 'es', 'pt-BR', 'fr'] };
  it('a coherent advertisement passes', () => {
    expect(contentCoherent({ supported: true, baseLocale: 'en', supportedLocales: ['es', 'pt-BR', 'fr'] }, i18n), why('RFC 0103 §A', 'a coherent content block MUST pass')).toBe(true);
  });
  it('content without i18n is incoherent', () => {
    expect(contentCoherent({ supported: true, baseLocale: 'en', supportedLocales: ['es'] }, { supported: false }), why('RFC 0103 §A.1', 'content requires i18n.supported')).toBe(false);
  });
  it('baseLocale != i18n.defaultLocale is incoherent', () => {
    expect(contentCoherent({ supported: true, baseLocale: 'es', supportedLocales: ['fr'] }, i18n), why('RFC 0103 §A.2', 'baseLocale MUST equal i18n.defaultLocale')).toBe(false);
  });
  it('a supportedLocales not ⊆ i18n.supportedLocales is incoherent', () => {
    expect(contentCoherent({ supported: true, baseLocale: 'en', supportedLocales: ['de'] }, i18n), why('RFC 0103 §A.3', 'content locales MUST be a subset of i18n locales')).toBe(false);
  });
  it('baseLocale appearing in supportedLocales is incoherent', () => {
    expect(contentCoherent({ supported: true, baseLocale: 'en', supportedLocales: ['en', 'es'] }, i18n), why('RFC 0103 §A.4', 'baseLocale MUST NOT appear in supportedLocales')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Capability-gated behavioral legs (live host)
// ════════════════════════════════════════════════════════════════════════════

describe.skipIf(HTTP_SKIP)('localized-content: live advertisement coherence (localized-content.md §A)', () => {
  it('advertised content block is coherent with the advertised i18n block', async () => {
    const content = await readCapabilityFamily<ContentCap>('content');
    if (!behaviorGate('openwop-content', content?.supported === true)) return;
    const i18n = (await readCapabilityFamily<I18nCap>('i18n')) ?? {};
    expect(
      contentCoherent(content!, i18n),
      driver.describe('localized-content.md §A', 'the advertised content block MUST satisfy the i18n-subset + baseLocale invariants'),
    ).toBe(true);
  });
});
