/**
 * RFC 0212 §C — every committed v3 certification bundle re-derives its stored
 * `witnessSha256` from the preimage the PROSE specifies
 * (spec/v2/core/conformance.md §"Canonical JSON"), not only from the suite's
 * own `witnessDigest`.
 *
 * Why an independent re-derivation: `durability-evidence.test.ts` already checks
 * `witnessDigest(rows) === stored`, but that is the suite agreeing with itself —
 * a comparator change in `witnessDigest` would be matched by a re-cut and never
 * noticed as a spec question. This file builds the preimage from §C's words
 * (members `id`, `scenario`, `result`, then `assertions`/`detail`/`evidence`
 * only when present; UTF-16 code-unit order by `id`; `{rows, relaxations}` only
 * when relaxations are non-empty) and requires the stored digest, `witnessDigest`
 * and the prose to agree.
 *
 * The census leg is the compatibility claim RFC 0212 makes: switching the row
 * comparator from `localeCompare` to code units changed no committed digest.
 * It fails if it compares fewer bundles than the directory holds.
 *
 * Sabotage: replace `codeUnitCompare` in `witnessDigest` with
 * `(a, b) => a.id.localeCompare(b.id, 'cs')` — the ids below (`chain-…` after
 * `h…` in Czech collation) turn the comparator leg red.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { canonicalJSON, codeUnitCompare, parseIJson } from '../lib/jcs.js';
import { witnessDigest, type BundleV3, type BundleV3Requirement } from '../lib/certification-bundle-v3.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const DIR = join(SCHEMAS_DIR, '..', 'evidence', 'v2-host-bundles');
const SPEC = 'RFC 0212 §C · spec/v2/core/conformance.md §"Canonical JSON"';

/** §C, read literally. Deliberately does not call `witnessDigest`. */
function proseDigest(b: BundleV3): string {
  const rows = [...b.results.requirements]
    .sort((x, y) => codeUnitCompare(x.id, y.id))
    .map((r) => {
      const row: Record<string, unknown> = { id: r.id, scenario: r.scenario, result: r.result };
      if (r.assertions !== undefined) row['assertions'] = r.assertions;
      if (r.detail !== undefined) row['detail'] = r.detail;
      if (r.evidence !== undefined) row['evidence'] = r.evidence;
      return row;
    });
  const relaxations = b.host.relaxations ?? [];
  const preimage = relaxations.length > 0 ? { rows, relaxations } : rows;
  return createHash('sha256').update(canonicalJSON(preimage), 'utf8').digest('hex');
}

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(codeUnitCompare) : [];
const bundles = files
  .map((f) => ({ f, b: parseIJson(readFileSync(join(DIR, f), 'utf8')) as BundleV3 }))
  .filter(({ b }) => b.bundleVersion === '3');

describe('RFC 0212 §C — witnessSha256 preimage', () => {
  it('every committed v3 bundle re-derives its witnessSha256 from the prose preimage', () => {
    if (files.length === 0) {
      softSkip('inapplicable', 'evidence/v2-host-bundles is not present in this layout (published package)');
      return;
    }
    // Every file in the directory is a v3 bundle today; comparing fewer than the
    // directory holds would let a bundle fall out of the census unnoticed.
    expect(bundles.length, req('openwop.it.v2-bundle-witness-preimage.every-committed-v3-bundle-re-derives-its-witnesssha256-from-the-prose-preimage', SPEC, 'the census MUST cover every committed v3 bundle')).toBe(files.length);
    for (const { f, b } of bundles) {
      expect(proseDigest(b), req('openwop.it.v2-bundle-witness-preimage.every-committed-v3-bundle-re-derives-its-witnesssha256-from-the-prose-preimage', SPEC, `${f}: the stored witnessSha256 MUST equal SHA-256 of the JCS bytes of the §C preimage`)).toBe(b.witnessSha256);
      expect(witnessDigest(b.results.requirements, b.host.relaxations), req('openwop.it.v2-bundle-witness-preimage.every-committed-v3-bundle-re-derives-its-witnesssha256-from-the-prose-preimage', SPEC, `${f}: the suite's witnessDigest MUST compute the §C preimage`)).toBe(b.witnessSha256);
    }
  });

  it('the row comparator is code-unit order, which a locale collation contradicts', () => {
    // Ids already in committed bundles' shape: Czech collation sorts `ch` after
    // `h`, English puts `a` before `A` and ignores `_`. Under code units all
    // three pairs order the other way, so a locale comparator changes the digest.
    const ids = ['h-leg', 'chain-leg', 'a-leg', 'A-leg', 'get_weather', 'getWeather'];
    const rows = ids.map((id) => ({ id, scenario: 's.test.ts', result: 'executed-pass' }) as BundleV3Requirement);
    const codeUnit = createHash('sha256').update(canonicalJSON([...ids].sort(codeUnitCompare).map((id) => ({ id, scenario: 's.test.ts', result: 'executed-pass' }))), 'utf8').digest('hex');
    const czech = createHash('sha256').update(canonicalJSON([...ids].sort((a, b) => a.localeCompare(b, 'cs')).map((id) => ({ id, scenario: 's.test.ts', result: 'executed-pass' }))), 'utf8').digest('hex');
    expect(codeUnit, req('openwop.it.v2-bundle-witness-preimage.the-row-comparator-is-code-unit-order-which-a-locale-collation-contradicts', SPEC, 'the fixture ids MUST order differently under code units and Czech collation, or this leg proves nothing')).not.toBe(czech);
    expect(witnessDigest(rows), req('openwop.it.v2-bundle-witness-preimage.the-row-comparator-is-code-unit-order-which-a-locale-collation-contradicts', SPEC, 'witnessSha256 rows MUST sort by UTF-16 code units; a locale-sensitive comparator MUST NOT be used')).toBe(codeUnit);
  });
});
