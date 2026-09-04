/**
 * RFC 0175 §C.1 — `legacy-profiles-absent` (suite 2.0.0, target major 2; unaided).
 *
 * `a2a-0.3-legacy` and `mcp-2025-06-18-legacy` do not exist in the v2 tree: the
 * `profiles[]` item patterns admit no `-legacy` suffix
 * (`spec/v2/facets/a2a.schema.json` `^a2a-[0-9]+\.[0-9]+$`,
 * `spec/v2/facets/mcp.schema.json` `^mcp-[0-9]{4}-[0-9]{2}-[0-9]{2}$`), and a
 * host that still speaks a legacy version does so as a private, non-advertised
 * behavior (`spec/v2/core/interop.md` §Legacy profiles are absent; RFC 0175 row
 * C8.1). No root `profiles[]` exists either (RFC 0169 §C.1).
 *
 * Unaided; gated only in the sense that a host advertising neither facet has
 * no `profiles[]` to check — that leg records `inapplicable`, the root leg runs
 * on every host.
 *
 * @see spec/v2/core/interop.md §Legacy profiles are absent
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const PATTERNS: Record<string, RegExp> = {
  a2a: /^a2a-[0-9]+\.[0-9]+$/,
  mcp: /^mcp-[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
};

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function profilesOf(doc: Record<string, unknown>, family: string): string[] | null {
  const rec = doc[family];
  if (!rec || typeof rec !== 'object') return null;
  const p = (rec as { profiles?: unknown }).profiles;
  return Array.isArray(p) ? p.map(String) : [];
}

describe('RFC 0175 §C.1 — legacy-profiles-absent (unaided)', () => {
  it('no -legacy id appears in a2a.profiles or mcp.profiles and each id matches its facet pattern', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    let checked = 0;
    for (const family of ['a2a', 'mcp'] as const) {
      const profiles = profilesOf(doc, family);
      if (profiles === null) continue;
      checked++;
      for (const id of profiles) {
        expect(
          /-legacy$/.test(id),
          req('openwop.requirement.0175.legacy-profiles-absent', 'interop.md §Legacy profiles are absent', `${family}.profiles MUST NOT carry a -legacy id (got ${id}); the legacy code paths are not part of the v2 corpus (RFC 0175 §C.1)`),
        ).toBe(false);
        expect(
          PATTERNS[family]!.test(id),
          req('openwop.requirement.0175.legacy-profiles-absent', `facets/${family}.schema.json profiles[]`, `${family}.profiles ids MUST match ${PATTERNS[family]!.source} (got ${id})`),
        ).toBe(true);
      }
      // The facet as a whole — versions/revisions, floor, refreshedAt — validates
      // through the capabilities schema, whose family records are the facets.
      const check = v2Validator('capabilities')({ protocolVersions: ['2.0'], preferredVersion: '2.0', [family]: doc[family] });
      expect(
        check.ok,
        req('openwop.requirement.0175.legacy-profiles-absent', `facets/${family}.schema.json`, `the ${family} facet MUST validate against its facet schema (capabilities.schema.json ${family}): ${check.errors}`),
      ).toBe(true);
    }
    if (checked === 0) softSkip('inapplicable', 'host advertises neither a2a nor mcp — no profiles[] to check for a -legacy id');
  });

  it('no root profiles[] exists in the v2 representation', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    expect(
      'profiles' in doc,
      req('openwop.requirement.0175.legacy-profiles-absent.no-root-profiles', 'capabilities.md §Profiles', 'no `profiles[]` exists at the v2 root — a profile is a predicate over the declaration file, not an advertisement (RFC 0169 §C.1)'),
    ).toBe(false);
  });
});
