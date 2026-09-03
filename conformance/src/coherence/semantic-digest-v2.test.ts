/**
 * RFC 0150 §C — the semantic request digest, and three defects in `replay.md`.
 *
 * **1. The exclusion list forbids exactly what §C requires.** `replay.md` §A
 * says "Fields NOT in this set MUST NOT influence the cache key — including but
 * not limited to: `max_tokens`, `stop`, … `seed`". §C says the digest "MUST
 * cover the complete semantic provider request … maximum output bound, stop
 * conditions, seed". Those are direct opposites, and §A's side is wrong: a
 * request with `stop: ["END"]` and one without produce different completions, so
 * a cache keyed identically for both **returns the wrong response** — not a
 * miss, a wrong hit. Same for `seed`, whose entire purpose is to change output,
 * and for the output bound, which decides whether a response is truncated.
 *
 * **2. It prescribes a normalization JCS does not perform.** Step 2 says
 * canonicalize "via RFC 8785 JCS", then tells hosts without JCS to emit "UTF-8
 * NFC for all strings". JCS does **not** apply NFC. So the two paths the same
 * sentence offers produce **different bytes for the same input** whenever a
 * string is not already NFC — which is the portability property §D claims as a
 * normative invariant. §C: "Implementations MUST NOT add Unicode normalization
 * outside JCS."
 *
 * **3. It cites a formula that no longer exists.** §C quotes the Layer-2 id as
 * `sha256(runId ':' nodeId ':' attempt ':' providerKey)` — the composition RFC
 * 0150 §B retired as a safety-fix, because `attempt` in the preimage guaranteed
 * a duplicate effect on every retry. `idempotency.md` is v1.4; `replay.md` was
 * left quoting v1.1. This one is a cross-document staleness the §B change itself
 * introduced and did not catch.
 *
 * Server-free; reads the corpus. `spec/v1/` is repository-only, so it self-skips
 * under the published tarball layout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

/** Fields whose presence changes the model's output, so they change its identity. */
const OUTCOME_AFFECTING = ['seed', 'stop', 'maxOutputTokens'];

describe.skipIf(V1_DIR === null)('RFC 0150 §C — semantic request digest v2', () => {
  const doc = V1_DIR === null ? '' : readFileSync(join(V1_DIR as string, 'replay.md'), 'utf8');

  /**
   * Normative text only. Blockquote lines are excluded because this document
   * deliberately QUOTES the rules it retired, so a reader can see what changed
   * and why — and a naive substring search cannot tell a live rule from a
   * quoted-and-retired one. Same carve-out shape as RFC 0149 §B's lint, which
   * exempts pre-0073 RFCs as the dated record of what was proposed.
   *
   * The exemption is narrow on purpose: it covers `>` blocks, not the body, so
   * a retired rule cannot be resurrected into normative voice unnoticed.
   */
  const normative = doc
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n');
  const plain = normative.replace(/[`*_]/g, '').replace(/\s+/g, ' ');
  /** Full text including quotes — used only where a quote is the thing under test. */
  const everything = doc.replace(/[`*_]/g, '').replace(/\s+/g, ' ');

  it('the digest recipe section is found at all', () => {
    // Guard: an empty read makes every leg below vacuously true.
    expect(doc.length, req('openwop.it.semantic-digest-v2.the-digest-recipe-section-is-found-at-all', 'RFC 0150 §C', 'replay.md MUST be readable')).toBeGreaterThan(1000);
    expect(plain, req('openwop.it.semantic-digest-v2.the-digest-recipe-section-is-found-at-all', 'RFC 0150 §C', 'the cache-key recipe MUST exist')).toMatch(/cache key/i);
    // The blockquote filter must not swallow the document.
    expect(
      plain.length / everything.length,
      req('openwop.it.semantic-digest-v2.the-digest-recipe-section-is-found-at-all', 'RFC 0150 §C', 'the normative-text filter MUST retain most of the document, or every leg below is vacuous'),
    ).toBeGreaterThan(0.7);
  });

  it('outcome-affecting fields are covered, not excluded', () => {
    for (const field of OUTCOME_AFFECTING) {
      expect(
        plain.includes(field),
        req('openwop.it.semantic-digest-v2.outcome-affecting-fields-are-covered-not-excluded', 'RFC 0150 §C', `RFC 0150 §C: the digest MUST cover \`${field}\`. Excluding it means two requests that ` +
          'produce different completions share a cache key — a wrong hit, not a miss.'),
      ).toBe(true);
    }
    // The v1 exclusion sentence named them as MUST NOT influence. It must be gone.
    expect(
      /Fields NOT in this set MUST NOT influence the cache key/.test(plain),
      'RFC 0150 §C: the v1 exclusion list forbade the very fields §C requires. It cannot survive ' +
        'alongside the v2 recipe — a reader following it would build the colliding digest.',
    ).toBe(false);
  });

  it('no Unicode normalization is prescribed outside JCS', () => {
    expect(
      /UTF-8 NFC for all strings/.test(plain),
      req('openwop.it.semantic-digest-v2.no-unicode-normalization-is-prescribed-outside-jcs', 'RFC 0150 §C', 'RFC 0150 §C: "Implementations MUST NOT add Unicode normalization outside JCS." JCS does ' +
        'not apply NFC, so offering NFC as the no-JCS fallback makes the two paths produce ' +
        'different bytes for the same input — defeating the portability §D asserts.'),
    ).toBe(false);
  });

  it('the recipe carries a version stamp so v1 and v2 digests cannot collide', () => {
    expect(
      plain,
      req('openwop.it.semantic-digest-v2.the-recipe-carries-a-version-stamp-so-v1-and-v2-digests-cannot-collide', 'RFC 0150 §C', 'RFC 0150 §C: the canonical object carries `recipe: "openwop-semantic-request-v2"`, so a ' +
        'digest computed under the old rules is distinguishable rather than silently comparable.'),
    ).toContain('openwop-semantic-request-v2');
  });

  it('unknown provider options are carried, not dropped', () => {
    expect(
      /providerOptions/.test(plain),
      req('openwop.it.semantic-digest-v2.unknown-provider-options-are-carried-not-dropped', 'RFC 0150 §C', 'RFC 0150 §C: unknown provider options MUST go in a closed, namespaced `providerOptions` ' +
        'object before hashing. "Silently dropping them is nonconformant" — a dropped option that ' +
        'changes output is the collision this section exists to prevent.'),
    ).toBe(true);
  });

  it('the Layer-2 cross-reference matches the composition that actually exists', () => {
    // Cross-document staleness introduced by RFC 0150 §B and not caught by it.
    expect(
      /attempt \|\| ':' \|\| providerKey|nodeId ':' attempt/.test(plain),
      'RFC 0150 §B retired the `attempt`-bearing Layer-2 composition as a safety-fix. `replay.md` ' +
        'MUST NOT keep quoting it — a reader following this section would rebuild the exact ' +
        'defect §B removed, and would do so believing they were following the spec.',
    ).toBe(false);
    expect(
      plain,
      req('openwop.it.semantic-digest-v2.the-layer-2-cross-reference-matches-the-composition-that-actually-exists', 'RFC 0150 §C', 'replay.md MUST cite the current Layer-2 identity'),
    ).toContain('logicalInvocationId');
  });
});
