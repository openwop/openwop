# RFC 0173: v2 security defaults — an obligation of the surface, never a discovery flag

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0173                                                            |
| **Title**         | v2 security defaults: every security-load-bearing behavior that v1 binds only when a host sets a flag becomes an obligation of the surface that needs it — the fourteen auth-family flags, replay side-effect suppression, webhook delivery durability, approver enforcement, the leaver contract, sandbox isolation, and compensation authority; a relaxation is an operator setting with a declared durability class recorded in the evidence bundle, never a discovery field; replay suppression is witnessed by a host-declared, machine-checkable effect-seam manifest; compensation and Layer-2 effect identity each take one of three dispositions (core obligation with a declared witness, extension, or removal) — never an unimplemented MUST; the interop threat model is written (C.8) and the replay threat model gets the sections its siblings carry |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167 — authorization, isolation, replay, and external effects are this child's whole surface. Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C6.** v2 (Phase 3): `spec/v2/core/security-defaults.md` (NEW; the obligation table), `spec/v2/core/replay.md` §Effect seams, `schemas/v2/effect-seam-manifest.json` (NEW), `schemas/v2/capabilities.schema.json` (the fourteen `auth.*` gate fields, `replay.sideEffectSuppression`, `webhooks.durable`, `interrupt.approverRouting.enforced`, `sandbox.supported` removed as gates; `sandbox.isolationModel` and `auth.lanes[]` kept as facets), `SECURITY/threat-model-replay.md` §6–§8, `SECURITY/invariants.yaml` (effect-seam invariants with tests); `spec/v1/extensions.json` (`openwop-compensation-v1` note corrected — this PR, data). v1.x (this PR, data only): `spec/v1/migrations.json` rows `openwop.migration.C6.1`–`C6.9`; deprecation rows `security-opt-in-flags`, `supported-durable-flag` (`proposed`); register rows |
| **Compatibility** | `breaking` (v2). Nothing in v1.x wire shape changes in this PR; one `extensions.json` note is corrected to what INTEROP-MATRIX already records |
| **Supersedes**    | — (RFC 0035, 0069, 0083, 0104, 0119, 0140, 0150, 0151, 0157, 0164 remain the v1 authorities) |
| **Superseded by** | —                                                               |

## Summary

v1 protects a tenant when the host volunteers a boolean. Fourteen auth-family advertisements gate MUSTs; `replay.sideEffectSuppression`, `webhooks.durable`, and `interrupt.approverRouting` gate the three behaviors most likely to duplicate an external effect, drop a delivery, or let the wrong person approve; `capabilities.sandbox` requires eight invariants that no host provides; `compensation.supported` has one steward advertiser and an extension registry note that says none; Layer-2 effect identity has zero implementations and a recipe that produces duplicate refunds when followed. RFC 0164 already made the leaver contract mandatory and named the pattern: "opt-in security is the pattern the corpus keeps regretting." v2 applies that ruling to the whole corpus: a security behavior binds when its surface is advertised; a relaxation is an operator setting with a durability class in the bundle; every obligation names its witness or is demoted.

## Motivation

