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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PKG_ROOT_PATH } from './paths.js';
import {
  IT_ID_GRAMMAR,
  ItIdAllocator,
  itRequirementId,
  req,
  scenarioFileOfId,
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

  it('scenarioFileOfId also resolves the per-file rows, and nothing else', () => {
    expect(scenarioFileOfId('openwop.it.auth-subject-link.leaver-deny')).toBe('auth-subject-link.test.ts');
    expect(scenarioFileOfId('openwop.floor.auth')).toBe('auth.test.ts');
    expect(scenarioFileOfId('openwop.scenario.v2-era-key')).toBe('v2-era-key.test.ts');
    // A prefix GROUP names no single file.
    expect(scenarioFileOfId('openwop.floor.any.interrupt-')).toBeNull();
    // Gate rows are minted at run time and shared by corpus and host runs.
    expect(scenarioFileOfId('openwop.profile.workflowChainPacks.supported')).toBeNull();
    expect(scenarioFileOfId('openwop.family.replay')).toBeNull();
    // An explicit req() id is authored, not derived.
    expect(scenarioFileOfId('openwop.requirement.0168.coherence-not-in-bundle')).toBeNull();
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

describe('requirement registry: ids passed through a helper', () => {
  // A scenario that writes `assert(ID_X, judge(o))` and calls `req(id, …)` inside the
  // helper used to register `explicitId: null`. Its soft-skipped rows were then labelled
  // `openwop.it.<file>.<slug>`, while an executed row carried the requirement id, so one
  // leg had two ids depending on the host (found by openwop-app-8f, 2026-10-13). The
  // generator now takes a requirement-id const passed to any call in the body. The
  // registry is pinned to the generator by its --check, so reading it pins the generator.
  const records = (JSON.parse(readFileSync(join(PKG_ROOT_PATH, 'requirements.json'), 'utf8')) as { records: Array<{ file: string; explicitId: string | null }> }).records;
  const idsOf = (file: string): Array<string | null> => records.filter((r) => r.file === file).map((r) => r.explicitId);

  it('registers the helper-passed ids of v2-dispatch-loop and v2-agents-fan-out-waves', () => {
    expect(idsOf('v2-dispatch-loop.test.ts')).toEqual([
      'openwop.requirement.multi-agent.supervisor-loop-terminates',
      'openwop.requirement.multi-agent.decision-recorded-well-formed',
      'openwop.requirement.multi-agent.decision-iteration-monotonic',
    ]);
    expect(idsOf('v2-agents-fan-out-waves.test.ts')).toEqual([
      'openwop.requirement.0243.max-fan-out-waves',
      'openwop.requirement.0243.per-item-input-gated',
      'openwop.requirement.agents.dispatch-per-item-length-mismatch',
    ]);
  });
});
