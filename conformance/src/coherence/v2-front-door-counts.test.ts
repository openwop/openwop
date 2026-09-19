/**
 * The counts the front door states about the v2 tree must equal the tree.
 *
 * Three documents said `spec/v2/core/` holds "twenty documents" while it held
 * TWENTY-TWO, and `capabilities.md` §5 was headed "Core families (71)" against
 * a declaration carrying 72. Both drifted on 2026-09-19 in corpus 2.23.0, when
 * two core documents (`host-services.md`, `conversation.md`) were added to give
 * the last homeless families a home — by me, in the same release whose whole
 * point was that a claim should match what is measurable.
 *
 * These are the FIRST numbers a newcomer reads: README line 11 sizes the
 * implementation job, and `IMPLEMENT-CORE.md` is the document the README tells
 * an implementer to start with instead of the corpus. A wrong number there is
 * not cosmetic — it is the corpus misreporting its own size to the one reader
 * the project most needs.
 *
 * ── Why a COUNT gate and not a link-ratio gate ──────────────────────────────
 * The same session's plan proposed ratcheting README's `spec/v2/` link count
 * above its `spec/v1/` count (93 vs 18). That instrument would have been wrong:
 * the Document index IS the v1 tree by design and says so, `spec/v2/` cites
 * `spec/v1/` 101 times because the 25,000-word budget makes v2 a declaration
 * surface, and three v1 documents have no v2 counterpart at all. The ratio
 * measures tree size, not navigational intent, and a gate demanding it invert
 * would have forced dishonest prose. A file count and a row count are
 * mechanical facts; those are the ones worth gating.
 *
 * @see spec/v2/core/capabilities.md §5
 * @see docs/IMPLEMENT-CORE.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five',
  'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty',
] as const;

/** Every prose site that states how many documents `spec/v2/core/` holds. */
const DOC_COUNT_SITES = ['README.md', 'docs/IMPLEMENT-CORE.md'] as const;

describe('v2-front-door-counts', () => {
  it('every stated count of spec/v2/core/ documents equals the tree', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const actual = readdirSync(join(root, 'spec', 'v2', 'core')).filter((f) => f.endsWith('.md')).length;
    const word = WORDS[actual];
    const wrong: string[] = [];
    for (const rel of DOC_COUNT_SITES) {
      const text = readFileSync(join(root, rel), 'utf8');
      // Match the shape these sites use: "<word> documents in `spec/v2/core/`"
      // and "`spec/v2/core/*.md` (<word> documents". Both name the tree, so a
      // count about something else cannot be caught by accident.
      for (const m of text.matchAll(/([a-z]+(?:-[a-z]+)?) documents(?=[^.\n]{0,40}spec\/v2\/core)/g)) {
        if (m[1] !== word) wrong.push(`${rel}: "${m[1]} documents" but spec/v2/core/ holds ${actual} (${word})`);
      }
      for (const m of text.matchAll(/spec\/v2\/core\/\*\.md`? \(([a-z]+(?:-[a-z]+)?) documents/g)) {
        if (m[1] !== word) wrong.push(`${rel}: "${m[1]} documents" but spec/v2/core/ holds ${actual} (${word})`);
      }
    }
    expect(
      wrong.length === 0,
      req('openwop.requirement.front-door.core-doc-count', 'docs/IMPLEMENT-CORE.md', `README line 11 sizes the implementation job and IMPLEMENT-CORE.md is where the README sends an implementer INSTEAD of the corpus — a wrong number there is the corpus misreporting its own size to the reader it most needs: ${wrong.join(' · ') || 'none'}`),
    ).toBe(true);
  }, 60_000);

  it('capabilities.md §5 names as many core families as the declaration declares', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const decl = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'declaration.json'), 'utf8')) as {
      families: Array<{ anchor?: string }>;
    };
    const actual = decl.families.filter((f) => f.anchor === 'core').length;
    const heading = readFileSync(join(root, 'spec', 'v2', 'core', 'capabilities.md'), 'utf8')
      .split('\n').find((l) => /^##\s*\d+\.\s*Core families \(/.test(l)) ?? '';
    const stated = /Core families \((\d+)\)/.exec(heading)?.[1];
    expect(
      stated === String(actual),
      req('openwop.requirement.front-door.core-family-count', 'spec/v2/core/capabilities.md §5', `§5's heading is the census a reader counts the sections below against — it read "${stated ?? '(no heading found)'}" against ${actual} core rows in spec/v2/declaration.json. The heading and the declaration are the same claim stated twice, and check-declaration already fails when a HEADING names a family the declaration does not; it never compared the TOTALS`),
    ).toBe(true);
  }, 60_000);
});
