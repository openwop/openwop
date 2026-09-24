/**
 * v2-content-locale-keys — RFC 0206 on a live host (target major 2).
 *
 * The corpus half of RFC 0206 (the grammar, the wire agreement, the superset
 * and the two `resolveSection` properties) is witnessed by the coherence test
 * `conformance/src/coherence/locale-key-grammar.test.ts`. This file carries the
 * one row a host has to show: a host that advertises a content locale outside
 * RFC 0103's `ll(-RR)` subset (`es-419`, `zh-Hant`, `fil`) can author content
 * for it and delivers it.
 *
 * The leg runs only when `content.supportedLocales` contains a case-canonical
 * tag (RFC 0206 §A.1) that the RFC 0103 grammar rejected. Otherwise it records
 * `inapplicable` with that reason — never a pass — so the row is accounted for
 * on every v2 cut. No committed bundle advertises such a tag today (register
 * G4), so on every current host the row is `inapplicable`.
 *
 * Flow: create a published page, write the section's base fields
 * (`locale == baseLocale`) and then its overlay for the extended tag (a host on
 * the RFC 0103 grammar answers that write 400 — the leg fails), then
 * `GET /content/pages/{slug}` with `Accept-Language: <tag>` and assert
 * `Content-Language` names the tag (case-insensitively, RFC 5646 §2.1.1) and
 * the section carries the overlay.
 *
 * Gate: the family is advertised by the PRESENCE of its record
 * (`familyAdvertised`, RFC 0169 §A.2) — never by a `supported` flag, which the
 * closed v2 `content` record cannot carry. `v2-family-gate-no-supported.test.ts`
 * (a suite self-test) keeps that gate from coming back.
 *
 * Sabotage: a host that 400s the extended-tag write, or that serves only the
 * base locale for it, fails the leg (write status / `Content-Language` /
 * overlay assertion respectively).
 *
 * @see RFCS/0206-locale-keys-accept-negotiated-bcp47.md §A.1, §Conformance
 * @see spec/v1/localized-content.md §C, §D (the v2 `content` family's normativeText)
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { LOCALE_KEY_PATTERN, LOCALE_KEY_PATTERN_RFC0103 } from '../lib/localized-content.js';

const ID = 'openwop.requirement.0206.delivery-extended-locale';
const DOC = 'RFC 0206 §A.1; localized-content.md §C, §D';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

describe('v2-content-locale-keys (RFC 0206)', () => {
  it('an advertised extended content locale is written and delivered', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (doc === null) return softSkip('blocked', 'v2 discovery unreachable');
    const content = await familyAdvertised('content');
    // RFC 0169 §A.2: at major 2 the record's presence IS the claim. The v2
    // `content` record is closed and has no `supported` field, so a gate on
    // `supported === true` recorded `inapplicable` on every conforming host and
    // this row could never execute (corrected 2026-09-24).
    if (content === null) return softSkip('inapplicable', 'the host does not advertise the content family (no content surface to deliver an extended locale from)');
    const base = typeof content['baseLocale'] === 'string' ? content['baseLocale'] : null;
    const supported = Array.isArray(content['supportedLocales']) ? content['supportedLocales'].filter((x): x is string => typeof x === 'string') : [];
    const keyRe = new RegExp(LOCALE_KEY_PATTERN);
    const oldRe = new RegExp(LOCALE_KEY_PATTERN_RFC0103);
    const tag = supported.find((t) => keyRe.test(t) && !oldRe.test(t));
    if (tag === undefined) return softSkip('inapplicable', `no advertised content locale outside the RFC 0103 subset (content.supportedLocales = ${JSON.stringify(supported)})`);
    if (base === null) return softSkip('blocked', 'content.baseLocale is not advertised, so the base write cannot be addressed');

    const nonce = Math.random().toString(36).slice(2, 10);
    const pageId = `rfc0206-${nonce}`;
    const slug = `rfc0206-${nonce}`;
    const sectionId = 'hero';
    const overlay = `overlay:${tag}`;

    const created = await http(() => driver.post('/content/pages', { pageId, slug, name: 'RFC 0206 probe', status: 'published', sectionOrder: [sectionId] }));
    if (created === null || created.status >= 300) return softSkip('blocked', `POST /content/pages answered ${created?.status ?? 'unreachable'}; the probe page could not be created`);
    try {
      const baseWrite = await http(() => driver.put(`/content/pages/${pageId}/sections/${sectionId}`, { locale: base, data: { heading: 'base', cta: 'base-cta' } }));
      if (baseWrite === null || baseWrite.status >= 300) return softSkip('blocked', `the base-locale section write answered ${baseWrite?.status ?? 'unreachable'}`);

      const tagWrite = await http(() => driver.put(`/content/pages/${pageId}/sections/${sectionId}`, { locale: tag, data: { heading: overlay } }));
      expect(tagWrite?.status, req(ID, DOC, `the admin write with locale "${tag}" (an advertised content locale, §A.1-valid) MUST be accepted — a 400 means the host still validates the RFC 0103 subset`)).toBeLessThan(300);

      const res = await http(() => driver.get(`/content/pages/${slug}`, { headers: { 'Accept-Language': tag } }));
      if (res === null) return softSkip('blocked', `GET /content/pages/${slug} was unreachable`);
      expect(res.status, req(ID, DOC, `GET /content/pages/${slug} for a published page MUST answer 200`)).toBe(200);
      expect((res.headers.get('content-language') ?? '').toLowerCase(), req(ID, DOC, `Content-Language MUST name the negotiated extended locale "${tag}" (compared case-insensitively)`)).toBe(tag.toLowerCase());
      const sections = (res.json as { sections?: Array<{ sectionId?: string; data?: Record<string, unknown> }> } | undefined)?.sections ?? [];
      const hero = sections.find((s) => s.sectionId === sectionId);
      if (hero === undefined) return softSkip('blocked', `the probe section was not delivered (the §D write alone did not make it servable on this host); the overlay cannot be observed`);
      expect(hero.data?.['heading'], req(ID, DOC, `the section MUST resolve to its "${tag}" overlay`)).toBe(overlay);
      expect(hero.data?.['cta'], req(ID, DOC, 'fields absent from the overlay fall through to base data (shallow merge)')).toBe('base-cta');
    } finally {
      await http(() => driver.delete(`/content/pages/${pageId}`));
    }
  });
});
