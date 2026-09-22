# RFC 0195: a certification bundle's declarations are signed, and an unobserved requirement is `blocked`

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0195                                                            |
| **Title**         | a certification bundle's declarations are signed, and an unobserved requirement is `blocked` |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-21                                                      |
| **Updated**       | 2026-09-21 (filed `Draft` **after** its text and suite implementation were merged — see §Motivation "How this RFC came late"; **the public comment window runs in full, to 2026-09-28** — RFC 0147 §A.6: this RFC affects certification, so bootstrap waiver language MUST NOT shorten its window; suite 2.35.0, which implements it, is not published before the window closes) · 2026-09-21 (later) — `Draft → Active`; **comment window waived** by the steward on 2026-09-21 — an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects certification). |
| **Affects**       | `spec/v2/core/conformance.md` §Bundle v3; `conformance/src/lib/{certification-bundle-v3,scenario-disposition}.ts`; `v2-relaxation-recorded` |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                               |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Three gaps in how a v3 certification bundle certifies, each found while verifying real host bundles on 2026-09-21. **(1)** A test that asserted setup facts and then could not observe its requirement recorded an `executed-pass` marked `partial-witness:` — refused by the acceptance predicate, but counted by certification, so a profile could certify on a requirement nobody observed. **(2)** `host.relaxations[]` sits outside the attestation, so a relaxation deleted after signing let the verifier re-derive the relaxed profile as certified on a bundle that still verified. **(3)** An operator's opt-outs were checked against the host's advertisement only while the suite ran; nothing let a reader check them afterwards. This RFC states the three rules; suite 2.35.0 implements them.

## Motivation

**(1)** `resolveItRecord` recorded a `blocked` note written after any assertion as `executed-pass` + `partial-witness:`. `check-accepted-predicate.mjs` refuses such rows as witnesses; `verifyBundleV3` counts them. Found while fixing a false conviction in `v2-webhook-durable-delivery` (suite 2.34.1): the first draft of that fix turned the false FAIL into a certifying pass that never read the sink, and only the per-row ledger showed it. Swept before changing the rule: 24 major-2 sites hit the pattern and every one is "requirement unobserved" (unreachable, a control that did not answer, a window that closed) — none is an optional extra.

**(2)** The attestation covers exactly `{ witnessSha256, host.build, suite.version, discovery.sha256 }` and `witnessSha256` digested the rows alone. `security-defaults.md` §Relaxations makes a declared relaxation deny certification of the profile it belongs to — and the declaration was the one member an editor could remove without breaking the signature.

**(3)** The steward checked two hosts' opt-out lists against their live discovery documents by hand on one day; one host found its own list had been derived from a lane that advertises eight profiles its production does not. The rows the suite writes for an opt-out are signed, and so is the captured discovery document — the check needs no new member.

**How this RFC came late.** The three rules were merged into `conformance.md` §Bundle v3 with the suite change (openwop#1462) under a waiver-style process, before anyone applied RFC 0147 §A.6 to them. They affect certification, which §A.6 names; its window cannot be waived. This RFC is filed so the window runs in full, the merged sentences are marked as proposed until it closes, and the suite version that enforces them is not published before then.

## Proposal

1. **At major 2, an unobserved requirement records `blocked`** even when the test asserted setup facts first. An `executed-pass` carrying a `partial-witness:` detail is reserved for a leg that observed its requirement and skipped an optional extra. Major 1 keeps its convention.
2. **`witnessSha256` covers `host.relaxations[]` whenever it is non-empty:** the digest preimage is `canonicalJSON({ rows, relaxations })` then, and the rows alone otherwise. A verifier recomputing the digest detects a relaxation removed after signing.
3. **A verifier MUST derive the operator's opt-outs from the signed `skipped` rows** and MUST reject a bundle whose captured discovery document advertises one of them (`opted-out-but-advertised`).

## Compatibility

**Additive.** No bundle-schema change; `bundleVersion` stays `"3"`. Every committed bundle digests and verifies unchanged (none declares a relaxation, and the digest of a bundle without one is unchanged — pinned by a test against the three committed bundles). A verifier older than 2.35.0 fails closed (`witness-digest`) on a new bundle that declares relaxations; it never passes one. Rule 1 can remove a certification a host held on an unobserved requirement; measured on the committed bundles, the next cut changes 0 rows on the reference host and MyndHyve and 1 on openwop-app, none of whose bundles certifies today.

## Conformance

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §1 an unobserved requirement is `blocked` | the bundle row's `result` for a requirement whose observation did not happen | the suite, by construction of the row | claims-check — a property of the suite's recording, verified by its self-tests, not of a host |
| §2 relaxations are inside the digest | a bundle with a declared relaxation, stripped after signing, is rejected `witness-digest` | the suite, unaided (`v2-relaxation-recorded.test.ts` strips a signed relaxation) | witnessable — unaided |
| §3 opt-outs are checked against the captured document | a bundle recording an opt-out its captured discovery document advertises is rejected `opted-out-but-advertised` | the verifier, on any bundle | claims-check — the verifier's rule, pinned by its self-tests |

## Alternatives considered

- **A root-level `host.optedOut[]`.** Readable, but outside the attestation — the gap §2 closes for relaxations.
- **Extending the attestation's `over` list.** `conformance.md` requires exactly four members; changing it breaks every existing verifier on every bundle, not only on new ones.
- **Apply rule 1 at both majors.** The 146 major-1 sites were not measured and v1 bundles are read through v1's end of support.
- **Do nothing.** Leaves a certifying pass that rests on an unobserved requirement, and an unsigned declaration that decides certification.

## Unresolved questions

1. Whether a later revision should extend rule 1 to major 1 after measuring its 146 sites.

## Implementation notes (non-normative)

Merged in openwop#1462 (`2dae8415`), suite 2.35.0 — not published. Rule 1: `resolveItRecord(…, blockedStands)` with `blockedStands = targetMajor() === 2`. Rule 2: `witnessDigest(rows, relaxations)`. Rule 3: `optedOutFromRows()` and the `opted-out-but-advertised` rejection; `--verify` prints the set.

## Acceptance criteria

- [x] `Active` — 2026-09-21, by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [ ] `conformance.md` §Bundle v3 drops its "proposed" marker.
- [ ] Suite 2.35.0 published.
- [ ] A committed host bundle cut on 2.35.0 or later verifies under the new rules.

## References

- openwop#1462; RFC 0148 (certification bundles); RFC 0147 §A.6; `spec/v2/core/security-defaults.md` §Relaxations.
