# RFC 0155: Core Profile and Extension Discipline

| Field | Value |
| --- | --- |
| **RFC** | 0155 |
| **Title** | Core Profile and Extension Discipline |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-16 (§C registry backfill COMPLETE — 67 records added, 72 covered / 0 uncovered / 4 core / 14 metadata of 90; UQ3 grandfathering resolved by rule; generator `metadataFields` bucket with per-key rationale; `owningDoc` for six pre-RFC v1 base advertisements; `securityTier` closed to high\|medium\|low; `minimumSuiteVersion` derived from the witness scenario's first commit.) 2026-08-16 (§A rename/alias landed in `profiles.md` + `profiles.ts` + `profile-discovery-core-alias.test.ts`, suite `1.109.0 -> 1.110.0`; §C registry completeness made measurable — derived `coverage` block, 5/81/4 of 90, gated). 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text plus §A's motivating defect made concrete — the published bundle claims `openwop-core` while failing six `interrupt-*` scenarios, and RFC 0148 G6 gave `openwop-core` an explicit `discoveryOnly` marker (#949). **Carried forward, not closed:** §B's `core-standard-manifest.json` and §C's `extensions.json` — neither has a schema, generator, or conformance coverage yet (gap G6).) |
| **Affects** | `spec/v1/{profiles,core-standard-profile,agent-platform-profile,capabilities}.md`, NEW `spec/v1/extensions.json`, certification profiles, badges, `INTEROP-MATRIX.md`, compatibility and roadmap docs |
| **Compatibility** | `additive` aliases/registry in v1; legacy name removal deferred to v2 |
| **Supersedes** | Unqualified use of discovery-only `openwop-core` as a meaningful runtime-conformance claim |
| **Superseded by** | — |

## Summary

This RFC names the existing discovery-only floor `openwop-discovery-core`, reserves unqualified OpenWOP conformance for the executable `openwop-core-standard` profile, and creates a versioned extension registry with maturity and evidence requirements. It preserves `openwop-core` as a deprecated v1 alias while preventing badges or claims from implying run, durability, interrupt, or multi-agent behavior that the profile does not require.

## Motivation

The current `openwop-core` predicate checks discovery fields but need not prove run lifecycle, streaming, interrupts, durability, replay, or multi-agent coordination. The stronger core-standard profile has black-box behavior. With 146+ RFCs and a large optional surface, implementers also need a bounded manifest of what is stable, experimental, dependent, and independently evidenced.

**This stopped being hypothetical on 2026-08-11.** The only published v1 certification bundle claims `openwop-core` — not `openwop-core-standard` — while listing six `interrupt-*` scenarios in its own `results.failed`. Had it claimed the executable floor, `openwop-core-standard`'s `requiredAnyPrefix: ['interrupt-']` would have rejected it outright. The one-word difference between the two names is the difference between a claim the evidence contradicts and a claim it does not reach. See `docs/CERTIFICATION-BUNDLE-INVENTORY.md`.

The RFC 0148 G6 fix (2026-08-12) then made the distinction machine-visible rather than merely documented: `openwop-core` now carries an explicit `discoveryOnly` marker in `PROFILE_FLOOR_SCENARIOS`, recording that it has **no runtime floor by design** — the predicate is the whole claim. That is exactly what §A asserts, now asserted by the code a verifier actually runs. An `openwop-core` badge is therefore a statement about a document, not about a running system, and nothing in the current naming says so.

## Proposal

### §A — Profile names

- `openwop-discovery-core` is the canonical name for the current discovery predicate.
- `openwop-core` remains a deprecated alias throughout v1 and **MUST** derive exactly when `openwop-discovery-core` derives.
- `openwop-core-standard` is the minimum executable conformance floor.
- An unqualified “OpenWOP conformant” badge or statement **MUST** mean `openwop-core-standard`; discovery-only claims **MUST** say `openwop-discovery-core`.
- Every claim **MUST** state all additional profiles it relies on.

### §B — Stable core manifest

Publish a generated `core-standard-manifest.json` listing the exact normative spec sections, schemas, OpenAPI operations, AsyncAPI messages, requirement IDs, and suite floor scenarios. The manifest **MUST** carry corpus/suite provenance and a digest. Prose and code profile definitions **MUST** be generated from or checked against this manifest.

### §C — Extension registry

`spec/v1/extensions.json` contains closed records:

```json
{
  "id": "openwop-compensation-v1",
  "maturity": "draft",
  "owningRfc": "0151",
  "capabilityPath": "compensation.supported",
  "dependsOn": ["openwop-core-standard"],
  "securityTier": "high",
  "minimumSuiteVersion": null,
  "evidenceTier": null
}
```

Allowed maturity is `experimental|draft|stable|deprecated`. An extension **MUST NOT** become `stable` until normative prose, schemas, non-vacuous conformance, SDK support where applicable, and at least one Tier-3 implementation exist. Security-high extensions also require external-audit coverage or an explicit audit carry-forward.

### §D — Extension budget

The project **MUST** limit concurrent non-stable normative extensions to a published budget. The initial proposed budget is 12, with no more than four security-high extensions simultaneously Active. Exceeding the budget requires closing, withdrawing, or explicitly deferring an existing extension through governance review; a waiver by the original steward alone is forbidden.

### §E — Claims and certification

Certification bundle v2 **MUST** name canonical profile IDs and MAY include deprecated aliases only in `aliases`. Badges **MUST** include profile, protocol minor, suite version, and date. A discovery-core result **MUST NOT** use the same visual/text badge as core-standard.

### §F — Security

Add structural invariant `profile-claim-floor-not-overstated`. An extension's dependencies and security tier **MUST** be validated before certification. Vendor extensions remain permitted but cannot use an `openwop-*` ID without an accepted RFC.

## Compatibility

Additive in v1: new canonical name, alias, manifest, and registry. Existing clients recognizing `openwop-core` continue to work. SDKs warn on creating new unqualified core claims. Removing the alias, changing discovery-core's predicate, or making core-standard fields universally required is v2 work.

## Conformance

New scenarios:

- `profile-discovery-core-alias.test.ts`;
- `core-standard-manifest-parity.test.ts`;
- `profile-claim-floor-not-overstated.test.ts`;
- `extension-registry-validity.test.ts`;
- `extension-dependency-closure.test.ts`;
- `extension-stable-evidence.test.ts`; and
- `certification-profile-canonical-name.test.ts`.

All are server-free except actual profile floor behavior, which uses RFC 0148 witnesses. Fixtures cover aliases, overclaimed badges, missing dependencies, excessive budget, stable-without-Tier-3, and vendor namespace collisions.

## Alternatives considered

1. Redefine `openwop-core` in place. Rejected: it would invalidate existing discovery-only hosts.
2. Remove the weak profile immediately. Rejected: breaking and unnecessary in v1.
3. Keep an unbounded RFC catalog. Rejected: growth has exceeded independent evidence capacity.
4. Make every extension require Tier-3 before Active. Rejected: experimentation needs a pre-adoption phase; Tier-3 gates Stable.
5. Do nothing. Rejected: compatibility claims remain materially ambiguous.

## Unresolved questions

1. Is 12/4 the correct extension budget?
2. Does every Stable extension require Tier-3, or may low-risk schema-only additions use two cross-language implementations?
3. ~~Which existing extensions are grandfathered and at what maturity?~~ **Resolved 2026-08-16:** all of them, by rule rather than by list — an extension whose owning RFC is `Active`/`Accepted`, or whose normative home is a v1 base spec document, enters at `draft`; one whose owning RFC is `Draft`/`Parked` enters at `experimental`; nothing enters at `stable` (§C Tier-3 bar, no Tier-3 host). Stated in `spec/v1/extensions.json` `$comment` and applied to the 67 backfilled records (72 covered / 0 uncovered / 4 core / 14 metadata of 90 families).
4. What exact text and visual treatment distinguishes discovery-core from core-standard badges?
5. Is the manifest part of the conformance npm package, corpus release, or both?

## Implementation notes (non-normative)

Backfill the registry mechanically from RFC status/capability declarations, then review every row. Do not manually duplicate floor lists. This RFC is SR-8 under RFC 0147.

## Acceptance criteria

- [ ] Canonical/alias profile definitions and deprecation guidance land. (2026-08-16: **landed** — `spec/v1/profiles.md` §`openwop-discovery-core` (canonical) with `openwop-core` as the deprecated v1 alias deriving exactly when the canonical name derives, the reference derivation emitting both or neither, §"Claim vocabulary" (unqualified claim ⇒ `openwop-core-standard`; discovery-only ⇒ `openwop-discovery-core`; every claim states its profiles; bundle v2 canonical ids; vendor `openwop-*` ids need an RFC), and deprecation guidance; `conformance/src/lib/profiles.ts` `PROFILE_NAMES` + `deriveProfiles` + `hasProfile` + floors; witness `profile-discovery-core-alias.test.ts` (suite 1.110.0). Carried: bundle v2 `aliases` landed with S6; badge artwork is a site concern. **2026-08-16 later: `profile-claim-floor-not-overstated` registered** (protocol tier, against `certification-bundle-non-vacuous.test.ts`) for the floor half — `verifyBundleV2` refuses `certified` on any unwitnessed floor row or underived claim; §F's dependency/security-tier validation half is carried until bundle v2 carries extension claims.)
- [x] Stable core manifest is generated and parity-gated. (`spec/v1/core-standard-manifest.json` + `scripts/generate-core-standard-manifest.mjs`, checked in `openwop:check`; parity asserted against `PROFILE_FLOOR_SCENARIOS` and the requirement registry.)
- [x] Extension registry is complete for all current normative extensions. (**Complete 2026-08-16 (later the same day): 73 records; 72 covered / 0 uncovered / 4 core / 14 metadata of 90 families**, `--check` gated, the metadata bucket rationale-per-key and forbidden from carrying `supported`; UQ3 grandfathering rule stated in the file. Two records state a suite gap — `nosql` and `promptLibrary` have no scenario witness (`minimumSuiteVersion: null`). Earlier the same day: `spec/v1/extensions.json` had six records covering the RFC 0147 program extensions; **completeness became measured and gated, not asserted** — a DERIVED `coverage` block (`scripts/generate-extension-registry-coverage.mjs`, `--check` in `openwop:check`, plus a registry-test leg) partitions every top-level capability family into core-predicate fields / covered / uncovered: **5 covered, 81 uncovered, 4 core of 90**. Still not complete — 81 families have no maturity/security/evidence record — but a family can no longer arrive unaccounted for, and the number is the honest distance to done. Filling records requires per-RFC evidence and, under §C, none can be `stable` without a Tier-3 host.)
- [ ] Budget and Stable evidence rules are governance-approved. (Externally gated — needs governance review, and UQ1 (is 12/4 the right budget?) is unresolved.)
- [ ] Certification, badges, SDKs, interop matrix, roadmap, and CHANGELOG update. (2026-08-16: CHANGELOG + `profiles.md` claim vocabulary landed. Bundle v2 `aliases`: the schema has carried the field since it landed; as of 2026-08-16 (S6) `--certify --bundle-version 2` actually uses it — `claimedProfiles` holds canonical ids only and the deprecated `openwop-core` alias, when it derives, is reported in `aliases` (`DEPRECATED_PROFILE_ALIASES` in `profiles.ts`). Still carried: badge distinction (site). **Checked 2026-08-16:** neither `@openwop/openwop` nor `openwop-client` carries a profile-derivation helper (grep for `openwop-core` / `deriveProfiles` in `openwop-sdks` returns nothing), so there is no SDK surface to move to the canonical name; `INTEROP-MATRIX.md` rows say `openwop-discovery-core (alias openwop-core)` since S10.)
- [ ] At least one Tier-3 host validates the stable-core manifest in practice. (Externally gated — no Tier-3 host exists; the `ROADMAP.md` tripwire has not fired.)

## References

- RFCs 0085, 0088, 0089, 0147 Workstream 7, and 0148
- `spec/v1/profiles.md`
- `spec/v1/core-standard-profile.md`
- `COMPATIBILITY.md`

