/**
 * RFC 0150 §C — the golden vectors, and the relationships they exist to pin.
 *
 * §C's acceptance criterion is that TypeScript, Python, and Go compute the same
 * digest. Prose cannot deliver that: three independent readings of "canonicalize
 * via JCS and hash" is precisely how three implementations disagree, and the
 * disagreement is invisible until two hosts replay the same run and get
 * different cache keys.
 *
 * So the vectors are the contract, and this gate holds the TypeScript
 * implementation to them. An SDK in another language reproduces the same file.
 *
 * The vectors are not a flat list of examples. Several are **pairs**, and the
 * relationship between the members is the actual requirement:
 *
 *   - tools sorted vs reversed  → MUST be equal (order is not semantic)
 *   - message order reversed    → MUST differ (order IS semantic)
 *   - two Unicode forms of "é"  → MUST differ, because JCS does not apply NFC
 *
 * That last pair is the one worth keeping. A well-meaning implementer who adds
 * NFC "to be safe" makes those two vectors collide, and every other vector still
 * passes — so a suite that checked only individual digests would go green on an
 * implementation that had silently broken cross-host agreement.
 *
 * Server-free and always-on. The vectors ship with the conformance package.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  semanticRequestDigestV2,
  projectSemanticRequestV2,
  canonicalize,
  SEMANTIC_REQUEST_RECIPE_V2,
} from '../lib/llm-cache-key-recipe.js';
import { req } from '../lib/requirement-ids.js';

interface Vector {
  readonly id: string;
  readonly why: string;
  readonly input: Record<string, unknown>;
  readonly canonical: string;
  readonly digest: string;
}

const VECTORS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'vectors',
  'semantic-request-digest-v2.json',
);

const doc = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
  recipe: string;
  vectors: readonly Vector[];
};
const byId = new Map(doc.vectors.map((v) => [v.id, v]));

/**
 * Recompute a vector's digest from its INPUT.
 *
 * Deliberately not `v.digest`. Reading the stored value would make the
 * relationship legs below compare two constants out of the same file — they
 * would validate that the vector SET is internally distinct and would pass
 * unchanged against a broken implementation. That is the vacuity this whole
 * program exists to close, and the first draft of this file had it: the NFC
 * sabotage was caught by the per-vector reproduction leg, while the leg written
 * specifically to catch it could not have failed.
 */
function digest(id: string): string {
  const v = byId.get(id);
  if (v === undefined) throw new Error(`vector '${id}' is missing from the golden set`);
  return semanticRequestDigestV2(v.input);
}

/** The stored expectation, for legs that check the file rather than the code. */
function storedDigest(id: string): string {
  const v = byId.get(id);
  if (v === undefined) throw new Error(`vector '${id}' is missing from the golden set`);
  return v.digest;
}

describe('RFC 0150 §C — semantic request digest golden vectors', () => {
  it('the vector set is present and non-trivial', () => {
    // Guard: an empty or truncated file would make every leg below vacuous, and
    // this gate's whole value is that it fails when an implementation drifts.
    expect(doc.recipe).toBe(SEMANTIC_REQUEST_RECIPE_V2);
    expect(doc.vectors.length, req('openwop.it.semantic-digest-vectors.the-vector-set-is-present-and-non-trivial', 'RFC 0150 §C', 'the golden set MUST cover the recipe')).toBeGreaterThanOrEqual(10);
    expect(new Set(doc.vectors.map((v) => v.id)).size).toBe(doc.vectors.length);
    for (const v of doc.vectors) {
      expect(v.why.length, req('openwop.it.semantic-digest-vectors.the-vector-set-is-present-and-non-trivial', 'RFC 0150 §C', `vector '${v.id}' MUST say what it pins`)).toBeGreaterThan(20);
    }
  });

  it.each(doc.vectors.map((v) => [v.id, v] as const))(
    'the implementation reproduces %s',
    (_id, v) => {
      // The preimage is asserted as well as the hash: a mismatch on `canonical`
      // tells an implementer WHICH field they got wrong, where a hash mismatch
      // tells them only that something is.
      expect(canonicalize(projectSemanticRequestV2(v.input)), req('openwop.it.semantic-digest-vectors.the-implementation-reproduces-s', 'RFC 0150 §C', v.why)).toBe(v.canonical);
      expect(semanticRequestDigestV2(v.input), v.why).toBe(v.digest);
    },
  );

  it('tool order is not semantic — sorted and reversed agree', () => {
    expect(digest('tools-sorted-by-name'), req('openwop.it.semantic-digest-vectors.tool-order-is-not-semantic-sorted-and-reversed-agree', 'RFC 0150 §C', 'tool order is not semantic — sorted and reversed agree')).toBe(digest('tools-reversed-same-digest'));
  });

  it('message order IS semantic — reversing changes the digest', () => {
    expect(
      digest('message-order-is-semantic'),
      req('openwop.it.semantic-digest-vectors.message-order-is-semantic-reversing-changes-the-digest', 'RFC 0150 §C', 'messages carry conversational sequence; sorting them would make two different conversations collide'),
    ).not.toBe(digest('message-order-reversed'));
  });

  it('the two Unicode forms do not collide, because JCS does not apply NFC', () => {
    // The pair that catches a well-meaning "add NFC to be safe" change — and it
    // catches it only because `digest()` RECOMPUTES from the input. Comparing
    // stored values here would be two constants from one file.
    expect(storedDigest('non-ascii-not-normalized'), req('openwop.it.semantic-digest-vectors.the-two-unicode-forms-do-not-collide-because-jcs-does-not-apply-nfc', 'RFC 0150 §C', 'the two Unicode forms do not collide, because JCS does not apply NFC')).not.toBe(storedDigest('non-ascii-composed'));
    expect(
      digest('non-ascii-not-normalized'),
      'RFC 0150 §C: "Implementations MUST NOT add Unicode normalization outside JCS." An ' +
        'implementation that normalizes makes these two collide and silently loses cross-host ' +
        'byte agreement — the property `replay.md` §D asserts as a normative invariant.',
    ).not.toBe(digest('non-ascii-composed'));
  });

  it('each field v1 excluded now changes the digest', () => {
    // The defect §C fixes, stated as three inequalities. Under v1 all three of
    // these were equal to `minimal`, so requests producing different completions
    // shared a cache key — a wrong hit, not a miss.
    for (const id of ['stop-changes-digest', 'seed-changes-digest', 'max-output-changes-digest']) {
      expect(digest(id), req('openwop.it.semantic-digest-vectors.each-field-v1-excluded-now-changes-the-digest', 'RFC 0150 §C', `${id} MUST NOT equal the minimal request`)).not.toBe(digest('minimal'));
    }
  });
});
