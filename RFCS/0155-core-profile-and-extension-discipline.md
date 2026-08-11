# RFC 0155: Core Profile and Extension Discipline

| Field | Value |
| --- | --- |
| **RFC** | 0155 |
| **Title** | Core Profile and Extension Discipline |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-11 |
| **Affects** | `spec/v1/{profiles,core-standard-profile,agent-platform-profile,capabilities}.md`, NEW `spec/v1/extensions.json`, certification profiles, badges, `INTEROP-MATRIX.md`, compatibility and roadmap docs |
| **Compatibility** | `additive` aliases/registry in v1; legacy name removal deferred to v2 |
| **Supersedes** | Unqualified use of discovery-only `openwop-core` as a meaningful runtime-conformance claim |
| **Superseded by** | — |

## Summary

This RFC names the existing discovery-only floor `openwop-discovery-core`, reserves unqualified OpenWOP conformance for the executable `openwop-core-standard` profile, and creates a versioned extension registry with maturity and evidence requirements. It preserves `openwop-core` as a deprecated v1 alias while preventing badges or claims from implying run, durability, interrupt, or multi-agent behavior that the profile does not require.

## Motivation

The current `openwop-core` predicate checks discovery fields but need not prove run lifecycle, streaming, interrupts, durability, replay, or multi-agent coordination. The stronger core-standard profile has black-box behavior. With 146+ RFCs and a large optional surface, implementers also need a bounded manifest of what is stable, experimental, dependent, and independently evidenced.

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
3. Which existing extensions are grandfathered and at what maturity?
4. What exact text and visual treatment distinguishes discovery-core from core-standard badges?
5. Is the manifest part of the conformance npm package, corpus release, or both?

## Implementation notes (non-normative)

Backfill the registry mechanically from RFC status/capability declarations, then review every row. Do not manually duplicate floor lists. This RFC is SR-8 under RFC 0147.

## Acceptance criteria

- [ ] Canonical/alias profile definitions and deprecation guidance land.
- [ ] Stable core manifest is generated and parity-gated.
- [ ] Extension registry is complete for all current normative extensions.
- [ ] Budget and Stable evidence rules are governance-approved.
- [ ] Certification, badges, SDKs, interop matrix, roadmap, and CHANGELOG update.
- [ ] At least one Tier-3 host validates the stable-core manifest in practice.

## References

- RFCs 0085, 0088, 0089, 0147 Workstream 7, and 0148
- `spec/v1/profiles.md`
- `spec/v1/core-standard-profile.md`
- `COMPATIBILITY.md`
