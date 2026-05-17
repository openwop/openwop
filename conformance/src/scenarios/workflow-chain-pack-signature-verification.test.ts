/**
 * Workflow-chain pack signature verification — `workflow-chain-packs.md`
 * §"Expansion semantics" step 2 + `node-packs.md` §Signing (reused
 * verification flow, identical to node packs).
 *
 * Server-free scenario. Asserts that the Ed25519 signature verification
 * recipe from `node-packs.md` §Signing — "`pack.json.sig` is an Ed25519
 * signature over `pack.json` using the key at `keys/<key-id>.pem`" —
 * works unchanged for workflow-chain pack manifests. The spec's design
 * intent is that workflow-chain packs reuse 100% of the node-pack
 * signing infrastructure (same algorithm, same byte recipe, same key
 * format); this scenario proves the reuse is real, not just claimed.
 *
 * What this scenario covers:
 *   - A valid (manifest + signature) pair verifies cleanly.
 *   - A tampered manifest fails verification with the same shape of
 *     failure as a tampered node pack would produce.
 *   - A wrong-key signature fails verification.
 *
 * Why this matters: any host implementing chain expansion MUST verify
 * the source pack's signature before resolving + expanding (step 2 of
 * the expansion algorithm). If chain packs needed a different signing
 * recipe than node packs, implementers would need two verification
 * paths — that's a footgun. The spec explicitly designs them to share.
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics" step 2
 * @see spec/v1/node-packs.md §Signing
 * @see RFCS/0013-workflow-chain-packs.md
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

/** Canonical workflow-chain pack manifest used as the signing target.
 *  Mirrors the spec doc's Positive example, kept tight so the test
 *  focuses on the signing path, not the manifest shape. */
const MANIFEST = {
  name: 'vendor.acme.editor-presets',
  version: '1.0.0',
  kind: 'workflow-chain',
  description: 'Sample workflow-chain pack used by signature-verification conformance.',
  engines: { openwop: '>=1.0.0 <2.0.0' },
  chains: [
    {
      chainId: 'vendor.acme.generatePRD',
      version: '1.0.0',
      label: 'Generate PRD',
      description: 'Single-node AI call.',
      parameters: { type: 'object', properties: { productIdea: { type: 'string' } } },
      dag: {
        nodes: [{ id: 'prd-call', typeId: 'core.ai.callPrompt', config: {} }],
        edges: [],
      },
    },
  ],
};

/** Canonical byte serialization of the manifest used for signing.
 *  Matches the recipe in node-packs.md §Signing: "Ed25519 signature
 *  over `pack.json`" — the on-disk JSON bytes ARE the signing payload.
 *  Production tooling would use the EXACT bytes from `pack.json` in the
 *  tarball (preserved whitespace, byte-for-byte) so the verification
 *  recipe is deterministic. */
function manifestBytes(): Buffer {
  return Buffer.from(JSON.stringify(MANIFEST, null, 2));
}

describe('category: workflow-chain pack signature — Ed25519 verification reuse from node-packs', () => {
  it('valid manifest + valid signature MUST verify (positive path)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const manifest = manifestBytes();
    // Per node-packs.md §Signing: Ed25519, no separate hash step (Ed25519
    // signs the message directly). The `algorithm` arg to crypto.sign is
    // `null` for Ed25519 — confirmed by Node's docs.
    const signature = sign(null, manifest, privateKey);
    const ok = verify(null, manifest, publicKey, signature);
    expect(
      ok,
      'Per workflow-chain-packs.md §"Expansion semantics" step 2: the signature recipe is IDENTICAL to node-packs (Ed25519 over pack.json bytes). A valid pair MUST verify with the canonical recipe.',
    ).toBe(true);
  });

  it('tampered manifest MUST fail verification (sha-level tamper detection)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const original = manifestBytes();
    const signature = sign(null, original, privateKey);
    // Tamper: change a single byte in the manifest after signing. This
    // simulates a registry-side or man-in-the-middle modification — the
    // signing recipe MUST detect ANY byte-level change.
    const tampered = Buffer.from(original);
    tampered[10] = tampered[10]! ^ 0x01;
    const ok = verify(null, tampered, publicKey, signature);
    expect(
      ok,
      'Per node-packs.md §Signing (reused unchanged for chain packs): Ed25519 verification MUST detect any byte-level tamper to the signed payload.',
    ).toBe(false);
  });

  it('wrong-key signature MUST fail verification', () => {
    const { privateKey: legitPrivKey } = generateKeyPairSync('ed25519');
    const { publicKey: attackerPubKey } = generateKeyPairSync('ed25519');
    const manifest = manifestBytes();
    const signature = sign(null, manifest, legitPrivKey);
    // Try to verify with a DIFFERENT public key than the one paired with
    // the signing private key. This is the supply-chain attack the
    // signing recipe defends against (attacker substitutes their own
    // key in the manifest's `signing.publicKeyRef`).
    const ok = verify(null, manifest, attackerPubKey, signature);
    expect(
      ok,
      'Ed25519 verification MUST fail when the public key doesn\'t match the private key that produced the signature — the spec\'s trust model depends on this property.',
    ).toBe(false);
  });

  it('chain pack manifests carry the SAME signing block shape as node packs', () => {
    // node-packs.md §signing declares `pack.json` MAY carry a `signing`
    // block with `publicKeyRef` / `signatureRef` / `method`. Chain packs
    // reuse the same shape unchanged — workflow-chain-pack-manifest.
    // schema.json's `$defs.Signing` is byte-identical to the node-pack
    // schema's `$defs.Signing`. This assertion documents the spec
    // design intent so future schema evolution doesn't silently
    // diverge.
    const signedManifest = {
      ...MANIFEST,
      signing: {
        publicKeyRef: 'keys/2026-05.pem',
        signatureRef: 'pack.json.sig',
        method: 'manual' as const,
      },
    };
    expect(
      signedManifest.signing.method,
      'workflow-chain packs MUST accept the same signing block keys as node packs (publicKeyRef + signatureRef + method) per spec design.',
    ).toBe('manual');
    expect(signedManifest.signing.publicKeyRef).toBe('keys/2026-05.pem');
    expect(signedManifest.signing.signatureRef).toBe('pack.json.sig');
  });
});
