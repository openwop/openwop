/**
 * v2-bundle-signature-attributable — RFC 0168 §E.2 (corpus wrapper, inline).
 *
 * A bundle signature has to name a key someone else can look up, or it is not
 * evidence. RFC 0168 recorded that objection verbatim — *"an Ed25519 attestation
 * without a key registry is a signature nobody can check"* — and disposed of it
 * by pointing at `signingKeys[]` in the host's discovery document. That surface
 * did not exist. The disposition named a place, nothing built the place, and
 * nothing noticed, because the gate that was supposed to depend on it never
 * looked: `check-cut-gates.mjs` tested the signature with
 * `typeof signature.sig === 'string'`.
 *
 * A string is satisfied by any string. Both Phase 4 hosts minted a keypair
 * minutes before certifying, signed with it, published it nowhere, and would
 * have passed the Front-door gate; both reported this themselves rather than
 * letting it through. This wrapper exists so the gap cannot silently reopen,
 * and it guards BOTH halves — the wire surface and the check that reads it —
 * because either one alone restores the failure.
 *
 * Three legs:
 *   1. the discovery root actually carries `signingKeys[]`, closed, with the
 *      three required members — the surface the RFC promised;
 *   2. `check-cut-gates.mjs` verifies rather than inspects: it references the
 *      published key and no longer accepts a signature by presence;
 *   3. the four outcomes stay distinct in the source — unread, unpublished,
 *      non-verifying, verifying. Collapsing any two is exactly how the
 *      original defect read as a pass.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle.
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §E.2
 * @see spec/v2/core/conformance.md
 * @see scripts/check-cut-gates.mjs
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0168.bundle-signature-attributable';
/** One id per leg: the wire surface, the check that reads it, and the report's
 *  ability to tell its outcomes apart. Each fails for a different reason and a
 *  shared id would let one leg's pass stand in for another's. */
const ID_SURFACE = `${ID}.surface`;
const ID_VERIFIES = `${ID}.verifies`;
const ID_OUTCOMES = `${ID}.outcomes`;
const SECTION = 'RFC 0168 §E.2';
const DOC = 'spec/v2/core/conformance.md';

/** The repo root. SCHEMAS_DIR is `<root>/schemas` and is always a string;
 *  V1_DIR is nullable in a published layout, so it is the wrong anchor here. */
const ROOT = join(SCHEMAS_DIR, '..');

function readCapabilities(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readGate(): string | null {
  try {
    return readFileSync(join(ROOT, 'scripts', 'check-cut-gates.mjs'), 'utf8');
  } catch {
    return null;
  }
}

describe('v2-bundle-signature-attributable (RFC 0168 §E.2)', () => {
  it('the v2 discovery root publishes signingKeys[] — the surface the RFC named', () => {
    const schema = readCapabilities();
    if (!schema) return softSkip('blocked', 'schemas/v2/capabilities.schema.json is unreadable from this layout');
    const props = (schema['properties'] ?? {}) as Record<string, { items?: Record<string, unknown> }>;
    const sk = props['signingKeys'];

    expect(
      sk !== undefined,
      req(ID_SURFACE, `${SECTION} / ${DOC}`, 'the v2 discovery root MUST carry signingKeys[] — RFC 0168 disposed of "an Ed25519 attestation without a key registry is a signature nobody can check" by naming this surface, so if it is absent the disposition names a place that does not exist and every bundle signature is unattributable'),
    ).toBe(true);
    if (!sk) return softSkip('blocked', 'signingKeys[] is absent from the v2 root — the assertion above has already recorded that as the failure, and there is no key record left to inspect');

    const items = (sk.items ?? {}) as { required?: unknown; additionalProperties?: unknown; properties?: Record<string, unknown> };
    const required = Array.isArray(items.required) ? (items.required as string[]) : [];
    for (const member of ['keyId', 'alg', 'publicKey']) {
      expect(
        required.includes(member),
        req(ID_SURFACE, `${SECTION} / ${DOC}`, `a signingKeys[] entry MUST require ${member} — a key you cannot name, cannot verify with, or whose algorithm is unstated resolves nothing`),
      ).toBe(true);
    }
    expect(
      items.additionalProperties,
      req(ID_SURFACE, `${SECTION} / ${DOC}`, 'a signingKeys[] entry MUST be closed; an open key record lets a host attach meaning the verifier does not read'),
    ).toBe(false);
    expect(
      Object.keys(items.properties ?? {}).includes('retiredAt'),
      req(ID_SURFACE, `${SECTION} / ${DOC}`, 'a signingKeys[] entry MUST be able to record retirement, because a retired key has to stay listed — dropping it silently invalidates every bundle it already signed, which is the opposite of what an evidence trail is for'),
    ).toBe(true);
  });

  it('the Front-door gate verifies the attestation instead of inspecting the string', () => {
    const src = readGate();
    if (!src) return softSkip('blocked', 'scripts/check-cut-gates.mjs is unreadable from this layout');

    expect(
      /typeof\s+hb\.bundle\.signature\?\.sig\s*===\s*'string'/.test(src),
      req(ID_VERIFIES, `${SECTION} / ${DOC}`, "the gate MUST NOT accept a bundle signature by presence: `typeof signature.sig === 'string'` is satisfied by any string, so it cannot distinguish a host key from a keypair minted seconds earlier by whoever wrote the bundle"),
    ).toBe(false);
    expect(
      src.includes('signingKeys') && /edVerify\(/.test(src),
      req(ID_VERIFIES, `${SECTION} / ${DOC}`, 'the gate MUST resolve signature.keyId against the host\'s published signingKeys[] and verify the Ed25519 attestation under it — resolving without verifying, or verifying against a key the bundle supplied itself, both leave the signature unaccountable'),
    ).toBe(true);
  });

  it('the four signature outcomes stay distinct — collapsing any two restores the defect', () => {
    const src = readGate();
    if (!src) return softSkip('blocked', 'scripts/check-cut-gates.mjs is unreadable from this layout');

    // Each outcome means something different to a reader of the report, and the
    // original defect WAS a collapse: everything that was not a missing string
    // read as a pass.
    const outcomes: ReadonlyArray<readonly [string, RegExp]> = [
      ['no discovery document was read (blocked, not a pass)', /blocked:\s*true[\s\S]{0,400}?attests INTEGRITY only/],
      ['the host publishes no keys at all', /publishes NO signingKeys\[\]/],
      ['the key id is not among those published', /not among the \$\{?/],
      ['the attestation does not verify', /does NOT verify under the host's published key/],
    ];
    const missing = outcomes.filter(([, re]) => !re.test(src)).map(([name]) => name);
    expect(
      missing,
      req(ID_OUTCOMES, `${SECTION} / ${DOC}`, `the gate MUST report these outcomes distinctly; a check that cannot tell them apart reports the unaccountable case in the same words as the verified one, which is the shape of the original defect (missing: ${missing.join('; ')})`),
    ).toEqual([]);
  });
});