- **Fourteen flags.** `capabilities.schema.json:3688–3903`: `auth.rotation`, `rotation.minGraceSeconds`, `oauth2.supported`, `oauth2.supportedAlgorithms`, `oidc.supported`, `oidc.introspectionIntervalSeconds`, `mtls.supported`, `mtls.required`, the `saml`/`scim`/`ldap` profile strings, `subjectLinking`/`subjectLinkKey`, `workloadIdentity.senderConstraint[]`, `workloadIdentity.delegation` — each gates a MUST (`auth-profiles.md:25–146`, `auth.md:210–227`); advertisers: two annex-profile claims on the SQLite host with no floor scenario, MyndHyve's SAML, and nothing else (`auth.md:240`: "No host advertises the profile").
- **Replay.** `replay.md:376` binds five MUSTs only under `sideEffectSuppression: "recorded-outcome"`; `:374` says the unconditional caveat still holds, and `:342` records that the original text "was false." RFC 0140 G4 names three unguarded paths in the reference host, G6 leaves `branch` unwitnessed, G7 says the seam set "is not enumerable in the spec," R3 measured 3 guarded call sites against ~25. openwop-app advertises `none` with a reason (`INTEROP-MATRIX.md:48`).
- **Webhooks and approvers.** `webhooks.md:256–258`: durability "strictly additive," best-effort default unchanged; RFC 0083's register is a G0 stub. `interrupt.md:182–189`: `approversList` "advertise[s] constraint, [does] not enforce it"; RFC 0104's register is a G0 stub; the RFC header names two advertisers and INTEROP-MATRIX has no row.
- **Sandbox.** RFC 0035 §20: "the protocol formally requires sandbox semantics that no implementation actually provides"; `:130`: `node:vm` "is escapable by design"; `threat-model-node-packs.md:158`: hard isolation is "advisory recommendations, not v1 requirements"; seven of eight invariants are protocol-tier with zero advertisers; RFC 0119's mechanism-neutral property (`:56`) is the shape that works.
- **Compensation.** `extensions.json:169` says no host advertises; `INTEROP-MATRIX.md:337` records openwop-app's deployed advert; R2 is "Open — unwitnessed"; G9 says §C/§E/§F "can never be deployed-wire evidence" without a normative read surface.
- **Layer 2.** `docs/EFFECT-IDENTITY-V1-INVENTORY.md:44`: the one real implementation "diverged from the spec at precisely the point the spec is wrong, and it had to"; `:29`: no host persists a v1 recipe key; RFC 0150 G2–G5 carried; G8–G10 have no black-box witness.
- **Threat models.** `SECURITY/threat-model-interop.md` does not exist; A2A G8 and MCP G8 cite it. `threat-model-replay.md` has five sections; its seven siblings have §6 Residual risks, §7 Verification, §8 References.
- **The root cause, named.** Compensation G9, replay G2, A2A/MCP R1 all resolve to "observable only through a `host-sample-test-seams.md` seam a production host does not mount." RFC 0166's `seam-gated` class names it; this RFC and C.8 are where each such obligation is either given a normative observation path or demoted.

## Proposal

### §A. The rule

**§A.1** In v2 a security-load-bearing behavior is an **obligation of the surface** that needs it: advertising the surface binds the behavior. No discovery field gates it. The table in `spec/v2/core/security-defaults.md` lists each obligation, the surface that binds it, the invariant, and the witness class; a row with `witness: unwitnessable` may not be in `core/`.

**§A.2** A relaxation, where one is legitimate (a development deployment, a single-tenant appliance), is an **operator setting** — never a discovery field — and every relaxation a host runs under is recorded in its certification bundle (C.1 bundle v3 `host.relaxations[]`) with a **durability class** from a closed set: `session` (lost on restart), `deployment` (set at deploy time), `persisted` (survives restarts and is auditable). A bundle that records a relaxation cannot certify the profile the relaxed obligation belongs to. A host MUST NOT advertise a surface whose obligation it has relaxed. RFC 0158's ladder is the model: evidence lives in the bundle, and a field that let a host assert a property with nothing behind it is the failure the ladder exists to prevent.

### §B. The obligations

