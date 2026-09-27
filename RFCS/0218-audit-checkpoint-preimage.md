# RFC 0218: an audit checkpoint signs its Merkle root, and the root is pinned

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0218                                                            |
| **Title**         | an audit checkpoint signs its Merkle root, and the root is pinned |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-27                                                      |
| **Updated**       | 2026-09-27 — filed and moved `Draft → Active` in the filing PR. **Comment window waived** (7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation", logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC touches no replay, external-effect or certification surface. It pins the bytes of an audit-log checkpoint, which no certification bundle, witness digest or replay digest covers. |
| **Affects**       | `spec/v1/auth-profiles.md` §"Audit-log integrity" 3 (the checkpoint preimage; the checkpoint export) · `schemas/audit-verify-result.schema.json` `merkleRoot` and `signature` descriptions (and the derived `schemas/v2/` copy) · conformance: `conformance/vectors/audit-checkpoint-v1.json`, `audit-checkpoint-vectors.test.ts`, `audit-checkpoint-signature.test.ts` (suite 2.42.7) |
| **Compatibility** | §A: W3C Process Class 3 correction (`COMPATIBILITY.md`, entry of 2026-09-27). §B: `additive`. No schema shape, error code, status or event changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The `openwop-audit-log-integrity` profile requires signed checkpoints and never says consistently what is signed. The prose signs "the merkleRoot" and defines the root as "SHA-256 of all entries up to atSequence". The verify-result schema says the signature covers "the checkpoint's canonical JSON" and the root covers "entries 0..atSequence". Both reference hosts and the out-of-band verifier do a third thing: a Merkle tree over the entries since the previous checkpoint, signed over the root's 32 raw bytes. §A pins that construction, the one every implementation already uses. §B defines the portable checkpoint export the verifier consumes, which until now existed only as a code comment.

## Motivation

A verifier is the whole point of a signed checkpoint, and no verifier could be written from the corpus.

- **The signature preimage had two contradictory statements.** `auth-profiles.md` §3 said "Ed25519 signature over the merkleRoot". `audit-verify-result.schema.json` said "over the checkpoint's canonical JSON (excluding the `signature` field itself)". A host following the schema and a verifier following the prose reject each other.
- **The root was not defined.** "SHA-256 of all entries up to atSequence" names neither a tree nor a concatenation, and the schema's "Merkle root over … entries 0..atSequence" gives a range that no implementation uses. Both reference hosts anchor only the entries since the previous checkpoint.
- **The suite said so and stopped.** `auth-profiles.md` §"Conformance" recorded that the suite checks a signature's presence and length only, "because the signed preimage is not yet stated consistently". The unfailable-leg audit (2026-09-27) carried this as a known gap.

Who implements the profile today: the SQLite and Postgres reference hosts (openwop-examples), which share one construction, and `scripts/verify-audit-checkpoints.mjs`. openwop-app opts out of the profile and MyndHyve does not advertise it. So pinning the implemented construction moves no deployed host.

## Proposal

### §A. The checkpoint preimage (Class 3 correction)

`auth-profiles.md` §"Audit-log integrity" 3 gains a paragraph stating the construction:

1. **Range.** A checkpoint anchors the entries with sequence in `(P, atSequence]`, `P` the previous checkpoint's `atSequence` or `0` for the first. It MUST anchor at least one entry.
2. **Leaves.** The entries' hashes, in sequence order. Each is the lowercase-hex SHA-256 of the entry's RFC 8785 JCS bytes, the value the next entry already carries as `prevHash` (step 2 of the profile).
3. **Root.** Built one level at a time. A pair becomes the lowercase-hex SHA-256 of the ASCII bytes of `left ‖ right`. A last odd node is promoted unchanged, never duplicated.
4. **Signature.** Ed25519 over the 32 bytes `merkleRoot` hex-decodes to, base64 (RFC 4648 §4, padded).
5. **Verifier rule.** A verifier that recomputes a root MUST hold the leaf count to `atSequence − P`.

The schema's two descriptions are corrected to match. The profile's field list now says what `merkleRoot` and `signature` are, not only that they exist.

**Why a Class 3 correction and not a breaking change.** The two texts could not both be satisfied: a signature over the root bytes and one over the canonical JSON are different signatures. Every implementation that exists followed one reading. This entry makes that reading the only conforming one, and nothing that was conforming stops being so. No shape, code or `MUST` changed. The same reasoning is on record for the `a2a-push-egress-ssrf` scheme arm and the fork-prefix bracket (`COMPATIBILITY.md`).

**Why this construction, weaknesses included.** It lacks the leaf/interior domain separation RFC 6962 §2.1 uses (`0x00`/`0x01` prefixes). A verifier that did not fix the leaf count could be shown a checkpoint's level-1 nodes as its leaves and would accept them. Rule 5 closes that: with the count fixed, the tree shape is fixed, and a forged leaf list needs a SHA-256 second preimage. Promoting the odd node, rather than duplicating it, avoids the CVE-2012-2459 ambiguity where two different leaf lists share a root. Switching to RFC 6962 hashing would break both reference hosts' stored checkpoints, which are already signed (Alternative 2).

### §B. The checkpoint export (additive)

A host claiming the profile MAY publish its checkpoints as a portable export for an out-of-band verifier. When it does, the export MUST be the document `auth-profiles.md` now shows: `bundleVersion: "1"`, `exportedAt`, optional `host`, `signingKey { keyId, algorithm: "ed25519", publicKeyPEM }`, and `checkpoints[] { checkpointId, atSequence, merkleRoot, signature, signedAt, signingKeyId }`. Every `signingKeyId` MUST equal `signingKey.keyId`, so a host that dual-signs during a rotation publishes one export per key. This is the shape `examples/hosts/postgres/src/audit-export.ts` produces and `scripts/verify-audit-checkpoints.mjs` consumes. It is stated in prose only, with no new schema file, because v1 is frozen through the overlap and the verifier already checks every member.

### Examples

**Conforming.** Checkpoint at 12 with the previous at 7 anchors entries 8–12, five leaves. Level 1 is `H(l8‖l9)`, `H(l10‖l11)`, `l12`. Level 2 is `H(a‖b)`, `l12`. The root is `H(c‖l12)`, and the signature is over its 32 bytes. See `conformance/vectors/audit-checkpoint-v1.json`.

**Non-conforming.**
- Signing the checkpoint object's JCS bytes, or the 64 hex characters of the root.
- Duplicating `l12` to make an even level.
- Anchoring entries 1–12 again at the second checkpoint.
- A verifier accepting the two level-1 nodes of the checkpoint at 7 as its leaves.

## Compatibility

- **§A.** A Class 3 correction (see §A). A host that signed the canonical JSON was never jointly conforming, because the prose it also had to follow said otherwise. None is known.
- **§B.** `additive`. The export is optional (MAY). A host that publishes none is unaffected.
- **No wire change.** No schema property, `required` entry, error code or status moved. The `check-v2-surface-monotone` baseline is unchanged, since descriptions are not surfaces.

## Conformance

- **`audit-checkpoint-vectors.test.ts`** is server-free, runs at both majors, and is in `openwop:check`'s server-free list. It recomputes every entry hash, root and signature in `conformance/vectors/audit-checkpoint-v1.json` through `conformance/src/lib/audit-checkpoint.ts`. It refuses:
  - interior nodes presented as leaves;
  - an uppercase leaf;
  - an empty range;
  - two wrong-preimage signatures.

  The vectors come from an implementation independent of the lib and were cross-checked in Python. Three sabotages of the lib each turned one leg red: duplicating the odd node, dropping the leaf-count check, and hashing decoded bytes.
- **`audit-checkpoint-signature.test.ts`** is major 1 and gated on the profile. It verifies every checkpoint `GET /v1/audit/verify` returns under the advertised `checkpointPublicKey`. A host with no checkpoint yet records `inapplicable` before any assertion.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A construction, reproduced by any implementation (`openwop.requirement.0218.checkpoint-preimage-vectors`) | the committed vectors recompute, and the refusals are refused | the suite, server-free | witnessable — corpus gate |
| §A.4 signature over the root bytes (`openwop.requirement.0218.checkpoint-signature-over-root`) | each served checkpoint's signature verifies under the advertised key over its hex-decoded root | the suite, gated on the profile | witnessable — gated on the profile |
| §A.1–3 the host's root is over `(P, atSequence]` | — the entries are not on the wire | nobody from outside | unwitnessable — the entries are not on the wire, so only the host-internal tamper tests (openwop-examples) and an out-of-band verifier with entry access can recompute a host's root |
| §B export shape | an export validates under `verify-audit-checkpoints.mjs` | the operator | witnessable — gated (out of band, when an operator publishes an export; `openwop:check` runs the verifier on the committed samples) |

## Alternatives considered

1. **Adopt the schema's reading (sign the checkpoint's canonical JSON).** It binds `atSequence` and the id into the signature, which is a real advantage. Rejected: no implementation does it, both reference hosts' stored checkpoints would stop verifying, and binding `atSequence` is already achieved by the verifier's leaf-count rule plus the monotonic order check.
2. **RFC 6962 hashing (leaf and node prefixes).** This is the textbook construction. Rejected for this RFC because it re-signs every stored checkpoint. It stays open as a future profile version (Unresolved 1).
3. **Do nothing.** The suite keeps checking only that a signature has the right length, and no independent verifier can be written from the corpus.

