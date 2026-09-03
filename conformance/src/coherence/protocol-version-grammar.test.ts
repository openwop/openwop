/**
 * RFC 0149 §C — `protocolVersion` is `<major>.<minor>`, and the corpus enforces it.
 *
 * The field was specified three incompatible ways at once. `capabilities.schema.json`
 * constrained it to `minLength: 1` — so `"v1.0"`, `"1.0.0"`, `"01.0"`, and `"banana"` all
 * validated. `profiles.ts` derived core-ness from `startsWith('1.')`, which admits
 * `"1.0.0"` and `"1.banana"` while rejecting a legitimate future `"2.0"` for the right
 * reason and `"1"` for the wrong one. Prose described it as semver while every example
 * showed two components.
 *
 * The consequence is a negotiation the wire cannot decide. Version comparison needs an
 * integer major as the hard compatibility boundary and an integer minor as the additive
 * contract level. Neither can be extracted from a string the schema never constrained, so
 * two hosts could advertise `"1.0"` and `"1.0.0"` and no consumer could tell whether it
 * was looking at a patch convention, a typo, or a different protocol.
 *
 * RFC 0149 §C: ASCII `<major>.<minor>`, no leading zero except zero itself. Patch belongs
 * to suite and SDK versions, not the spec version. This also closes gap V2 in
 * `version-negotiation.md` §"Open spec gaps" — "concrete `protocolVersion` semver
 * semantics" — which had sat open with owner `future`.
 *
 * Server-free. The schema ships in both the repository and the published tarball; the
 * prose leg self-skips under the published layout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { isCore } from '../lib/profiles.js';
import { req } from '../lib/requirement-ids.js';

/** RFC 0149 §C. */
const GRAMMAR = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const SCHEMA_PATH =
  V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'schemas', 'capabilities.schema.json');

function protocolVersionSchema(): { pattern?: string } | null {
  if (SCHEMA_PATH === null) return null;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
    properties?: Record<string, { pattern?: string }>;
  };
  return schema.properties?.['protocolVersion'] ?? null;
}

/** A discovery payload that is core-valid except for the version under test. */
function payload(protocolVersion: unknown) {
  return {
    protocolVersion,
    supportedEnvelopes: ['plan'],
    schemaVersions: {},
    limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 },
  };
}

const VALID = ['1.0', '1.12', '0.0', '2.0', '10.3'];
const INVALID = ['1', '1.0.0', 'v1.0', '01.0', '1.', '.0', '1.0-rc1', '', ' 1.0', '1.0 '];

describe.skipIf(V1_DIR === null)('RFC 0149 §C — protocolVersion grammar', () => {
  it('the schema declares protocolVersion at all', () => {
    // Guard: a lookup returning null would make the pattern leg vacuous.
    expect(protocolVersionSchema(), req('openwop.it.protocol-version-grammar.the-schema-declares-protocolversion-at-all', 'RFC 0149 §C', 'capabilities.schema.json MUST declare `protocolVersion`')).not.toBeNull();
  });

  it('the schema constrains protocolVersion by pattern, not merely by length', () => {
    const node = protocolVersionSchema();
    expect(
      node?.pattern,
      req('openwop.it.protocol-version-grammar.the-schema-constrains-protocolversion-by-pattern-not-merely-by-length', 'RFC 0149 §C', 'RFC 0149 §C: `minLength: 1` admits `"v1.0"`, `"1.0.0"`, and `"banana"`. Compatibility ' +
        'comparison needs an integer major and an integer minor, which cannot be extracted from ' +
        'an unconstrained string.'),
    ).toBe(GRAMMAR.source);
  });

  it.each(VALID)('accepts %s', (v) => {
    expect(GRAMMAR.test(v), req('openwop.it.protocol-version-grammar.accepts-s', 'RFC 0149 §C', `RFC 0149 §C: ${v} is a legal major.minor`)).toBe(true);
  });

  it.each(INVALID)('rejects %s', (v) => {
    expect(
      GRAMMAR.test(v),
      req('openwop.it.protocol-version-grammar.rejects-s', 'RFC 0149 §C', `RFC 0149 §C: ${JSON.stringify(v)} is not major.minor — patch belongs to suite and SDK ` +
        'versions, and a leading zero is forbidden except for zero itself'),
    ).toBe(false);
  });

  it('core derivation applies the grammar rather than a prefix test', () => {
    // `startsWith('1.')` admitted `1.0.0` and `1.banana` and rejected `1`. The
    // predicate that decides whether a host is openwop-compatible at all must
    // not be looser than the schema every host validates against.
    expect(isCore(payload('1.0')), req('openwop.it.protocol-version-grammar.core-derivation-applies-the-grammar-rather-than-a-prefix-test', 'RFC 0149 §C', '`1.0` is core-valid')).toBe(true);
    for (const bad of ['1.0.0', '1.banana', '1', 'v1.0', '01.0']) {
      expect(
        isCore(payload(bad)),
        `RFC 0149 §C: \`${bad}\` MUST NOT derive \`openwop-core\` — the predicate cannot be ` +
          'more permissive than the grammar',
      ).toBe(false);
    }
  });

  it('a different major is not core; a higher minor is', () => {
    // §C: consumers MUST reject a different unsupported major and MUST tolerate a
    // higher minor under v1 additive rules. The predicate is the v1 suite's, so a
    // v2 host is correctly not-core here — that is a major boundary, not a defect.
    expect(isCore(payload('2.0')), req('openwop.it.protocol-version-grammar.a-different-major-is-not-core-a-higher-minor-is', 'RFC 0149 §C', 'a different major is outside this suite')).toBe(false);
    expect(isCore(payload('1.99')), req('openwop.it.protocol-version-grammar.a-different-major-is-not-core-a-higher-minor-is', 'RFC 0149 §C', 'a higher minor stays core under v1 additive rules')).toBe(true);
  });

  it('the spec states the grammar normatively', () => {
    // Searched raw: the grammar contains `*` and `_`-adjacent metacharacters, so
    // the usual markdown-emphasis strip would eat its own quantifiers.
    const doc = readFileSync(join(V1_DIR as string, 'version-negotiation.md'), 'utf8');
    expect(
      doc.includes(GRAMMAR.source),
      req('openwop.it.protocol-version-grammar.the-spec-states-the-grammar-normatively', 'RFC 0149 §C', 'RFC 0149 §C: `version-negotiation.md` MUST carry the grammar, so the schema pattern has ' +
        'a normative source rather than being the only place the rule exists.'),
    ).toBe(true);
  });
});
