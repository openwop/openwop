/**
 * i18n-negotiation — `spec/v1/i18n.md` locale negotiation (capability-gated).
 *
 * Always-on (when a host is reachable): the `i18n` advertisement-shape
 * probe — absent is conformant ("host serves a single locale always");
 * when present, `supported` is a boolean, `defaultLocale` /
 * `supportedLocales` are BCP 47 tags, and `supportedLocales` contains
 * `defaultLocale` (i18n.md §"Capability advertisement").
 *
 * Behavioral legs are gated via `behaviorGate('openwop-i18n',
 * i18n.supported === true)` — soft-skip by default, hard-fail under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` (root-first family read per RFC 0073):
 *
 *   1. An UNSUPPORTED `Accept-Language` MUST NOT fail the request — the
 *      host falls back to its default locale (i18n.md §Accept-Language
 *      "Host MUST NOT" + §Fallback rules).
 *   2. A MALFORMED `Accept-Language` MUST NOT cause `400` (i18n.md
 *      §Accept-Language Host-MUST rule 1).
 *   3. `Content-Language`, when emitted, is a BCP 47 tag and never lies:
 *      for the unsupported-tag request it reflects the host default
 *      (i18n.md §Fallback rules 3–4 + §Conformance).
 *   4. The machine-readable error `code` stays the canonical English /
 *      lowercase / underscore token regardless of the negotiated
 *      language (i18n.md §"`locale` field on `ErrorEnvelope.details`").
 *
 * The probes drive a protected route that produces a human-facing error
 * envelope (`GET /v1/runs/{unknown-id}` → `404 not_found`) so both the
 * negotiation tolerance AND the error-code stability are observable
 * black-box without any fixture.
 *
 * @see spec/v1/i18n.md
 * @see schemas/capabilities.schema.json §i18n
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

/** BCP 47 well-formedness as pinned by capabilities.schema.json §i18n. */
const BCP47 = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$/;

interface I18nCap {
  readonly supported?: unknown;
  readonly defaultLocale?: unknown;
  readonly supportedLocales?: unknown;
}

/** A protected route that yields a canonical error envelope. */
const PROBE_PATH = '/v1/runs/openwop-conformance-i18n-no-such-run';

/** Pick a syntactically valid tag the host does NOT list as supported. */
function pickUnsupportedTag(supportedLocales: readonly string[]): string {
  const candidates = ['tlh', 'mi-NZ', 'eu-ES', 'kl-GL'];
  return candidates.find((c) => !supportedLocales.includes(c)) ?? 'tlh';
}

function errCode(json: unknown): string | undefined {
  const e = (json as { error?: unknown } | undefined)?.error;
  return typeof e === 'string' ? e : undefined;
}

describe.skipIf(HTTP_SKIP)('i18n-negotiation: advertisement shape (i18n.md §Capability advertisement)', () => {
  it('the i18n block is either absent or well-formed', async () => {
    const cap = await readCapabilityFamily<I18nCap>('i18n');
    if (cap === undefined) return; // absent ⇒ single-locale host — conformant

    expect(
      typeof cap.supported,
      driver.describe('capabilities.schema.json §i18n', 'i18n.supported MUST be a boolean when the block is present'),
    ).toBe('boolean');

    if (cap.defaultLocale !== undefined) {
      expect(
        typeof cap.defaultLocale === 'string' && BCP47.test(cap.defaultLocale),
        driver.describe('i18n.md §Capability advertisement', `i18n.defaultLocale MUST be a BCP 47 tag (got ${String(cap.defaultLocale)})`),
      ).toBe(true);
    }

    if (cap.supportedLocales !== undefined) {
      expect(
        Array.isArray(cap.supportedLocales),
        driver.describe('i18n.md §Capability advertisement', 'i18n.supportedLocales MUST be an array when present'),
      ).toBe(true);
      const locales = (cap.supportedLocales as unknown[]) ?? [];
      for (const tag of locales) {
        expect(
          typeof tag === 'string' && BCP47.test(tag),
          driver.describe('i18n.md §Capability advertisement', `every supportedLocales entry MUST be a BCP 47 tag (got ${String(tag)})`),
        ).toBe(true);
      }
      if (typeof cap.defaultLocale === 'string') {
        expect(
          locales,
          driver.describe('i18n.md §Capability advertisement', 'supportedLocales MUST contain defaultLocale'),
        ).toContain(cap.defaultLocale);
      }
    }
  });
});