## Unresolved questions

1. Should a future profile version move to RFC 6962 domain-separated hashing, signalled by a `checkpointSignatureAlgorithm` or a new `merkleConstruction` member? That would be a new capability value, so RFC 0147 §A's freeze applies.

## Implementation notes (non-normative)

- Both reference hosts already implement §A (`merkleRoot()` and `sign(null, Buffer.from(root, 'hex'), …)` in `examples/hosts/{sqlite,postgres}/src/audit.ts`), and the Postgres host already implements §B (`audit-export.ts`).
- The vectors use the RFC 8032 §7.1 TEST 1 key, which is published and must never be used for anything else.

## Acceptance criteria

- [x] `Active`: the `auth-profiles.md` construction and export text, the corrected schema descriptions (v1 and derived v2), the vectors and both scenarios (suite 2.42.7), sabotage-proved.
- [ ] `openwop.requirement.0218.checkpoint-signature-over-root` `executed-pass` on a host bundle cut against a host that claims the profile and serves at least one checkpoint (the Postgres reference host). The acceptance predicate's bundle bar applies.

## References

- `spec/v1/auth-profiles.md` §"Audit-log integrity"; `schemas/audit-verify-result.schema.json`.
- RFC 8785 (JCS); RFC 8032 (Ed25519); RFC 6962 §2.1 (Merkle hash trees); CVE-2012-2459.
- RFC 0212 (canonical JSON is JCS).
- `scripts/verify-audit-checkpoints.mjs`; `conformance/audit-export-samples/`.
- TODO.md §3 (audit follow-ups, 2026-09-26).
