# RFC 0218: an audit checkpoint signs its Merkle root, and the root is pinned

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0218                                                            |
| **Title**         | an audit checkpoint signs its Merkle root, and the root is pinned |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-27                                                      |
| **Updated**       | 2026-09-28 — **`Active → Accepted`, provisional pending RFC 0156 §B retrospective review** (it went `Active` under a waived window; register row `not-reviewed`). Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host; single witness. Its certified public cut on published 2.43.0 (build `commit:bc8cc30e`, witness `0a7ed040313c`, signed `v2-reference-4`, 406 pass / 0 fail / 0 blocked, relaxations `[]`, all three profiles certified; `evidence/v2-host-bundles/openwop-host-v2-reference.json`, sha256 `7da3de2fc6a443f44c517faf7271561e193dd6fc4bdd1f97e454e95e78130bb7`) records `openwop.requirement.0218.checkpoint-signature-over-root`, `…checkpoint-preimage-vectors` and `…anomaly-shape` `executed-pass`. The witness is the v2 reference host rather than the Postgres reference host the criterion named: RFC 0224 gave audit-log integrity a v2 home, so the v2 host claims the family and serves checkpoints. (A Postgres major-1 run on 2.42.8/2.42.9 also passed the signature row but cannot certify at major 1.) · 2026-09-27 — filed and moved `Draft → Active` in the filing PR. **Comment window waived** (7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation", logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC touches no replay, external-effect or certification surface. It pins the bytes of an audit-log checkpoint, which no certification bundle, witness digest or replay digest covers. 2026-09-28 — amended in place while `Active` with **§C, the anomaly entries** of `GET /v1/audit/verify`, under the same waiver. Both reference hosts returned `{atSequence, kind, detail}` against a schema that closed `Anomaly` to `{atSeq, expectedPrevHash, actualPrevHash}`, and reported a forged checkpoint signature with `chainValid: true`. The schema's shape is kept and gains `kind`. §A.6 still does not apply: an anomaly is a verifier's report, and no bundle, witness or replay digest covers it. |
| **Affects**       | `spec/v1/auth-profiles.md` §"Audit-log integrity" 3 (the checkpoint preimage; the checkpoint export) · `schemas/audit-verify-result.schema.json` `merkleRoot` and `signature` descriptions (and the derived `schemas/v2/` copy) · conformance: `conformance/vectors/audit-checkpoint-v1.json`, `audit-checkpoint-vectors.test.ts`, `audit-checkpoint-signature.test.ts` (suite 2.42.7) · §C: `auth-profiles.md` §"Audit-log integrity" 4 and `audit-verify-result.schema.json` `$defs/Anomaly` (v1 and derived v2), `audit-anomaly-shape.test.ts` (suite 2.43.0) |
| **Compatibility** | §A: W3C Process Class 3 correction (`COMPATIBILITY.md`, entry of 2026-09-27). §B: `additive`. §C: `additive` (optional members on `Anomaly`), plus a Class 3 correction of the `chainValid` statement (`COMPATIBILITY.md`, entry of 2026-09-28). No error code, status or event changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The `openwop-audit-log-integrity` profile requires signed checkpoints and never says consistently what is signed. The prose signs "the merkleRoot" and defines the root as "SHA-256 of all entries up to atSequence". The verify-result schema says the signature covers "the checkpoint's canonical JSON" and the root covers "entries 0..atSequence". Both reference hosts and the out-of-band verifier do a third thing: a Merkle tree over the entries since the previous checkpoint, signed over the root's 32 raw bytes. §A pins that construction, the one every implementation already uses. §B defines the portable checkpoint export the verifier consumes, which until now existed only as a code comment. §C (added 2026-09-28) says what an anomaly in the verification result looks like, since the reference hosts and the schema disagreed.

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

### §C. Anomaly entries (added 2026-09-28)

`GET /v1/audit/verify` returns `anomalies[]`. The schema closed each entry to `{ atSeq, expectedPrevHash, actualPrevHash }`, which describes a chain break and nothing else. The verifier both reference hosts run detects five things and reported them as `{ atSequence, kind, detail }`, a shape the closed schema refuses. The black-box leg never saw the difference because it asserts an empty `anomalies` on an untampered log.

1. **The schema's shape is the contract.** `Anomaly` keeps `atSeq` and gains an OPTIONAL `kind`: `chain-break`, `hash-mismatch`, `missing-entry`, `merkle-mismatch` or `signature-invalid`. An entry without `kind` is a `chain-break`, so every document valid before stays valid. Hosts SHOULD set `kind`.
2. **`kind` fixes the members.**
   - `chain-break` REQUIRES `expectedPrevHash` and `actualPrevHash`. Both MAY be `null` for a genesis `prevHash`, which step 2 defines as `null`.
   - `merkle-mismatch` and `signature-invalid` REQUIRE `checkpoint`, the failing checkpoint's id. `atSeq` is the checkpoint's `atSequence`. The id is needed because two checkpoints can share an `atSequence` while a rotating key dual-signs.
   - `hash-mismatch` and `missing-entry` carry only `atSeq`.
   - A member outside its kind is refused, so a verifier that dispatches on `kind` never sees an ambiguous entry.
3. **`detail`** is an OPTIONAL string for an operator. A verifier MUST NOT branch on it.
4. **`chainValid` is `false` exactly when `anomalies` is non-empty (Class 3 correction).** The schema already said `chainValid` is false on "ANY break or invalid signature" and that `anomalies` is empty when it is true. Both hosts reported a forged signature as `chainValid: true` with `checkpointsValid: false`, and the schema's own `checkpointsValid` text ("checkpoints forged but chain intact") could be read to allow it. The reading that keeps a client which only reads `chainValid` safe is the aggregate one, so that reading is pinned. `checkpointsValid` stays the OPTIONAL bit that says which half failed.
5. **An unknown `kind` is a failure.** A verifier that meets a `kind` it does not know MUST treat the entry as an anomaly, never skip it.

**What was dropped.** The hosts' `detail` strings carried the recomputed and stored hashes of a `hash-mismatch`. No verifier reads them as data, so they stay in `detail` and get no members. A verifier that needs them recomputes from the entries.

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
- **§A and §B: no wire change.** No schema property, `required` entry, error code or status moved.
- **§C.** `additive` for the shape: `kind`, `checkpoint` and `detail` are new OPTIONAL members, and `expectedPrevHash`/`actualPrevHash` move from always-required to required for `chain-break`, the kind an entry without `kind` is. Every document valid before is valid now. The `null` genesis hash widens a type, which `check-v2-surface-monotone` passes. §C.4 is a Class 3 correction (`spec/v2/corrections.json` row `openwop.correction.v2.3`; no committed v2 bundle and no registry manifest carries a verify result): the schema's `chainValid` text already required it, and the only implementations that differed are the two reference hosts, corrected in openwop-examples in the same cycle. openwop-app and MyndHyve do not advertise the profile.

## Conformance

- **`audit-checkpoint-vectors.test.ts`** is server-free, runs at both majors, and is in `openwop:check`'s server-free list. It recomputes every entry hash, root and signature in `conformance/vectors/audit-checkpoint-v1.json` through `conformance/src/lib/audit-checkpoint.ts`. It refuses:
  - interior nodes presented as leaves;
  - an uppercase leaf;
  - an empty range;
  - two wrong-preimage signatures.

  The vectors come from an implementation independent of the lib and were cross-checked in Python. Three sabotages of the lib each turned one leg red: duplicating the odd node, dropping the leaf-count check, and hashing decoded bytes.
- **`audit-checkpoint-signature.test.ts`** is major 1 and gated on the profile. It verifies every checkpoint `GET /v1/audit/verify` returns under the advertised `checkpointPublicKey`. A host with no checkpoint yet records `inapplicable` before any assertion.

- **`audit-anomaly-shape.test.ts`** (suite 2.43.0) is server-free, runs at both majors, and is in `openwop:check`'s server-free list. It validates one anomaly of each kind and a kind-less legacy entry against `audit-verify-result.schema.json`, and refuses: `atSequence` for `atSeq` (the hosts' old shape); a `merkle-mismatch` without `checkpoint`; a `chain-break` without its hashes; a mixed entry carrying both `checkpoint` and the chain hashes; an unknown `kind`. At the result level it refuses `chainValid: true` with a non-empty `anomalies` (the hosts' forged-signature report) and `chainValid: false` with an empty one; the schema now carries that as a root `if/then/else`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A construction, reproduced by any implementation (`openwop.requirement.0218.checkpoint-preimage-vectors`) | the committed vectors recompute, and the refusals are refused | the suite, server-free | witnessable — corpus gate |
| §A.4 signature over the root bytes (`openwop.requirement.0218.checkpoint-signature-over-root`) | each served checkpoint's signature verifies under the advertised key over its hex-decoded root | the suite, gated on the profile | witnessable — gated on the profile |
| §A.1–3 the host's root is over `(P, atSequence]` | — the entries are not on the wire | nobody from outside | unwitnessable — the entries are not on the wire, so only the host-internal tamper tests (openwop-examples) and an out-of-band verifier with entry access can recompute a host's root |
| §C.1–3 anomaly shape (`openwop.requirement.0218.anomaly-shape`) | sample anomalies of every kind validate, the refusals are refused | the suite, server-free | witnessable — corpus gate |
| §C.1–4 a host's served anomalies | — a black-box caller cannot tamper with the log, so an untampered log serves none | nobody from outside | unwitnessable from outside — the host-internal tamper tests (openwop-examples) assert every kind's shape against the schema |
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
- [x] §C (2026-09-28): the schema's `Anomaly` with `kind` (v1 and derived v2), `auth-profiles.md` step 4, `audit-anomaly-shape.test.ts` (suite 2.43.0), sabotage-proved; both reference hosts serve the shape and their tamper tests validate every anomaly against the schema.
- [x] `openwop.requirement.0218.checkpoint-signature-over-root` `executed-pass` on a host bundle cut against a host that claims the profile and serves at least one checkpoint. The acceptance predicate's bundle bar applies. Met 2026-09-28 by the v2 reference host's certified 2.43.0 cut (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, sha256 `7da3de2f…`). (Amended 2026-09-28: this box named the Postgres reference host when only major 1 carried the profile; RFC 0224 moved the profile to v2, and a certified v2 bundle is the stronger witness.)

## References

- `spec/v1/auth-profiles.md` §"Audit-log integrity"; `schemas/audit-verify-result.schema.json`.
- RFC 8785 (JCS); RFC 8032 (Ed25519); RFC 6962 §2.1 (Merkle hash trees); CVE-2012-2459.
- RFC 0212 (canonical JSON is JCS).
- `scripts/verify-audit-checkpoints.mjs`; `conformance/audit-export-samples/`.
- TODO.md §3 (audit follow-ups, 2026-09-26).
