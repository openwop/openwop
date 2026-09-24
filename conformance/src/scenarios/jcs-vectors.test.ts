/**
 * RFC 0212 — canonical JSON is RFC 8785 (JCS), and the input MUST be I-JSON.
 *
 * `conformance/vectors/jcs-v1.json` is normative: every signature and digest in
 * the corpus (pack signatures, the certification-bundle attestation,
 * `discovery.sha256`, `witnessSha256`, the RFC 0150 request digest) is over
 * these bytes, and an SDK in another language reproduces the same file. This
 * scenario holds the suite's one implementation (`lib/jcs.ts`) to it.
 *
 * Every leg RECOMPUTES from the vector input; none compares two constants from
 * the file. The sabotages RFC 0212 names, each of which turns a leg red:
 *
 *   - a rebuild-object canonicalizer (`JSON.stringify` of an object whose keys
 *     were inserted in sorted order) — integer-like keys enumerate first, so
 *     `integer-like-keys` fails;
 *   - NaN → `null` coercion — the value-boundary refusal leg fails;
 *   - a parser that keeps the last duplicate name (`JSON.parse`) — the
 *     `duplicate-name` refusal is accepted;
 *   - a `localeCompare` comparator — the ordering leg and the
 *     `rfc8785-3.2.3-sort` vector fail.
 *
 * Server-free and always-on; the vectors ship with the conformance package.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { canonicalJSON, canonicalizeText, codeUnitCompare, JcsRefusal } from '../lib/jcs.js';
import { witnessDigest, type BundleV3Requirement } from '../lib/certification-bundle-v3.js';
import { req } from '../lib/requirement-ids.js';

interface NumberVector { readonly ieee754: string; readonly canonical: string }
interface NumberRefusal { readonly ieee754: string; readonly refuse: string }
interface ObjectVector { readonly id: string; readonly why: string; readonly input: string; readonly canonical: string; readonly sha256: string }
interface RefusalVector { readonly id: string; readonly why: string; readonly input: string; readonly refuse: string }
interface Ordering { readonly why: string; readonly ids: readonly string[]; readonly codeUnit: readonly string[] }

const VECTORS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vectors', 'jcs-v1.json');
const doc = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
  numbers: readonly NumberVector[];
  numberRefusals: readonly NumberRefusal[];
  objects: readonly ObjectVector[];
  refusals: readonly RefusalVector[];
  ordering: Ordering;
};

const SPEC = 'RFC 0212 · spec/v2/core/conformance.md §"Canonical JSON"';
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const double = (hex: string): number => Buffer.from(hex, 'hex').readDoubleBE(0);

function refusalOf(fn: () => unknown): JcsRefusal | undefined {
  try { fn(); } catch (e) { if (e instanceof JcsRefusal) return e; throw e; }
  return undefined;
}

describe('RFC 0212 — canonical JSON is RFC 8785 JCS over I-JSON', () => {
  it('the vector set is present and non-trivial', () => {
    // An empty or truncated file would make every leg below vacuous.
    expect(doc.numbers.length, req('openwop.it.jcs-vectors.the-vector-set-is-present-and-non-trivial', SPEC, 'the vectors MUST cover RFC 8785 Appendix B numbers, documents and every §B refusal kind')).toBeGreaterThanOrEqual(20);
    expect(doc.objects.length).toBeGreaterThanOrEqual(10);
    expect(new Set(doc.refusals.map((r) => r.refuse))).toEqual(new Set(['duplicate-name', 'lone-surrogate', 'integer-out-of-range', 'not-json', 'non-finite']));
  });

  it.each(doc.numbers.map((n) => [n.ieee754, n] as const))('number %s serializes per RFC 8785 Appendix B', (_hex, n) => {
    expect(canonicalJSON(double(n.ieee754)), req('openwop.it.jcs-vectors.number-s-serializes-per-rfc-8785-appendix-b', SPEC, 'numbers MUST serialize as ECMAScript Number::toString (RFC 8785 §3.2.2.3)')).toBe(n.canonical);
  });

  it.each(doc.objects.map((o) => [o.id, o] as const))('document %s canonicalizes and hashes', (_id, o) => {
    // The preimage is asserted as well as the hash so a failing implementation
    // can diff WHICH member it got wrong.
    const canonical = canonicalizeText(o.input);
    expect(canonical, req('openwop.it.jcs-vectors.document-s-canonicalizes-and-hashes', SPEC, o.why)).toBe(o.canonical);
    expect(sha256(canonical), req('openwop.it.jcs-vectors.document-s-canonicalizes-and-hashes', SPEC, o.why)).toBe(o.sha256);
  });

  it.each(doc.refusals.map((r) => [r.id, r] as const))('text %s is refused, not coerced', (_id, r) => {
    const refusal = refusalOf(() => canonicalizeText(r.input));
    expect(refusal?.kind, req('openwop.it.jcs-vectors.text-s-is-refused-not-coerced', SPEC, `RFC 0212 §B: ${r.why}`)).toBe(r.refuse);
  });

  it('a non-I-JSON native value is refused at the value boundary', () => {
    const cases: readonly [string, unknown][] = [
      ...doc.numberRefusals.map((n) => [`ieee754 ${n.ieee754}`, { n: double(n.ieee754) }] as [string, unknown]),
      ['NaN', { n: Number.NaN }],
      ['undefined member', { a: undefined }],
      ['undefined element', [undefined]],
      ['Date', { at: new Date(0) }],
      ['bigint', { n: 1n }],
      ['lone surrogate', { s: '\ud800' }],
      ['lone surrogate in a name', { '\udc00': 1 }],
    ];
    for (const [label, value] of cases) {
      expect(refusalOf(() => canonicalJSON(value)), req('openwop.it.jcs-vectors.a-non-i-json-native-value-is-refused-at-the-value-boundary', SPEC, `RFC 0212 §B: ${label} MUST be refused, not serialized`)).toBeInstanceOf(JcsRefusal);
    }
  });

  it('member names and certification rows sort by UTF-16 code units, not by locale', () => {
    const o = doc.ordering;
    expect([...o.ids].sort(codeUnitCompare), req('openwop.it.jcs-vectors.member-names-and-certification-rows-sort-by-utf-16-code-units-not-by-locale', SPEC, o.why)).toEqual([...o.codeUnit]);
    // The certification digest uses the same comparator (RFC 0212 §C): rows
    // given in vector order digest to the JCS of the code-unit-sorted rows.
    const rows: BundleV3Requirement[] = o.ids.map((id) => ({ id, scenario: 's.test.ts', result: 'executed-pass' }) as BundleV3Requirement);
    const expected = sha256(canonicalJSON([...o.codeUnit].map((id) => ({ id, scenario: 's.test.ts', result: 'executed-pass' }))));
    expect(witnessDigest(rows), req('openwop.it.jcs-vectors.member-names-and-certification-rows-sort-by-utf-16-code-units-not-by-locale', SPEC, 'witnessSha256 rows MUST sort by id in UTF-16 code-unit order; a locale-sensitive comparator MUST NOT be used')).toBe(expected);
  });
});
