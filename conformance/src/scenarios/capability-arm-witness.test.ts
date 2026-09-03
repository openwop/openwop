/**
 * Which ARM of the permissive capability resolver a host actually lands on (RFC 0144 G1).
 *
 * THE GAP THIS CLOSES, in the RFC's words: *"the permissive multi-arm resolver cannot witness
 * WHICH spelling a host emits, so a schema declaration alone migrates no one — a host may sit
 * on a fallback arm indefinitely with a green suite."*
 *
 * Every capability helper in this suite resolves a family through four arms, in order:
 *
 *   1. plain at document root      "artifactTypes"          ← CANONICAL
 *   2. dotted at document root     "host.artifactTypes"
 *   3. plain under the wrapper     capabilities.artifactTypes
 *   4. dotted under the wrapper    capabilities["host.artifactTypes"]
 *
 * Because arms 2–4 succeed silently, a host that never migrated reads exactly like one that
 * did. That is the whole failure: the suite's own tolerance is what hides the drift.
 *
 * THIS LEG ENFORCES AN EXISTING MUST — IT ADDS NOTHING. `capabilities.md` §"Document-root
 * layout (normative — RFC 0073)" says every family **MUST** appear as a property of the
 * document root, the wrapper is a *"deprecated legacy shape"*, and in terms:
 *
 *   "The conformance suite reads the root only — root is the MUST above, so a host that
 *    serves families exclusively under the wrapper is non-conformant and is graded as such."
 *
 * The suite did not, in fact, read the root only. The helpers fall back. So the corpus said
 * one thing and the code did another, and this leg makes the code match the prose.
 *
 * WHAT IT ASSERTS vs WHAT IT ONLY REPORTS — the line is drawn at what the spec settles:
 *
 *   - ASSERTED: no family is reachable ONLY under the `capabilities` wrapper. That is the
 *     quoted MUST, stated as non-conformance, and enforcing it is not a tightening.
 *   - REPORTED: dotted-at-root spellings. RFC 0137 G16 makes the PLAIN name the discovery key
 *     and the dotted form the identifier, so a dotted root key is not the declared property —
 *     but `capabilities.md`'s MUST is written about the root, not about the spelling at the
 *     root, and `additionalProperties: true` tolerates the extra key. Failing on it would be
 *     a v1.x tightening this leg has no license for. It is surfaced instead, which is exactly
 *     the visibility G1 asked for.
 *
 * @see spec/v1/capabilities.md §"Document-root layout (normative — RFC 0073)"
 * @see RFCS/0144-capability-declaration-classes.md G1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

type Arm = 'root-plain' | 'root-dotted' | 'wrapper-plain' | 'wrapper-dotted';

interface Placement {
  readonly family: string;
  readonly arms: readonly Arm[];
}

/** Every family the core schema declares — the set a host could place on any arm. */
function declaredFamilies(): string[] {
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
  ) as { properties: Record<string, unknown> };
  return Object.keys(schema.properties);
}

function classify(doc: Record<string, unknown>, families: readonly string[]): Placement[] {
  const wrapper =
    doc['capabilities'] && typeof doc['capabilities'] === 'object'
      ? (doc['capabilities'] as Record<string, unknown>)
      : {};
  const out: Placement[] = [];
  for (const family of families) {
    const dotted = `host.${family}`;
    const arms: Arm[] = [];
    if (doc[family] !== undefined) arms.push('root-plain');
    if (doc[dotted] !== undefined) arms.push('root-dotted');
    if (wrapper[family] !== undefined) arms.push('wrapper-plain');
    if (wrapper[dotted] !== undefined) arms.push('wrapper-dotted');
    if (arms.length > 0) out.push({ family, arms });
  }
  return out;
}

describe('capability-arm-witness: which resolver arm the host lands on (RFC 0144 G1)', () => {
  it('no capability family is reachable ONLY under the deprecated `capabilities` wrapper', async () => {
    const res = await driver.get('/.well-known/openwop');
    // No discovery document ⇒ inapplicable. Other scenarios own that failure; this leg is
    // about WHERE families sit, not whether the host has any.
    if (res.status !== 200 || res.json === undefined || res.json === null) return softSkip('blocked', 'precondition not met — `res.status !== 200 || res.json === undefined || res.json === null` returned early (No discovery document ⇒ inapplicable. Other scenarios own that failure; this leg is about WHERE families sit, …');

    const doc = res.json as Record<string, unknown>;
    const placements = classify(doc, declaredFamilies());
    if (placements.length === 0) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `placements.length === 0` returned early (advertises no declared family — inapplicable)'); // advertises no declared family — inapplicable

    const canonical = placements.filter((p) => p.arms.includes('root-plain'));
    const rootDotted = placements.filter(
      (p) => !p.arms.includes('root-plain') && p.arms.includes('root-dotted'),
    );
    const wrapperOnly = placements.filter(
      (p) => !p.arms.includes('root-plain') && !p.arms.includes('root-dotted'),
    );

    // REPORT — the visibility G1 asked for. Printed whether or not the assertion below fires,
    // because "which arm did this host land on" is the question the suite could not answer.
    console.log(
      `  [arm-witness] families advertised: ${placements.length} — ` +
        `canonical(root-plain): ${canonical.length}, ` +
        `root-dotted only: ${rootDotted.length}${rootDotted.length ? ` [${rootDotted.map((p) => p.family).join(', ')}]` : ''}, ` +
        `wrapper only: ${wrapperOnly.length}${wrapperOnly.length ? ` [${wrapperOnly.map((p) => p.family).join(', ')}]` : ''}`,
    );

    // ASSERT — the existing MUST, not a new one.
    expect(
      wrapperOnly.map((p) => p.family),
      req('openwop.it.capability-arm-witness.no-capability-family-is-reachable-only-under-the-deprecated-capabilities-wrapper', 
        'capabilities.md §"Document-root layout (normative — RFC 0073)"',
        'every family MUST appear at the document root; a host that serves families EXCLUSIVELY under the deprecated `capabilities` wrapper is non-conformant and is graded as such. The suite\'s helpers fall back to the wrapper, so without this leg such a host reads exactly like a migrated one — which is RFC 0144 G1',
      ),
    ).toEqual([]);
  });
});