| Surface advertised | Obligation (v1 flag it replaces) | Witness |
| --- | --- | --- |
| any auth lane (`auth.lanes[]`, C.3) | the C.3 §B pipeline, revocation, and minimum assurance for that lane (replaces all fourteen `auth.*` gates; `mtls.required` becomes the lane's `minimumAssurance: key-bound`) | unaided / seam-gated per lane (RFC 0170 table) |
| both `saml` and `scim` lanes | the leaver contract (RFC 0164, already mandatory; `subjectLinking` deleted by C.2/C.3) | seam-gated (RFC 0163 seams) |
| `replay` (any mode) | side-effect suppression on replay (`recorded-outcome` semantics) as the only conforming behavior; `none` is not a value | witnessable-gated via the effect-seam manifest (§C) |
| `webhooks` | durable delivery: retries per the advertised policy and dead-letter on exhaustion (`webhooks.durable` deleted; best-effort is not a conforming delivery mode) | witnessable-gated (`webhook-signed-delivery` + dead-letter leg) |
| `interrupt` with `approversList` or `refKinds` | enforcement: a resolver not in the list / group / role is refused (`approverRouting` as a gate deleted; `refKinds[]` stays a facet) | witnessable-gated |
| `packs` (pack execution) | isolation binds: RFC 0119's mechanism-neutral property for pack code — the eight `node-pack-sandbox-*` invariants — with `sandbox.isolationModel` naming the mechanism, never relaxing the property; a host that cannot isolate MUST NOT execute third-party packs (it may still register and validate them) | witnessable-gated (the eight `sandbox-*` scenarios; `no-eval` stays reference-impl) |
| `compensation` | the §C/§E/§F obligations with a normative read projection `GET /v1/runs/{runId}/compensation` (plan, attempts, `inverseActions[]`) and the G7 operator action family as canonical wire — the trichotomy resolves to **core obligation with a declared witness** | witnessable-gated (reads) + seam-gated (operator actions) |
| `idempotency` | Layer 2 effect identity as a **core obligation keyed on business identity** (RFC 0150 §B's principle, the one real implementation): a logical effect id assigned once per effect and stable across transport retries, injected as the provider's idempotency key; the v1 activity recipe becomes the documented fallback for providers with no business key; RFC 0147 UQ2 answered: no deployed history holds a v1 recipe key, so no dual-read migration is needed | witnessable-gated (provider-side seam becomes a normative `GET /v1/runs/{runId}/effects` read) |

### §C. The effect-seam manifest

**§C.1** A v2 host that advertises `replay` MUST publish `schemas/v2/effect-seam-manifest.json`-shaped data at `GET /host/effect-seams` (canonical, not a test seam; **erratum 2026-09-05** — this sentence read `/v1/host/effect-seams` at acceptance, contradicting the ten other statements of the path in `core/replay.md`, the schema description, `facets/replay.schema.json`'s `const` and `path-manifest.json`; the unversioned spelling is normative, and on a dual-stack host the v1 prefix is at best an alias): every outbound effect path the host's node runtime can reach, `{ seam, kind, guarded: true, guardedBy }`, where `kind` names the outbound wire mechanism — `http | smtp | queue | storage | provider-sdk | webhook-fanout | other`, with `note` REQUIRED on `other` (**erratum 2026-09-05** — `smtp` and `other` were added in suite 2.0.0-rc.61; the enum as accepted could not express a direct SMTP connection, so a host with one had to choose between mislabelling a seam and omitting it, and `core/replay.md` §The effect-seam manifest is the full rule). RFC 0140 G7 ("not enumerable in the spec") is answered by making the host enumerate it: the spec requires the manifest, the host owns the list. Completeness outranks driveability: a path the suite cannot drive (an `smtp` or `other` seam, the suite's receiver speaking HTTP) is still MUST-list and is recorded `inapplicable`, never omitted. The `replay-side-effect-suppression` scenario asserts every manifest row is `guarded: true` and drives one seam of each `kind` it can reach through the suite's receiver to observe no re-fire; RFC 0140 G4's three unguarded reference-host paths become manifest rows that fail until guarded; G6's `branch` asymmetry is stated in the manifest (`branchReFires: true`) and witnessed as a permission.

### §D. Three dispositions, no unimplemented MUST

**§D.1** Every security obligation in `core/` is one of: (a) **core obligation with a declared witness** (the §B table), (b) **extension** in `spec/v2/ext/` with a declared witness class and maturity, or (c) **removed**. Sandbox `no-eval` (reference-impl, unwitnessable cross-runtime) stays reference-impl in `ext/sandbox-runtime-notes`; the `vm`-module residual (`threat-model-node-packs.md:158`) is disposed by the same row: `node:vm` is not an `isolationModel` value in v2. RFC 0035 (Parked) is resolved: its §B probes become the `packs` obligation and the RFC flips `Superseded` by this child at the cut (RFC 0174 §A.1), its tripwire (a non-steward fencing host) becoming the `adoption: independent` axis, not a status gate.

**§D.2** RFC 0150's four sub-decisions: G2 endpoint-id alias rules → the C.2 declaration file's operation ids are canonical and aliases are register rows; G3 provider semantic-option registry → `spec/v2/ext/provider-idempotency/registry.json` with a witness per provider; G4 qualification test → a fixture provider in the suite that rejects a changed key; G5 retention → Layer 2 ≥ 14d (RFC 0170 §D.3). RFC 0151 G3 (operator substitution) stands as decided; G4/G8 (irreversible-effect vocabulary) is closed — the two registers are reconciled in this PR.

### §E. Threat models

**§E.1** `SECURITY/threat-model-interop.md` is written by C.8 (RFC 0175 owns A2A/MCP); this RFC requires its existence before RFC 0175 flips Accepted. **§E.2** `threat-model-replay.md` gains §6 Residual risks (branch re-fires; seams outside the manifest; the effect-seam manifest as a self-declaration), §7 Verification (the manifest scenario, fork-a-v1-run), §8 References — a template gate (`check-threat-model-template.mjs`, Phase 3) fails a threat model missing a sibling section.

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C6.1` | behavior | fourteen `auth.*` gate flags | obligations of the lane; `auth.lanes[]` facets (C.3) | — | not-persisted |
| `openwop.migration.C6.2` | behavior | `replay.sideEffectSuppression: none \| recorded-outcome` | suppression is the only replay behavior; the effect-seam manifest is the witness | — | not-persisted |
| `openwop.migration.C6.3` | behavior | `webhooks.durable` opt-in; best-effort default | durable delivery binds with `webhooks` | — | not-persisted (undelivered v1 best-effort deliveries are gone; nothing to translate) |
| `openwop.migration.C6.4` | behavior | `interrupt.approverRouting` gate; `approversList` advisory | enforcement binds with the fields | — | not-persisted |
| `openwop.migration.C6.5` | behavior | `sandbox.supported` gate; eight invariants nobody provides | isolation binds with pack execution; `isolationModel` names the mechanism; `node:vm` not a value | — | not-persisted |
| `openwop.migration.C6.6` | behavior | `compensation.supported` opt-in with seam-only evidence | core obligation with `GET /v1/runs/{runId}/compensation` and the operator family as wire | — | unchanged (plans and attempts persisted under v1 keep their shape; the read projection is new) |
| `openwop.migration.C6.7` | behavior | Layer 2 effect identity: unimplemented activity recipe | business-identity keying as the core obligation; activity recipe as fallback; `GET /v1/runs/{runId}/effects` | — | not-persisted (no host persists a v1 recipe key — `docs/EFFECT-IDENTITY-V1-INVENTORY.md:29`) |
| `openwop.migration.C6.8` | add | none | operator relaxations with a durability class in bundle v3 `host.relaxations[]` | — | not-persisted |
| `openwop.migration.C6.9` | add | five-section replay threat model; no interop threat model | sibling sections; `threat-model-interop.md` (C.8) | — | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Compensation plans/attempts (openwop-app) | host-shaped rows | unchanged; the v2 read projection serves them |
| Webhook delivery queue (openwop-app durable; MyndHyve best-effort) | in-flight deliveries | drained (best-effort deliveries either land or are dropped before the cut; the v2 queue starts durable) |
| Invocation log / idempotency store | Layer 1 entries; no Layer 2 keys | unchanged / not-persisted |
| Sandbox | none persisted | — |

## Compatibility

`breaking` (v2). This PR changes no v1.x wire shape; it corrects one `extensions.json` note to the advertiser status INTEROP-MATRIX already records and reconciles two register rows that disagreed.

## Conformance

v2 scenarios (suite 2.0.0): `security-defaults-table` (corpus: every `core/` obligation has a surface, an invariant, and a witness class ≠ unwitnessable), `relaxation-recorded` (unaided: a bundle with `host.relaxations[]` cannot certify the relaxed profile), `effect-seam-manifest` (gated on `replay`: every row guarded; one seam per kind driven; no re-fire), `webhook-durable-delivery` (gated on `webhooks`: retry then dead-letter), `approver-enforced` (gated: a non-listed resolver refused), `pack-isolation` (gated on `packs`: the eight legs), `compensation-read-projection` (gated), `effect-identity-business-key` (gated on `idempotency`: the same provider key across two transport retries), `threat-model-template` (corpus).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 no discovery field gates an obligation | v2 capability schema has no gate fields | the corpus gate | witnessable — unaided (corpus) |
| §A.2 relaxations recorded; relaxed profile not certifiable | bundle v3 verifier — `openwop.requirement.0173.relaxation-recorded` | the suite, unaided (fixture bundle) | witnessable — unaided |
| §B replay suppression | no re-fire through a manifest seam — `openwop.requirement.0173.effect-seam-manifest` | the suite, gated on `replay` | witnessable — gated |
| §B webhook durability | retry + dead-letter — `openwop.requirement.0173.webhook-durable-delivery` | the suite, gated on `webhooks` | witnessable — gated |
| §B approver enforcement | refusal — `openwop.requirement.0173.approver-enforced` | the suite, gated | witnessable — gated |
| §B pack isolation | the eight sandbox legs — `openwop.requirement.0173.pack-isolation` | the suite, gated on `packs` | witnessable — gated |
| §B compensation read projection | `GET …/compensation` — `openwop.requirement.0173.compensation-read-projection` | the suite, gated | witnessable — gated |
| §B effect identity | provider key stable across retries — `openwop.requirement.0173.effect-identity-business-key` | the suite's fixture provider, gated | witnessable — gated |
| §C.1 manifest complete | a seam outside the manifest that re-fires | negative-existence: the suite cannot enumerate a host's seams; the manifest is a self-declaration whose false negatives are found by the RFC 0140 R5 class of audit | negative-existence |
| §E.2 threat-model template | corpus gate | the corpus gate | witnessable — unaided (corpus) |

## Adversarial review

1. **Making suppression the only replay behavior removes `none`, which openwop-app advertises today with a reason.** Disposition: yes — in v2 a host that cannot suppress does not advertise `replay`; the reason openwop-app gave (3 of ~25 paths guarded) is exactly the manifest's job to make visible and close.
2. **The effect-seam manifest is a self-declaration; a host can omit a seam.** Disposition: stated as `negative-existence` in the table, not hidden; the R5 audit class (grep the host for outbound clients vs the manifest) is the check, recorded as such; a manifest is still strictly better than "not enumerable in the spec."
3. **Durable webhooks force a queue on every host.** Disposition: yes; best-effort delivery of a signed event is not a delivery contract, and MyndHyve already runs durable delivery (`durableDelivery.conformance.test.ts`).
4. **Isolation binding with `packs` strands a host that registers packs but runs none.** Disposition: §B binds isolation to *execution*; registration and validation stay available without it.
5. **Compensation and Layer 2 as core obligations bind every host to surfaces one host implements.** Disposition: both are obligations **of the surface** (`compensation`, `idempotency`); a host that does not advertise the surface has no obligation; what changes is that advertising it can no longer be seam-only evidence.
6. **RFC 0151 G4 and `compensation.md` G8 disagree on whether the irreversible-effect vocabulary closed.** Disposition: the doc register records the closure (2026-08-16, `irreversibleEffect` boolean); the RFC register is corrected in this PR.
7. **RFC 0035 cannot be `Superseded` while Parked on a tripwire.** Disposition: the tripwire was a status gate for a MUST nobody provided; under v2 the property binds with execution and independence is the adoption axis; the flip happens at the cut under RFC 0174 §A.1 with a forward pointer; until then RFC 0035 stays Parked and this row is G1.

## Alternatives considered

1. Keep the flags and require them to be `true` for certification. Rejected: a flag that must be true is not a flag; it is an obligation with an extra way to lie.
2. Make suppression a profile. Rejected: RFC 0164 §22 — a profile is a boolean one layer up.
3. Move compensation and Layer 2 to `ext/` as unwitnessable. Rejected for compensation (one deployed advertiser and a read projection is cheap) and for Layer 2 (a real implementation exists and the recipe defect is a correctness bug); either may still end in `ext/` at the cut if the witness does not land, and §D.1 says so.
4. Do nothing. Rejected: RFC 0164 §22 is the corpus's own ruling.

## Unresolved questions

1. Whether `approversList` enforcement needs an RBAC surface on hosts that have none (the `refKinds: group | role` case). Recommended: `approversList` (explicit principals) binds everywhere; `group`/`role` bind only where `authorization` is advertised.

## Implementation notes (non-normative)

openwop-app: the effect-seam manifest is ADR 0533's guard inventory made data; compensation read projection is the RFC 0151 G9 endpoint; durable webhooks already exist. MyndHyve: replay suppression already `recorded-outcome`; durable delivery exists; approver enforcement needs the resolver check; compensation is not advertised (no obligation).

## Acceptance criteria

- [x] `Draft → Active`: RFC text; rows `C6.1`–`C6.9`; two register rows; `extensions.json` note corrected; RFC 0151 G4 reconciled; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `spec/v2/core/security-defaults.md` + the obligation table; `effect-seam-manifest.json` schema and `GET /host/effect-seams`; the gate fields removed from `schemas/v2/capabilities.schema.json`; bundle v3 `host.relaxations[]`; `threat-model-replay.md` §6–§8; `check-threat-model-template.mjs`; the nine scenarios in suite 2.0.0; openwop-app passes `effect-seam-manifest`, `webhook-durable-delivery`, `compensation-read-projection`.

## References

- RFC 0167 §A (Axiom 5), §C, §G.2; RFC 0164 §22 (the ruling), §A; RFC 0140 G2/G4/G6/G7, R3/R5; RFC 0083; RFC 0104; RFC 0035 §B/§20/§130; RFC 0069; RFC 0119 §56; RFC 0150 G2–G5, G8–G10, §B; RFC 0147 UQ2; RFC 0151 G3/G4/G5/G9, R2; RFC 0157; RFC 0158 §E; RFC 0166 §C.1.
- `spec/v1/capabilities.md` §"What a capability may vary"; `auth.md:210–240`; `auth-profiles.md`; `replay.md:342–376`; `webhooks.md:256–258`; `interrupt.md:182–189`; `compensation.md` G5–G9; `docs/EFFECT-IDENTITY-V1-INVENTORY.md`; `SECURITY/threat-model-node-packs.md:158`; `SECURITY/threat-model-replay.md`; `spec/v1/extensions.json` (`openwop-compensation-v1`, `openwop-sandbox`, `openwop-effect-identity-v2`); `INTEROP-MATRIX.md:48, 337, 356, 362`.
