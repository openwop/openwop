# RFC 0197: v2 surfaces are retired, never reshaped

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0197                                                            |
| **Title**         | v2 surfaces are retired, never reshaped                         |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (filed `Draft`) · 2026-09-22 — `Draft → Active`; **comment window waived** by the steward on 2026-09-22 under GOVERNANCE.md §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194), which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects certification: it changes what a committed host bundle may carry and what a capability record's `status` may claim). This is also a `breaking`-class RFC, whose window is 30 days (`GOVERNANCE.md` §"Spec change process"), and it amends the decision rule (the `GOVERNANCE.md` breaking-change row), so **the two-approval requirement in GOVERNANCE §"Amendments" is waived** while one maintainer exists (RFC 0174 §B.3; approval-count waived, `check-waiver-authority.mjs` rule (c)). The RFC 0001 §5 cross-organization approval rule is not yet active. Acceptance under this override is provisional and the §B review is owed (RFC 0156 register). · **Updated 2026-09-22 — amended per implementation review** (`review/arch-impl.md` R5; Status unchanged: the registers, the `check-v2-surface-monotone` gate and `spec/v2/surface-baseline.json` land **last** in the 2.36.0 cycle, after RFC 0209's envelope restructure and RFC 0199's `CredentialData` binding, with the baseline generated on the finished tree; §A.1 states when a branch re-cut is a new surface rather than a reshape; the claims-check ids are minted into the corpus ledger by the gates' coherence twins) |
| **Affects**       | `spec/v2/core/overview.md` §0 (amended) + new §0a; `spec/v2/core/capabilities.md` §8 (technical-axis source); `spec/v2/core/versioning.md` §1.3/§1.5 (pointer); `COMPATIBILITY.md` (v2 scope, new §2.4, §3a, §7 v2 paragraph, §1 SDK row); `GOVERNANCE.md` §"Spec change process" breaking-change row (the decision rule — `GOVERNANCE.md` §"Amendments"); `RFCS/README.md`; `spec/v1/deprecations.schema.json` (`v2-minor` trigger, `retirement` block); new `spec/v2/migrations.json` + schema (v2→v2 rows); `spec/v2/declaration.schema.json` (`maturity.until`); new `spec/v2/surface-baseline.json`, `spec/v2/corrections.json`; `scripts/check-removal-dates.mjs`, `check-deprecations.mjs`, `check-migrations.mjs`, `generate-cross-repo-evidence.mjs`; new `scripts/check-v2-retirement.mjs`, `check-v2-surface-monotone.mjs`, `check-bundle-maturity.mjs`; certification (committed v2 host bundles); conformance (one new major-2 scenario) |
| **Compatibility** | `breaking` per `COMPATIBILITY.md` — a governance amendment with **no wire change**: §A relaxes the v2 reading of §2.2 ("removing … is a major") into a narrow, machine-checked exception, and §C tightens what a host's `status` may claim. Neither moves a schema. See §Compatibility. |
| **Supersedes**    | — (amends RFC 0171 §A.5's last clause as stated in `overview.md` §0, RFC 0169 §C.2's technical-axis source, and RFC 0178 §A.2's major-granular removal gate; RFC 0042 remains the v1 authority for experimental tiers) |
| **Superseded by** | —                                                               |

## Summary

v2 has no written rule for what a 2.x minor may do to an existing shape. The corpus has nonetheless ruled on it three times, and not always consistently. This RFC writes the rule down. **A v2 surface is never reshaped in place.** A new shape is added beside the old one. The old one may be **removed** in a later 2.x minor only when a gate script proves that nobody can be carrying it; otherwise it waits for 3.0. Readers keep accepting retired shapes on replay, fork and poll; only emission narrows. The RFC also codifies that adding an OPTIONAL property to a closed v2 object is additive, and makes the corpus declaration the upper bound on the maturity a host may advertise for a family.

## Motivation

**Minor versions carry no negotiation signal.** A minor in `OpenWOP-Version` is informational (`versioning.md` §1.3). What pins a minor is `minClientVersion` plus "the additive-change rules" (§1.5), and v2 never wrote those rules down: `COMPATIBILITY.md` is titled "Status: v1". A family record carries `since`/`until`, but those are the host's own timeline (`capabilities.md` §2), not a shape version. So if a 2.10 client meets a facet on a 2.40 host whose shape changed, it has no way to tell. That is the silent downgrade `versioning.md` forbids at the major level, happening at the facet level instead.

**The corpus has already ruled, three times, on what a 2.x minor may do:**

| # | Release | What happened | What it proves |
| --- | --- | --- | --- |
| P1 | **2.8.2** (`CHANGELOG.md` §[2.8.2]) | `workflowChainPacks.deferredParameters` and `.hostExpansionSeam` were removed from the closed v2 capabilities schema **in a patch**, on the ground that v2 defined no text for them. A committed bundle turned out to carry `deferredParameters`, and that bundle then failed `capabilities-root-closed` (`CHANGELOG.md`, the 2.32.x note on `spec/v2/facets/workflowChainPacks.schema.json`). | A 2.x removal has already broken a committed bundle, because **no gate scanned the bundles**. |
| P2 | **2.10** (RFC 0189 Phase 1) | `packs.testMode` and `observability.testSeams` were deprecated with **`removeIn: "3.0"`**. The register notes (`spec/v1/deprecations.json` rows `packs-test-mode-facet`, `observability-test-seams-facet`) say why: live v2 bundles carry them, "so removal breaks a published closed record … (COMPATIBILITY.md §2.2; §3's second clause fails because deprecation is available and adequate)". | This is the corpus's own ruling that §2.2 governs v2.x, and it names the discriminator: **evidence in a bundle**. |
| P3 | **2.32.0** (openwop#1367, `COMPATIBILITY.md` correction on record 2026-09-20) | The seeded v2 pack-manifest `signing` block was reshaped in a minor. The schema contradicted the prose, an `Accepted` RFC and a migration row, and 0 of 190 published documents validated against it. | A W3C-Class-3 correction can change a shape **when nothing conforming stops conforming**. |

Three further commitments point the same way. RFC 0184 §Unresolved says "Removing it needs a major". RFC 0193 says "whether major 3 closes it is deferred". `packs.md` says `testMode` is "removed at 3.0". No post-release RFC (0179–0196) changed an existing v2 shape: all are `additive` or `editorial + gate`.

**What is missing is the mechanism.** None of the following exists today:

- `check-removal-dates.mjs` compares majors only. A row with `removeIn: "2.40"` would be due at once, so no deprecation window inside the major is possible.
- The `removalTrigger` enum is `v2.0-cut | v1-end-of-support`.
- `spec/v1/migrations.schema.json` requires `v1`/`v2` keys and a `C1`–`C11` child, so a 2.N→2.M row cannot be written.
- No gate scans `evidence/v2-host-bundles/` or the registry before a v2 schema loses a member. That is the P1 hole.

**Maturity has two sources that disagree.** `capabilities.md` §8 says the technical axis comes from "the record's `status`", which is the host's claim. `spec/v2/declaration.json` is the corpus's claim, and it marks 82 of 87 families `experimental` and three `stable` (`supportedEnvelopes`, `schemaVersions`, `limits`). MyndHyve's committed bundle (`evidence/v2-host-bundles/myndhyve.json`, suite 2.35.1, cut 2026-09-22) advertises **38 families as `stable` that the declaration calls `experimental`**. They include `auth` (with an OIDC lane), `connections`, `oauth`, `packs`, `artifactTypes`, `authorization`, `envelopes` and `replay`. The other two committed bundles overstate none. A client reading `stable` from MyndHyve would reasonably believe the protocol has committed to that shape. The protocol has not.

**Why now.** The MCP/A2A remediation program wants at least one v2 removal inside the major: connection-pack `transport: "sse"`. MCP replaced the HTTP+SSE transport with Streamable HTTP (MCP 2025-11-25 §Transports, "This replaces the HTTP+SSE transport from protocol version 2024-11-05", https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). The 2026-07-28 revision lists only stdio and Streamable HTTP as standard bindings (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports). Without this RFC, the only honest path for that removal is 3.0. The remediation program's first draft of the rule would have made it far too easy ("an experimental family MAY change shape in a 2.x minor"). This RFC replaces that draft with the narrow form (`review/arch-P4.md` §0–§3).

## Proposal

### §A Retirement, never reshape

1. **No reshape in place.** A 2.x minor MUST NOT change the shape of an existing v2 surface. That covers retyping a field or property, changing an enum member's meaning, moving a field, renaming anything, closing an open object, and making an optional property REQUIRED. A new shape is a **new surface**, added beside the old one under the additive rules (§B). A re-cut that keeps the prior shape unchanged as one branch, such as a root split into an `anyOf` whose one branch is the prior object, selected by a member the prior shape already carried, is a new surface beside the old and not a reshape, provided every document valid before stays valid. A `$defs` name is not a surface, because no document carries it. The monotone gate enumerates surfaces through `$ref` and every `anyOf`/`oneOf`/`allOf` branch, so such a re-cut reports no removal; a re-cut that fails the proviso needs a `corrections.json` row (§A.4) or waits for 3.0.
2. **Retirement.** A 2.x minor MAY remove an existing v2 surface only when `scripts/check-v2-retirement.mjs` proves every one of the following. The letters are the predicate ids the gate reports.
   - **(R1) Replacement first.** The replacement shipped in an earlier 2.x minor, recorded as a `spec/v2/migrations.json` row whose `to.addedIn` is lower than the removal minor and whose `to` surface is present in the v2 tree.
   - **(R2) Announced removal minor.** A `spec/v1/deprecations.json` row with `removalTrigger: "v2-minor"` names the removal minor in `removeIn`. That row was committed at least **two released minors** and **30 days** before the removal. Both are read from the public history (`git log`), never from a date field inside the row. This is the anchoring rule `overview.md` §v1 end-of-support already uses.
   - **(R3) Unevidenced.** No committed `evidence/v2-host-bundles/*.json` `discovery.document` carries the surface, whatever `status` its record has. No published registry manifest carries it either, according to a registry census generated no more than 30 days before the removal (`evidence/cross-repo-manifests.json` `registryManifestCensus`). A census that is missing or `null` fails the predicate.
   - **(R4) Absence already defined.** The surface is one of four kinds whose absence the 2.0 contract already defines: an optional **family** (`capabilities.md` §2, "a host that does not support a family MUST omit it"), an optional **facet** or optional property, an **enum member** of a registry-backed or advertised enum (`overview.md` §0, consumers MUST accept unknown members), or an **envelope kind**. A REQUIRED property, an endpoint, an error code's meaning, and a header are never retirable in 2.x.
   - **(R5) Corpus maturity.** The row in `spec/v2/declaration.json` for the family that advertises the surface has `maturity.technical: "experimental"`. If that row carries `maturity.until`, the removal minor is later than it.
   - **(R6) No independent host.** No host of `independent` evidence tier (tier-3) is in the INTEROP-MATRIX v2 table (read from `evidence/v1-end-of-support.json` `hosts[].latest.evidenceTiers` and from the table's Evidence-tier column; either source naming one fails the predicate).

   If any predicate fails, the removal waits for 3.0. The gate says which predicate held it back, and the row's `removeIn` MUST then be rescheduled to `"3.0"` with `removalTrigger: "v1-end-of-support"` or none. This is the P2 disposition.
3. **Readers vs. emitters.** A retirement narrows **emission** only. A host and an SDK MUST keep accepting a retired shape, for the life of the major, wherever a persisted record is read: replay, `:fork`, polling an event log, and reading a stored conversation turn or artifact. For a retirement of the **persisted** class (an envelope kind, an event or payload enum member, a content shape), the v2 schema keeps the member, annotated `x-openwop-retired-in: "2.N"`, and only the producer obligation changes: a host MUST NOT emit it after `2.N`. For the **advertised** class (a family, a facet, an advertised enum value such as a manifest `transport`), the schema drops the member at `2.N`. A pinned 2.x client sees only "the host no longer offers X", which its contract already requires it to handle.
4. **Corrections are not retirements.** A W3C Process Class 3 correction (`COMPATIBILITY.md` §3 "Conformance-affecting correction on record", P3) MAY change a v2 shape outside §A.2 only when two things hold. First, nothing conforming stops conforming: the prior shape was contradicted by the prose, unsatisfiable, or defined no contract. Second, R3 holds for the prior shape. Each such change is a row in `spec/v2/corrections.json`, naming the schema pointers, the `COMPATIBILITY.md` entry and the census. P1 would have failed the second condition: a bundle carried the facet.

### §B Adding to a closed v2 object

5. Adding an **OPTIONAL** property to a v2 object that is `additionalProperties: false` is **additive** in 2.x. RFCs 0183 ("new OPTIONAL properties on a closed def"), 0186 and 0188 treated it that way, and so did P3. A consumer that validates server-emitted v2 documents against a closed schema is validating against **that schema version**. It SHOULD pin the schema version it validates with (the `versioning.md` §4 vendoring rule) rather than expect forward-open objects.
6. Adding a **REQUIRED** property to an existing object, closing an open object, or narrowing a type is a **major** (§A.1).

### §C The corpus declaration bounds a host's maturity claim

7. For a family's technical maturity, **the corpus declaration is the source of truth**. A host's record `status` is its claim, bounded above by the declaration: a host MUST NOT advertise `status: "stable"` for a family whose `spec/v2/declaration.json` row is not `technical: "stable"`. Advertising `experimental` or `deprecated` below a `stable` corpus row is permitted, because the host is understating its own offer.
8. `until` on a wire record remains the host's timeline (`capabilities.md` §2). The corpus's commitment is `declaration.json` `maturity.until`: "the corpus will not retire any surface of this family before 2.N". R5 reads it. No row sets it today.
9. A family's declaration row moves `experimental → stable` only by RFC. After that move, §A.2 no longer applies to the family, and removing any of its surfaces waits for 3.0.

### §D Core text (`spec/v2/core/overview.md`)

§0's last sentence becomes: "Adding a member is additive in v2.x; renaming one is a major, and removing one is a major except under §0a." The new §0a follows (≈146 words):

> **§0a Retiring a v2 surface (RFC 0197).** A 2.x minor MUST NOT change the shape of an existing v2 surface; a new shape is a new surface added beside the old one. A 2.x minor MAY remove a surface only when `scripts/check-v2-retirement.mjs` proves all of the following; otherwise the removal waits for 3.0. (1) Its replacement shipped in an earlier 2.x minor. (2) A `v2-minor` row in `spec/v1/deprecations.json` named the removal minor at least two minors and 30 days earlier. (3) No committed v2 host bundle and no published registry manifest carries it. (4) It is an optional family, facet, enum member or envelope kind, so its absence is already a 2.0 state. (5) Its family is `experimental` in `spec/v2/declaration.json`. (6) No independent host is in the INTEROP-MATRIX v2 table. Readers MUST keep accepting a retired shape on replay, fork and poll; only emission narrows.

`capabilities.md` §8, `technical` row, Source column: "the record's `status`, which MUST NOT exceed the declaration row (RFC 0197)". `versioning.md` §1.3 and §1.5: "the additive rules" becomes "the additive rules (`COMPATIBILITY.md` §2.4)". The rationale, the precedents and the §B rule go in `COMPATIBILITY.md`, which is not core (RFC 0174 §E.2a).

### Examples

**Positive (retirable).** Connection-pack `transport: "sse"`. `connections` is `experimental` in the declaration. In 2.K the corpus adds `streamable-http` (the R1 migration row, `to.addedIn: "2.K"`). In the same minor it adds a `v2-minor` deprecation row with `removeIn: "2.(K+2)"` or later. A fresh registry census shows 0 published manifests with `transport: "sse"` (the stale local checkout `d0d4700` shows 9 `http` and 0 `sse`, so this must be re-censused, not assumed). No bundle carries it, because the value is manifest-side. The gate reports `retirable` and `sse` leaves the enum at `2.(K+2)`.

**Negative (held to 3.0).**
- `packs.testMode` fails R3, because two committed bundles carry it. That was the P2 disposition, and it is now machine-derived.
- The `a2a` facet's `streaming` / `pushNotifications` / `durableTasks` booleans fail R3, because `openwop-host-v2-reference.json` carries them.
- An envelope kind advertised under `supportedEnvelopes` fails R5, because that family is `stable`.
- Retiring the OIDC ID-token lane fails R3 (MyndHyve's bundle carries the `oidc` lane) and R4 (a lane's meaning is not a defined-absence state).

**Negative (reshape, forbidden).** Renaming `transport: "http"` to `"streamable-http"` in place. This is a rename, so it fails §A.1 whatever the evidence. The monotone gate reports `enum member removed without a due retirement row`.

## Compatibility

**Classification: `breaking`**, as a governance amendment with **no wire change**. This RFC moves no schema, endpoint, event, error code or header. Two parts change what a guarantee means:

- **§A relaxes a MUST-level commitment.** `overview.md` §0 said removing an enum member is a major. This RFC makes it a major *except* under a six-predicate exception. That is a §2.2-class relaxation ("Existing `MUST` requirements MUST NOT be relaxed"), so it is breaking-class even though every surface it lets go is, by R3, one that no committed bundle or published manifest carries. **What stays safe:** a pinned 2.x client sees a `deprecated` annotation (`x-openwop-remove-in`) and then absence, and absence is already in its contract (R4). `minClientVersion` is unchanged and MUST NOT be used to force a shape, because it refuses the whole client with `426`. `OpenWOP-Version` minor stays informational. Existing bundles stay valid measurements at their suite version (`COMPATIBILITY.md` §2.3). R3 means no committed bundle ever carries a removed surface, so no host has to re-certify because of a retirement. A host that wants a surface retired re-cuts without it first, and that re-cut is its consent. Re-certification does not move the v1 end-of-support anchor (`overview.md` §v1 end-of-support).
- **§C tightens what a host may claim.** Before this RFC, any `status` value was a legal claim. After it, `stable` over an `experimental` corpus row is non-conforming. `COMPATIBILITY.md` §4 puts "stricter validation rejecting input that previously succeeded" outside the additive class, and this RFC says so rather than calling it a clarification. **Who is affected:** exactly one committed bundle, MyndHyve, with 38 families. **Migration:** the host re-cuts with `status: "experimental"` and a future `until` on those families. That is a mechanical rewrite of its discovery generator, and codemod `openwop.codemod.capability-status-bound` does it on a discovery document. Alternatively, the corpus promotes a family to `stable` by RFC (§C.9), on evidence. MyndHyve's committed 2.35.1 bundle stays a valid measurement at 2.35.1. The new scenario first fails it on the suite minor that ships it, and `check-bundle-maturity.mjs` fails only bundles cut on that minor or later. See Unresolved 1 (decided).

**What §B changes.** Nothing moves. It writes down the rule that RFCs 0183, 0186 and 0188 already applied.

**SDKs.** SDK minors keep adding methods or fixing types (`COMPATIBILITY.md` §1). An SDK type for a retired optional surface is marked `@deprecated` in a minor and removed only at the SDK major. A pack-author API whose return shape must change (for example `ctx.mcp`) gets a new method name beside the old one, never a changed return type (RFC 0187's "narrowed mint" pattern, applied to the SDK).

## Conformance

**Existing coverage.**
- `v2-capability-record-shape.test.ts` covers required fields, `until` iff not stable, and `until` in the past.
- `v2-capabilities-root-closed.test.ts` fails a bundle that carries a removed facet. That failure is what P1 produced.

Neither compares `status` to the declaration.

**New major-2 scenario: `v2-capability-maturity-bounded.test.ts`.** It lands when this RFC is `Active` (`check-rfc-status-coherence.mjs` rule 7). For every family record in the host's v2 discovery document, it reads the family's `technical` from the `spec/v2/declaration.json` the suite ships. It fails when the record says `stable` and the declaration does not. The scenario is not gated, because every v2 host has records. It **can fail today**: run it against MyndHyve's committed discovery document and 38 families fail. That run is the sabotage proof.

**New corpus gates, each sabotage-proven in `conformance/src/coherence/`:**

| Gate | Fails when | Sabotage that MUST redden it |
| --- | --- | --- |
| `check-v2-surface-monotone.mjs` (§A.1, §B) | against `spec/v2/surface-baseline.json`, which the release PR regenerates: a property, enum member, operation or envelope kind removed without a due, predicate-passing retirement row or a `corrections.json` row; a type changed; a `required` entry added to an existing object; `additionalProperties` going from open to `false` | delete `sse` from the connection-pack enum; add `"transport"` to a `required`; retype `since` |
| `check-v2-retirement.mjs` (§A.2) | a due `v2-minor` row whose predicate R1–R6 fails, or whose advertised-class source is still present; a persisted-class source that is **absent** (the reader schema lost it) | commit a fixture bundle carrying the retired value (R3); flip the fixture family to `stable` (R5); add an `independent` tier to a fixture clock (R6); shorten the window to one minor (R2) |
| `check-removal-dates.mjs` (minor-aware) | a `v2-minor` row due against `spec/v2/release.json` `version` with its v2 source present | the negative control is the old behaviour: a `removeIn: "2.99"` row that the current script fails immediately MUST pass the new one |
| `check-bundle-maturity.mjs` (§C) | a committed bundle cut on a suite version at or above the first suite release that ships this RFC, whose discovery document overstates maturity; bundles cut on an earlier suite are **reported**, not failed (§2.3 measurement; decisions log D1) | the MyndHyve bundle, re-labelled with a fixture suite version at or above that release |

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 no reshape in place — `openwop.requirement.0197.no-reshape` | a schema or path-manifest diff against the committed baseline | any contributor (a PR) | witnessable — claims-check (corpus gate `check-v2-surface-monotone.mjs`) |
| §A.2 retirement predicate R1–R6 — `openwop.requirement.0197.retirement-predicate` | the gate's per-row report (`retirable` / `held:<Rn>`) over committed bundles, census, declaration, clock | a contributor adding a row; a host committing a bundle (R3) | witnessable — claims-check. Residue: R3's registry leg is only as fresh as the census (G2) |
| §A.3 readers keep accepting retired persisted shapes — `openwop.requirement.0197.reader-accepts-retired` | the corpus half: the reader schema still carries the member with `x-openwop-retired-in` | a contributor | witnessable (corpus gate) for the schema. **The host half is unwitnessable today:** a suite cannot produce a historical log that carries a member retired before the run existed, except on a host that already holds one. Recorded, not claimed (G4) |
| §A.3 emission narrows — `openwop.requirement.0197.retired-not-emitted` | a retired persisted member appearing in a post-`2.N` event | the suite, by creating runs | **unwitnessable** until the first persisted-class retirement row exists: before it a scenario would be vacuous, and a row that cannot fail is not a witness. The row lands with that retirement |
| §A.4 corrections need R3 — `openwop.requirement.0197.correction-unevidenced` | a `corrections.json` row whose prior shape a committed bundle carries | a contributor | witnessable — claims-check |
| §B.5 optional-on-closed is additive | — | — | unwitnessable — a classification, not a requirement on a party; the consumer SHOULD is client-side and a host suite cannot observe it, which is why it lives in `COMPATIBILITY.md` and not in core |
| §B.6 required-added / closing is a major | a baseline diff | a contributor | witnessable — same gate as §A.1 |
| §C.7 status ≤ corpus maturity — `openwop.requirement.0197.maturity-not-overstated` | a family record `status: stable` over a non-`stable` declaration row | the suite, unaided (reads discovery) | witnessable-unaided (`v2-capability-maturity-bounded`); corpus leg `check-bundle-maturity.mjs` |

## Alternatives considered

- **"An experimental family MAY change shape in a 2.x minor"** (the remediation plan's first RFC-α). Rejected for four reasons. The change is invisible on the wire. Its trigger has two disagreeing sources (the MyndHyve bundle). The register and gate cannot express it. And a suite that "detects both shapes" under a closed schema is just a widening, which is already additive.
- **Make every change wait for 3.0.** Honest, but a v3 before v1 end-of-support means three concurrent majors, nine repositories, SDK majors in three languages and a new retention floor (`MAINTAINERS.md`; `versioning.md` §1.1 is written for exactly two majors). Rejected as the vehicle. It stays the backstop: everything R1–R6 holds back goes there.
- **Per-family shape versions on the wire** (`capabilities.<family>.shapeVersion`). A client could then detect a reshape. But it makes every client branch per family forever, and it is a new wire surface in exactly the place `versioning.md` chose to keep minor-free. Rejected. Retirement gets the same safety with no wire change.
- **Use `minClientVersion` to force a new shape.** It refuses the whole client with `426`, which is a sledgehammer for a facet. Rejected, and forbidden in §Compatibility.
- **Make §C a SHOULD, or a bundle-verifier label (`claimOverstated`) instead of a MUST.** This would spare MyndHyve a re-cut. But a SHOULD leaves the retirement predicate reading a claim that is allowed to lie. Kept as Unresolved 1 because it is David's call.
- **Do nothing.** P1 recurs. The next removal is decided by whoever writes the CHANGELOG, and the MCP `sse` retirement has no path short of 3.0.

## Unresolved questions

1. **MyndHyve's 38 overstated families. Decided 2026-09-22 (steward decisions log D1).** §C is a MUST for bundles cut on the first suite release that ships this RFC. Committed bundles cut earlier are reported, not failed, following RFC 0148's precedent that an old pass stays a measurement. MyndHyve's re-cut is owed and is recorded as gap G1. No family is promoted to `stable` by this RFC: promotion is a per-family evidence decision (§C.9).
2. **Two minors and 30 days.** Is that the right window? A minor currently ships about daily, so two minors can pass in two days, and the 30 days is the binding term. Should the window instead be keyed on host re-cuts (every INTEROP v2 host has re-cut at least once since the row landed)?
3. **Replacement-less retirement.** R1 requires a replacement. A surface that should simply go (P1's facets had no replacement) currently has only the §A.4 correction path, which requires that v2 never defined it. Should R1 allow `to.surface: "none"` for a family or facet?
4. **Envelope kinds are listed in R4 but blocked by R5.** Every kind rides `supportedEnvelopes`, which is `stable`. Should R5 read the kind's *owning* family (for example `a2uiSurface`) instead of the advertising one?

## Implementation notes (non-normative)

The full file-by-file plan is in the companion implementation plan. In summary:

- **Four gate scripts**: two new, `check-removal-dates.mjs` made minor-aware, and `check-deprecations.mjs` rule 4 extended.
- **One generator leg**: a registry census in `generate-cross-repo-evidence.mjs`.
- **Three new data files**: `spec/v2/migrations.json`, `spec/v2/corrections.json` and `spec/v2/surface-baseline.json`.
- **One scenario.**
- **Prose**: about 165 core words in total (`overview.md` §0/§0a, `capabilities.md` §8, `versioning.md`), plus `COMPATIBILITY.md` §2.4, §3a and §7.
- **No host work** for §A or §B.
- **§C** needs MyndHyve to re-cut on the first suite release that ships this RFC (Unresolved 1, decided; gap G1).
- **Sequencing within the 2.36.0 cycle (amended 2026-09-22).** The prose lands early. The registers, the gates, `spec/v2/surface-baseline.json`, the scenario and the coherence tests land **last**, after RFC 0209's `ui.a2ui-surface` restructure (root `properties` → `anyOf` of `payloadV1`/`payloadV2`, `$defs/component` → `componentV1`) and RFC 0199's `CredentialData` binding. The baseline is generated on the finished 2.36.0 tree, and the release PR regenerates it at the `v2.36.0` tag. A baseline committed mid-cycle, while `spec/v2/release.json` still reads 2.35.0, cannot be regenerated without a release bump and would report the other RFCs' in-cycle edits as removals (`review/arch-impl.md` R5).
- **Ledger rows.** Each claims-check id in the Falsifiability table is minted into `evidence/corpus-ledger.json` by its gate's coherence twin in `conformance/src/coherence/` (the sabotage-proven tests of §Conformance). A script alone mints no ledger row, and `check-accepted-predicate` rule 4 reads only the ledger and v2 bundles.
- **Sequencing.** No v2 removal may merge before this RFC's gates (`check-v2-retirement.mjs`, `check-v2-surface-monotone.mjs`, the minor-aware `check-removal-dates.mjs`) are in `openwop:check`. That covers connection-pack `sse` and RFC 0209 §D.15's delta frame. Until then every v2 removal waits for 3.0.

The first retirement this enables is connection-pack `sse`, filed as its own RFC. That RFC must run a fresh registry census first. The `a2a` facet booleans, `packs.testMode` and `observability.testSeams` stay at 3.0 by R3, and ID tokens are not retired at all (`review/arch-P4.md` §4).

## Acceptance criteria

- [x] `Active` — 2026-09-22, by steward override of RFC 0147 §A.6. The window was waived, not run (see `Updated`).
- [x] Spec text merged (2026-09-22, the RFC 0197 prose PR; wave W2; core +165 words, 25,132 → 25,297 / 29,200 — the second `versioning.md` pointer has no target, because §1.5 no longer carries "the additive-change rules"; `COMPATIBILITY.md` §2.4 also carries the §C maturity ceiling as decided in D1): `overview.md` §0/§0a, `capabilities.md` §8, `versioning.md` pointers; `COMPATIBILITY.md` banner "v1 and v2", §2.4, §3a, §7 v2 paragraph, §1 SDK row; `GOVERNANCE.md` breaking row; `RFCS/README.md` class row.
- [ ] Registers: `v2-minor` trigger and `retirement` block in `deprecations.schema.json`; `spec/v2/migrations.json` and its schema; `spec/v2/corrections.json` (seeded with P3); `spec/v2/surface-baseline.json`; `declaration.schema.json` `maturity.until` described.
- [ ] Gates green on the clean tree and each sabotage in §Conformance proven to redden it: `check-v2-surface-monotone`, `check-v2-retirement`, minor-aware `check-removal-dates`, `check-bundle-maturity`.
- [ ] `v2-capability-maturity-bounded` ships in a published suite and, **verified in the published tarball layout**, reads the shipped `spec/v2/declaration.json`.
- [ ] **Evidence (never waived):** at least one committed v2 host bundle carries `openwop.requirement.0197.maturity-not-overstated` at `executed-pass` with nothing relaxed (the reference host or openwop-app, tier-1). A MyndHyve bundle cut on the first suite release that ships this RFC carries it at `executed-pass` (Unresolved 1, decided per D1).
- [x] `MAINTAINERS.md` waiver log carries the override row; RFC 0156 register row `not-reviewed` (both landed with the filing PR: `MAINTAINERS.md` 0197 row; `docs/WAIVER-RETROSPECTIVE-REGISTER.md` 0197 row, `not-reviewed`).
- [ ] CHANGELOG entry.

## References

- `review/arch-P4.md` (binding design), §0–§3 and §6.
- `CHANGELOG.md` §[2.8.2] (P1); `spec/v1/deprecations.json` rows `packs-test-mode-facet` and `observability-test-seams-facet` (P2); `COMPATIBILITY.md` correction on record 2026-09-20, openwop#1367 (P3); RFC 0184 §Unresolved, RFC 0193, `spec/v2/core/packs.md` (3.0 commitments).
- RFCs 0183, 0186, 0188 (optional-on-closed precedent); RFC 0187 (narrowed mint); RFC 0174 §A.4, §B.2, §B.3, §E.2a; RFC 0178 §A.2; RFC 0147 §A.6; RFC 0194 (override precedent); RFC 0156 (§B register).
- MCP 2025-11-25 §Transports, "Streamable HTTP … replaces the HTTP+SSE transport from protocol version 2024-11-05": https://modelcontextprotocol.io/specification/2025-11-25/basic/transports. MCP 2026-07-28 transports overview (standard bindings: stdio, Streamable HTTP): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports.
- W3C Process, Classes of Changes (Class 3), as quoted in `COMPATIBILITY.md` §3. The live section was not re-fetched: the fetch of https://www.w3.org/policies/process/20250818/ returned a truncated document without §6.2.3.
