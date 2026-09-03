/**
 * Suite self-tests for per-`it` requirement ids (RFC 0148 §A gap G3; v2
 * charter Phase 1). These prove the ID GRAMMAR, not a host, so they live in
 * `src/lib/` and produce no scenario ledger row.
 *
 * The generator (`scripts/generate-requirement-registry.mjs`) re-implements
 * `slugTitle` in plain JS; the fixtures below are the contract both must meet,
 * so a divergence shows up here before it shows up as a registry-check failure.
 */

import { describe, it, expect } from 'vitest';
import {
  IT_ID_GRAMMAR,
  ItIdAllocator,
  itRequirementId,
  req,
  scenarioFileOfItId,
  slugTitle,
  takeExplicitRequirementId,
} from './requirement-ids.js';

describe('requirement-ids: slug grammar', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['auth.profiles, when present, is an array of non-empty strings', 'auth-profiles-when-present-is-an-array-of-non-empty-strings'],
    ['REJECTS the alg-none assertion over the seam (synthetic IdP required)', 'rejects-the-alg-none-assertion-over-the-seam-synthetic-idp-required'],
    ['  --leading and trailing--  ', 'leading-and-trailing'],
    ['§B.2 fail-closed: `unbound` ⇒ 401', 'b-2-fail-closed-unbound-401'],
    ['', 'untitled'],
    ['!!!', 'untitled'],
  ];
  for (const [title, slug] of cases) {
    it(`slugs ${JSON.stringify(title)} → ${slug}`, () => {
      expect(slugTitle(title)).toBe(slug);
    });
  }

  it('caps the slug at 80 characters without a trailing hyphen', () => {
    const long = 'word '.repeat(40);
    const s = slugTitle(long);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });

  it('every derived id matches IT_ID_GRAMMAR', () => {
    for (const [title] of cases) {
      expect(itRequirementId('auth-subject-link.test.ts', title)).toMatch(IT_ID_GRAMMAR);
    }
  });

  it('maps an id back to its scenario file', () => {
    expect(scenarioFileOfItId('openwop.it.auth-subject-link.leaver-deny')).toBe('auth-subject-link.test.ts');
    expect(scenarioFileOfItId('openwop.it.auth-subject-link.leaver-deny~2')).toBe('auth-subject-link.test.ts');
    expect(scenarioFileOfItId('openwop.floor.auth')).toBeNull();
    expect(scenarioFileOfItId('openwop.scenario.auth')).toBeNull();
  });
});

describe('requirement-ids: collision suffixing', () => {
  it('first occurrence is bare; duplicates get ~2, ~3', () => {
    const a = new ItIdAllocator();
    expect(a.allocate('x.test.ts', 'same title')).toBe('openwop.it.x.same-title');
    expect(a.allocate('x.test.ts', 'same title')).toBe('openwop.it.x.same-title~2');
    expect(a.allocate('x.test.ts', 'Same  Title!')).toBe('openwop.it.x.same-title~3');
    expect('openwop.it.x.same-title~3').toMatch(IT_ID_GRAMMAR);
  });

  it('reset() forgets prior titles', () => {
    const a = new ItIdAllocator();
    a.allocate('x.test.ts', 't');
    a.reset();
    expect(a.allocate('x.test.ts', 't')).toBe('openwop.it.x.t');
  });
});

describe('requirement-ids: explicit override', () => {
  it('req() sets the override for the current test and returns the citation message', () => {
    takeExplicitRequirementId();
    const msg = req('openwop.auth.subject-link.leaver-deny', 'auth-profiles.md §Subject linking', 'deactivation MUST deny');
    // Suite 2.0.0: req() carries the [impl@version] label driver.describe used to add (RFC 0168 §A.1).
    expect(msg).toBe('[unknown@unknown] auth-profiles.md §Subject linking: deactivation MUST deny');
    expect(takeExplicitRequirementId()).toBe('openwop.auth.subject-link.leaver-deny');
    expect(takeExplicitRequirementId()).toBeNull();
  });
});
