# RFC 0224: audit-log integrity gets a v2 home

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0224                                                            |
| **Title**         | audit-log integrity gets a v2 home                              |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-28 — filed and moved `Draft → Active` in the filing PR. **Comment window waived** (7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation", logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC touches no replay, external-effect or certification surface. It gives an existing optional profile a v2 advertisement, and no certification bundle, witness digest or replay digest covers an audit checkpoint. RFC 0147 §A's freeze on new optional capabilities is spent (2026-08-20), so a new family is permitted. The evidence gate is not waived: `Accepted` waits for a certified public v2 bundle, and the RFC 0156 §B retrospective review is owed. |
| **Affects**       | `spec/v2/declaration.json` (new family `auditLogIntegrity`) and the generated `schemas/v2/capabilities.schema.json` · `spec/v2/facets/auditLogIntegrity.schema.json` (new) · `spec/v2/core/security-defaults.md` (obligation row + §Audit-log integrity) · `spec/v2/core/capabilities.md` §5 · `api/v2/openapi.yaml` `verifyAuditLog` description (via `scripts/derive-v2-api-prose.yaml`) · `SECURITY/invariants.yaml` (`audit-checkpoint-signed-over-root`) · `SECURITY/threat-model-auth-profiles.md` §4.6 · conformance: `audit-log-integrity.test.ts`, `audit-checkpoint-signature.test.ts` (both majors), `src/lib/auditIntegrity.ts` (suite 2.43.0) |
| **Compatibility** | `additive` — a new optional family on the closed v2 root, and one new leg on an existing major-1 MUST (the declared checkpoint cadence). No existing schema property, `required` entry, error code or status changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v2 serves `GET /audit/verify` (`verifyAuditLog`), and its description says a host that does not advertise the `openwop-audit-log-integrity` profile MAY omit it. But v2 had no way to advertise that profile. The earlier major advertised it as `capabilities.auth.profiles[]` plus `capabilities.auth.auditLogIntegrity`. v2 replaced `auth.profiles` with `auth.lanes[]` (RFC 0175/0169), so the advertisement did not survive, and no v2 prose stated the obligation. This RFC adds a core family, `auditLogIntegrity`, whose presence claims the profile and gates the operation. Its facets are the key and cadence a verifier needs. The obligation is stated in `security-defaults.md` by reference to RFC 0218 §A–§C.

## Motivation

- **An operation with no advertisement.** `spec/v2/path-manifest.json` lists `verifyAuditLog`, and `schemas/v2/audit-verify-result.schema.json` is its body. Neither the declaration file, the generated capability schema nor any v2 document had a family, facet or row a host could use to say it serves that operation. Under the closed v2 root, `auth.auditLogIntegrity` fails validation.
- **RFC 0218 could not reach `Accepted`.** Its signature row (`openwop.requirement.0218.checkpoint-signature-over-root`, `audit-checkpoint-signature.test.ts`) ran at major 1 only. The acceptance bar is a certified v2 bundle, and no v2 host could advertise the profile the row gates on. The requirement was unreachable by construction.
- **The only normative text is v1-dependent.** `spec/v1/auth-profiles.md` §"Audit-log integrity" is operative through the overlap. At v1 end-of-support the profile would lose its only statement.

## Proposal

### §A. The family

`spec/v2/declaration.json` gains a core family row:

| Field | Value |
| --- | --- |
| `key` / `peerDependencyId` | `auditLogIntegrity` |
| `witness` | `witnessable-gated` |
| `maturity` | `experimental` / `none` |
| `normativeText` | `spec/v2/core/security-defaults.md` |
| `facetsFrom` | `spec/v2/facets/auditLogIntegrity.schema.json` |
| `owningRfc` | `0224` |

The facets (all REQUIRED when the record is present):

| Facet | Schema | Meaning |
| --- | --- | --- |
| `checkpointSignatureAlgorithm` | `const: "ed25519"` | The signature of RFC 0218 §A.4. |
| `checkpointPublicKey` | string, `^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$` | Base64 of the audit-signing key's DER SPKI. The pattern admits exactly an Ed25519 SPKI (the 12-byte prefix, then 32 key bytes). |
| `checkpointIntervalEntries` | integer ≥ 1 | The most entries one checkpoint anchors. |
| `checkpointIntervalSeconds` | integer ≥ 1 | The longest an entry waits for a checkpoint. |

1. **Presence is the claim.** Under capabilities.md §2, a host that does not keep an integrity-protected audit log MUST omit the record. The earlier major's `hashChain: true` therefore has no seat: a record that exists claims the chain.
2. **The operation.** A host advertising the family MUST serve `GET /audit/verify` under `audit:read`, answering `schemas/v2/audit-verify-result.schema.json`. A host that does not advertise it MAY omit the operation (the operation's existing text, now resolvable).
3. **The cadence is a claim the verify body can falsify.** The earlier major already said a host MUST sign checkpoints "at intervals declared by the host". v2 makes the declaration a required facet. Consecutive checkpoints, and the first checkpoint counted from `0`, differ in `atSequence` by at most `checkpointIntervalEntries`. `checkpoints[]` lists every checkpoint whose `atSequence` is in the requested range, ascending. A body that omits a checkpoint therefore shows a gap the advertised cadence forbids.
4. **What is referenced, not restated.** The chain (`prevHash` over the prior entry's JCS bytes), the checkpoint range, leaves, root and signature preimage are RFC 0218 §A. The anomaly shape and `chainValid` as the aggregate verdict are RFC 0218 §C. `security-defaults.md` states the obligation and links RFC 0218. It does not duplicate the construction.
5. **The key.** The audit-signing key MUST be used for no other surface (the earlier major's §"Key management"). This RFC does not carry a v2 rotation rule. Rotation and dual-signing stay as the earlier major states them (Unresolved 1).

### §B. Where it lives

`spec/v2/core/security-defaults.md` gains an obligation-table row (`auditLogIntegrity` → a chained, checkpointed, verifiable audit log → `witnessable-gated` → `audit-checkpoint-signed-over-root`) and a §Audit-log integrity. `capabilities.md` §5 gains the heading (73 core families). The v2 `verifyAuditLog` description now names the family and `security-defaults.md` rather than the v1 profile. The kernel budget grows by 200 words for the newly homed family and the section costs fewer than that.

### §C. Invariant

`audit-checkpoint-signed-over-root` (reference-impl at `Active`, `high`): every checkpoint a host serves verifies as Ed25519 over its root's 32 bytes under the advertised key, at the advertised cadence. Tests: the two scenarios. It graduates to protocol-tier at `Accepted`, on a non-vacuous executed-pass in a committed bundle. The threat is recorded in `SECURITY/threat-model-auth-profiles.md` §4.6.

### Examples

**Conforming.**

```json
"auditLogIntegrity": {
  "status": "experimental", "since": "2.0", "until": "2.1", "witness": "witnessable-gated",
  "checkpointSignatureAlgorithm": "ed25519",
  "checkpointPublicKey": "MCowBQYDK2VwAyEAdMwrEJCHY0wAjens4KCptBfb8GzLCcAV5Pd+OpbC6kw=",
  "checkpointIntervalEntries": 3,
  "checkpointIntervalSeconds": 300
}
```

With 9 entries, `GET /audit/verify?fromSeq=0&toSeq=1000000` lists checkpoints at `1, 4, 7`.

**Non-conforming.**
- `"auth": { "auditLogIntegrity": { … } }` on the v2 root (closed; no such facet).
- A record without `checkpointPublicKey`, or with a PEM or raw-32-byte key.
- The same host listing checkpoints at `1, 7` (a gap of 6 over an advertised 3).
- Advertising the family and answering `404` on `/audit/verify`.

## Compatibility

`additive`:

- **v2.** A new optional family on the closed root (`scripts/check-v2-surface-monotone.mjs`: new object, 19 additions, 0 removals). No v2 host advertised it, so none moves. The `verifyAuditLog` operation, its parameters and its body schema are unchanged. Only its description text changes.
- **v1.** No wire change. `audit-log-integrity.test.ts` gains a cadence leg at both majors. It holds a host to the MUST the earlier major already states ("at intervals declared by the host … MUST emit a signed checkpoint"), and it runs only when `checkpointIntervalEntries` is advertised. Measured 2026-09-28: the SQLite reference host at major 1 is executed-pass on it. The Postgres host shares the construction and was not run. openwop-app opts out of the profile, and MyndHyve does not advertise it.

## Conformance

- **`audit-log-integrity.test.ts`** (now both majors). The gate and paths resolve the major through `src/lib/auditIntegrity.ts` (`/v1/audit/verify` vs `/audit/verify`). At major 2 an absent family records `inapplicable` before any assertion. Major 1 keeps its `behaviorGate`. Legs:
  - shape: at major 2, the record validates against the generated family schema, and the key parses as Ed25519 SPKI;
  - verify: the body validates against the v2 schema, with `chainValid: true` and no anomalies;
  - cadence (`openwop.requirement.0224.checkpoint-cadence`, new): ascending, with no gap over `checkpointIntervalEntries`. It is `inapplicable` when no checkpoint exists yet.
- **`audit-checkpoint-signature.test.ts`** (now both majors) carries RFC 0218's row unchanged, gated the same way.
- Both files are in `BOTH_MAJORS` (`conformance/scripts/generate-scenario-majors.mjs`). Neither reads a `.supported` seat.

**Witness (loopback, 2026-09-28).** v2 reference host (openwop-examples #111) on `127.0.0.1:3997`, `OPENWOP_SPEC_ARTIFACTS_DIR` = this branch's `spec-artifacts/`, `checkpointIntervalEntries: 3`, 8 seeded run creations, `OPENWOP_TARGET_MAJOR=2`, `OPENWOP_REQUIRE_BEHAVIOR=true`:

| Run | `0218.checkpoint-signature-over-root` | `0224.checkpoint-cadence` | shape, verify |
| --- | --- | --- | --- |
| clean | executed-pass | executed-pass | executed-pass |
| sabotage: the host signs (and self-verifies) the checkpoint object's JCS | **executed-fail** | executed-pass | executed-pass |
| sabotage: the verify body drops the second checkpoint | executed-pass | **executed-fail** | executed-pass |
| family absent (installed contract 2.42.2) | inapplicable | inapplicable | inapplicable |

Each sabotage reddens exactly its own row. The loopback witness is enough for `Active`. It is not a certified bundle.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A the record carries the four facets, key an Ed25519 SPKI | the v2 discovery record | the suite, gated on the family | witnessable — gated on the family |
| §A.2 an advertising host serves `GET /audit/verify` with the v2 body and `chainValid: true` | the verify response | the suite, gated on the family | witnessable — gated on the family |
| §A.3 every in-range checkpoint listed, ascending, no gap over `checkpointIntervalEntries` (`openwop.requirement.0224.checkpoint-cadence`) | `checkpoints[].atSequence` against the advertised facet | the suite, gated on the family and a first checkpoint | witnessable — gated on the family |
| §A.4 each signature over the root bytes under `checkpointPublicKey` (`openwop.requirement.0218.checkpoint-signature-over-root`, now at major 2) | each served checkpoint verifies | the suite, gated on the family | witnessable — gated on the family |
| §A.4 the chain and root are over the entries (RFC 0218 §A.1–3) | — the entries are not on the wire | nobody from outside | unwitnessable — the entries are not on the wire, so only the host-internal tamper tests and an out-of-band verifier with entry access can recompute a root |
| §A.3 `checkpointIntervalSeconds` is honoured | — checkpoints carry no timestamp on the wire | nobody from outside | unwitnessable — the verify body carries no `ts`, so the time bound is held only by the host-internal test |
| §A.5 the audit key is used for no other surface | — | nobody from outside | unwitnessable — key reuse across surfaces is a claim only an operator audit can check |

## Alternatives considered

1. **A facet under `auth`** (`auth.auditLogIntegrity`), mirroring the earlier major's placement. Rejected: an audit log is not an authentication lane, `auth`'s facets are hand-decided (`lanes`, `subjectLinkKey`), and presence of an `auth` sub-object would not gate an operation the way a family record does under capabilities.md §2.
2. **An extension family** (`spec/v2/ext/`). Rejected: the operation is already core (`verifyAuditLog` is in the core path manifest and OpenAPI), and an ext family is not advertised at the root.
3. **Keep `hashChain: true` as a facet.** Rejected: a record's presence already claims the chain, and a boolean that can only be `true` is a second way to say one thing.
4. **Leave the cadence unwitnessed.** Rejected: without it, a host that drops a checkpoint from the verify body is indistinguishable from one that never minted it, and the drop sabotage passed every other leg.

## Unresolved questions

1. **Rotation.** A dual-signing host lists two checkpoints at one `atSequence`, one of them under a key that is not `checkpointPublicKey`. The signature row then fails it. Whether v2 should advertise more than one key (a `checkpointPublicKeys[]` facet, additive) is left to a follow-up. No host dual-signs today.

## Implementation notes (non-normative)

- v2 reference host: `src/audit.ts` (openwop-examples #111). It is the SQLite/Postgres construction unchanged, advertised only when the installed contract defines the family. Every authenticated write is appended.
- The SQLite and Postgres hosts are major-1 only and are unaffected.

## Acceptance criteria

- [x] `Active`: the family row, facets schema, `security-defaults.md` section, invariant, both scenarios at both majors (suite 2.43.0), and a loopback witness with both sabotages proved.
- [ ] `openwop.requirement.0224.checkpoint-cadence` and `openwop.requirement.0218.checkpoint-signature-over-root` `executed-pass` on a **certified public v2 bundle** from a host advertising the family (the v2 reference host at a published 2.43.x contract). That is also what makes RFC 0218's open acceptance box reachable. A public cut is an operator decision (`scripts/cut-public.sh`) and is not part of this RFC's filing.
- [ ] Invariant `audit-checkpoint-signed-over-root` graduates to protocol-tier on that bundle.

## References

- `spec/v1/auth-profiles.md` §"Audit-log integrity" (the earlier major's profile, as corrected by RFC 0218).
- RFC 0218 §A–§C (the checkpoint preimage, the export, the anomaly shape); RFC 0169 / RFC 0175 (the closed v2 root; `auth.lanes[]` replaced `auth.profiles`); RFC 0190 (the kernel budget); RFC 0147 §A (the optional-capability freeze, spent 2026-08-20).
- RFC 8785 (JCS); RFC 8032 (Ed25519); RFC 5280 §4.1.2.7 (SubjectPublicKeyInfo).