describe.skipIf(HTTP_SKIP)('i18n-negotiation: behavioral (i18n.md §Accept-Language + §Fallback rules)', () => {
  it('an unsupported Accept-Language falls back (never 400) and Content-Language reflects the default', async () => {
    const cap = await readCapabilityFamily<I18nCap>('i18n');
    if (!behaviorGate('openwop-i18n', cap?.supported === true)) return;

    const supported = Array.isArray(cap?.supportedLocales)
      ? (cap.supportedLocales as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    const defaultLocale = typeof cap?.defaultLocale === 'string' ? cap.defaultLocale : 'en';

    const res = await driver.get(PROBE_PATH, {
      headers: { 'Accept-Language': pickUnsupportedTag(supported) },
    });
    expect(
      res.status,
      driver.describe(
        'i18n.md §Accept-Language ("Host MUST NOT") + §Fallback rules',
        'an unsupported Accept-Language MUST NOT fail the request — the route still answers 404 not_found, not 400/406',
      ),
    ).toBe(404);

    const contentLanguage = res.headers.get('content-language');
    if (contentLanguage !== null) {
      expect(
        BCP47.test(contentLanguage),
        driver.describe('i18n.md §Accept-Language rule 4', `Content-Language MUST be a BCP 47 tag (got ${contentLanguage})`),
      ).toBe(true);
      const primary = (tag: string): string => (tag.split('-')[0] ?? tag).toLowerCase();
      expect(
        primary(contentLanguage),
        driver.describe(
          'i18n.md §Fallback rules 3–4 + §Conformance',
          'for an unsupported Accept-Language, Content-Language MUST reflect the host default locale (never lie)',
        ),
      ).toBe(primary(defaultLocale));
    }
  });

  it('a malformed Accept-Language MUST NOT cause 400', async () => {
    const cap = await readCapabilityFamily<I18nCap>('i18n');
    if (!behaviorGate('openwop-i18n', cap?.supported === true)) return;

    const res = await driver.get(PROBE_PATH, {
      headers: { 'Accept-Language': ';;;not===a,,language q=;' },
    });
    expect(
      res.status,
      driver.describe(
        'i18n.md §Accept-Language Host-MUST rule 1',
        'a malformed Accept-Language MUST NOT cause 400 — the host parses best-effort and proceeds (404 not_found here)',
      ),
    ).toBe(404);
  });

  it('the error `code` stays the canonical English token under a negotiated locale', async () => {
    const cap = await readCapabilityFamily<I18nCap>('i18n');
    if (!behaviorGate('openwop-i18n', cap?.supported === true)) return;

    const supported = Array.isArray(cap?.supportedLocales)
      ? (cap.supportedLocales as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    const defaultLocale = typeof cap?.defaultLocale === 'string' ? cap.defaultLocale : 'en';
    // Prefer a non-default supported locale so localization actually engages.
    const negotiated = supported.find((t) => t !== defaultLocale) ?? defaultLocale;

    // Baseline: the same probe under the host's DEFAULT locale. The i18n MUST is
    // locale-INVARIANCE of the machine-readable code, not a specific vocabulary
    // value. i18n.md §"`locale` field on `ErrorEnvelope.details`" requires the
    // `error` code to "remain English / lowercase / underscore-cased regardless
    // of locale" — it is an identifier, not human text. The spec does NOT pin a
    // missing run to the literal `not_found`: error-envelope.schema.json says
    // codes are SHOULD-snake_case, rest-endpoints.md §"Common error codes" is
    // non-exhaustive, and `run_forbidden` (RFC 0048) sets precedent that hosts
    // MAY use run-specific codes. Asserting a literal here would also pressure a
    // conformant host into a COMPATIBILITY.md §2.2 breaking error-code change.
    const baseRes = await driver.get(PROBE_PATH, {
      headers: { 'Accept-Language': defaultLocale },
    });
    const baseCode = errCode(baseRes.json);

    const res = await driver.get(PROBE_PATH, {
      headers: { 'Accept-Language': negotiated },
    });
    expect(res.status).toBe(404);
    const negotiatedCode = errCode(res.json);

    // (a) the code is an English snake_case identifier (not localized prose)
    expect(
      typeof negotiatedCode === 'string' && /^[a-z][a-z0-9_]*$/.test(negotiatedCode),
      driver.describe(
        'i18n.md §"`locale` field on `ErrorEnvelope.details`"',
        `the machine-readable error code MUST be an English lowercase snake_case identifier, not localized text (got ${String(negotiatedCode)} under ${negotiated})`,
      ),
    ).toBe(true);

    // (b) it is byte-identical to the default-locale code — the actual invariance MUST
    expect(
      negotiatedCode,
      driver.describe(
        'i18n.md §"`locale` field on `ErrorEnvelope.details`"',
        `the machine-readable error code MUST remain identical regardless of the negotiated locale (default ${defaultLocale} → ${String(baseCode)}; negotiated ${negotiated})`,
      ),
    ).toBe(baseCode);
  });
});
