# RFC 0043: Registry and extension-policy

| Field | Value |
|---|---|
| **RFC** | 0043 |
| **Title** | Registry submission policy, extension namespace rules, profile/event/capability name reservation, and IPR posture |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-22 |
| **Updated** | 2026-05-22 |
| **Affects** | `spec/v1/host-extensions.md` (cross-link to RFC 0043 for canonical prefix table) · `spec/v1/registry-operations.md` (policy layer above the operational reference) · `GOVERNANCE.md` (§"Path to working group" adds RFC 0043 as the registry-policy precondition) · `RFCS/0038-working-group-charter.md` (charter adds explicit reference to RFC 0043 for registry responsibilities) · `MAINTAINERS.md` (registry maintainer expectations) · NEW `docs/governance/registry-policy.md` (one-stop policy index) · CHANGELOG |
| **Compatibility** | `additive` — policy text, no wire-shape change |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Codifies, in one document, the policies that govern the openwop project's stability surface that lives **outside** the wire contract: (a) how extension namespaces are reserved and policed; (b) how the openwop pack registry (`packs.openwop.dev`) accepts, deprecates, yanks, and key-rotates submissions; (c) how profile names, event types, envelope kinds, and capability names are reserved against squatting; (d) what IPR (Intellectual Property Rights) commitments the project makes to contributors and downstream implementers. These policies exist informally today across `host-extensions.md`, `registry-operations.md`, `CONTRIBUTING.md`, and `LICENSE` files; this RFC consolidates them into a single addressable artifact that an external standards-body or auditor can read in one pass.

## Motivation

The 2026-05-22 standards-readiness review's finding (7) was: *"Governance is technically incomplete for an open standard. ... Registries, profile names, event types, capability names, and safety-fix exceptions are part of the protocol's technical stability surface."* The reviewer was correct that these policies exist in practice but live in fragments — a non-steward implementer who wants to add a `vendor.acme.*` namespace, register an `openwop-acme-feature` profile, or claim an `acme.*` OTel attribute namespace cannot find a single document that says "here is the policy, here is how to submit, here are the rules I am bound by." Working-group ratification (per `RFCS/0038`) is gated on the tripwire firing (≥3 organizations + ≥2 non-steward hosts); registry policy CANNOT wait for that gate because the registry is already live (`packs.openwop.dev` ships 48+ packs across 4 trust tiers per `KNOWN-LIMITS.md`).

This RFC is the **policy document the working group will ratify when it forms.** Landing it as `Draft` now means the policy is auditable today, and the WG's first action upon formation is a yes/no vote on adopting it.

## Proposal

### §A — Extension namespace policy (codifies + strengthens `host-extensions.md`)

The canonical prefix table in `host-extensions.md` becomes normative under this RFC. The following rules apply:

1. **Protocol-owned prefixes (`openwop.*`, `core.*`) are reserved.** No host, pack author, or third party MAY use `openwop.*` or `core.*` for non-spec-authoritative purposes. Adding a new `openwop.*` field requires a new RFC; the working group (or the lead maintainer, pre-WG) is the gatekeeper.
2. **`community.*` prefix is first-come-first-served on the public registry**, conditional on the submitter passing the supply-chain checks in §B. Names are case-insensitive and normalized to lowercase per `node-packs.md` §Naming.
3. **`vendor.<org>.*` prefixes require org-authorization on the public registry.** A vendor submits a Domain-Verified ownership claim (DNS TXT record or HTTPS .well-known) for the namespace before any pack under `vendor.<org>.*` is admitted to `packs.openwop.dev`. The verification record SHOULD be re-validated yearly.
4. **`private.<host>.*` prefixes are host-internal.** They MUST NOT appear on `packs.openwop.dev`. A host that lists `private.<host>.*` typeIds in its workflow definitions is responsible for resolving them from its own internal registry.
5. **`local.*` prefix is dev-only.** MUST NOT appear in published packs.
6. **Extension OTel attributes under `host.*` or `<vendor>.*`:** hosts MAY emit any OTel attribute under a vendor-prefixed namespace per `observability.md`. The `openwop.*` namespace is reserved for the canonical OTel taxonomy specified in `observability.md`; emitting non-spec attributes under `openwop.*` is non-conformant.

### §B — Registry submission, signing, and lifecycle (operationalizes `registry-operations.md`)

`registry-operations.md` is the operational reference (how the registry's HTTP API works); RFC 0043 §B is the **policy layer** above it.

#### §B.1 — Submission policy

A pack submission to `packs.openwop.dev` MUST satisfy:

- **Schema validity:** `pack.json` validates against `node-pack-manifest.schema.json`.
- **Naming compliance:** matches one of the §A prefix rules (`core.*` excluded for non-spec submissions).
- **Signature:** Ed25519 signature over the tarball bytes, verifiable against a public key in `registry/keys/<keyId>.pub` (the publisher's verified key).
- **SBOM:** SPDX 2.3-compliant SBOM accompanies the tarball.
- **SRI integrity:** the tarball SHA-512 matches the manifest's `dist.integrity` field.
- **Provenance disclosure:** the submission PR must record the submitter's GitHub handle, the contributing entity, and (for `vendor.<org>.*`) the DNS verification record.
- **Capability declarations:** if the pack declares `peerDependencies` on `host.*` capabilities, every declared capability MUST be in the `host-capabilities.md` canonical 14-capability list (or a host-extension subject to §A.6).
- **Test scenarios:** if the pack ships a `core.openwop.*` or `vendor.<org>.*` typeId, at least one conformance scenario MUST cover the typeId's wire-surface behavior (per the registry trust-tier rules in `SECURITY/external-audit-engagement.md` §2.1).

#### §B.2 — Trust tiers

Per the existing pack-tier convention in `SECURITY/`:

| Tier | Prefix | Auditing | Submission flow |
|---|---|---|---|
| **Spec-authoritative** | `core.openwop.*` | Audit-gated for public publication (pre-audit publication recorded in `SECURITY/external-audit-engagement.md` §2.1.1) | Submitter MUST be a project maintainer; 2 maintainer approvals (or 1 in bootstrap-phase). |
| **Vendor-authoritative** | `vendor.<org>.*` | DNS-verified ownership + standard signing | 1 maintainer approval + DNS verification. |
| **Community** | `community.<author>.*` | Standard signing + supply-chain checks | 1 maintainer approval. |
| **Test-mode** | `test.*` (per RFC 0025) | Non-production conformance use only | No formal review; the registry rejects test-mode packs at install-time outside conformance scenarios. |

#### §B.3 — Deprecation and yank

- **Deprecation** is informational: the registry marks a pack version as `deprecated: true` with a `deprecation.reason` and `deprecation.replacement`. Existing installs continue to resolve; new installs MUST receive a one-line console warning.
- **Yank** is hard removal: the tarball is deleted, the manifest is replaced with a tombstone, and the signature record is preserved (for forensic purposes). Yank applies when:
  - The signing key is compromised (forces every pack signed by that key to yank-eligible review).
  - The pack ships a security-impacting bug (CVE-class).
  - The submitter requests yank within 72 hours of initial publication (no-questions-asked author retraction window).
- **Yank request flow:** an issue at `github.com/openwop/openwop` with the `registry-yank` label triggers a maintainer review within 7 calendar days.

#### §B.4 — Signing-key rotation

Per `registry-operations.md` §"Signing-key rotation," a publisher MAY rotate their Ed25519 signing key at any time by:

1. Publishing a NEW public key at `registry/keys/<new-keyId>.pub`.
2. Updating `pack.json` `dist.publisherKey` to reference the new key.
3. Signing future submissions with the new private key.

The OLD key remains valid for verifying previously-signed packs indefinitely; the registry does NOT re-sign historical packs. Rotation MUST be announced in the publisher's pack README + CHANGELOG (best-effort discoverability).

For the **registry root key** (`registry-root@openwop`), rotation requires a 90-day public-comment window plus dual control (two maintainers' approval). The current root key fingerprint is published at `registry/keys/registry-root.pub` and is the trust anchor for the spec-authoritative tier.

### §C — Profile, event, envelope kind, and capability name reservation

The audit's concern was that registries, profile names, event types, and capability names are "part of the protocol's technical stability surface." This RFC reserves them mechanically:

#### §C.1 — Profile names (`profiles.md`)

- Profile names MUST match the pattern `^openwop-[a-z0-9-]+$`.
- Names beginning with `openwop-` are RESERVED. A non-spec-authoritative profile name MUST use a host-vendor prefix: e.g., `acme-openwop-customprofile` (NOT `openwop-acme-customprofile`).
- Adding a new `openwop-*` profile requires an RFC.
- The current profile registry lives in `profiles.md` §"Compatibility profiles" + `scale-profiles.md`.

#### §C.2 — Event types (`run-event-payloads.schema.json`)

- Event types MUST match `^[a-zA-Z][a-zA-Z0-9.]*$` (the existing schema discriminator pattern).
- The `openwop.*` and `core.*` prefixes are RESERVED.
- Hosts emitting host-extension events MUST use a vendor-prefixed namespace (e.g., `acme.metric.emitted`).
- Adding a new `openwop.*` or `core.*` event type requires an RFC.

#### §C.3 — Envelope kinds (`ai-envelope.md` + `schemas/envelopes/*.schema.json`)

- Envelope kinds MUST match `^[a-zA-Z][a-zA-Z0-9.]*$`.
- The 3 universal kinds (`message.delta`, `tool.call`, `tool.result`) are RESERVED to the spec.
- Vendor-prefixed envelope kinds (e.g., `acme.custom-reasoning`) are reserved to the matching vendor namespace.
- Adding a new universal kind requires an RFC.

#### §C.4 — Capability names (`capabilities.schema.json`)

- Top-level capability names MUST match the spec's canonical 14 + any RFC-introduced names.
- Adding a new top-level capability requires an RFC.
- Host-extension capabilities MUST appear under a vendor-prefixed sub-object: `capabilities.x-acme.customCapability`.

#### §C.5 — Safety-fix exceptions

A safety-fix RFC (per `COMPATIBILITY.md` §3) may rename or remove a reserved name when the rename is itself part of the safety fix. The RFC MUST publish a migration runbook in `version-negotiation.md`.

### §D — Intellectual Property Rights (IPR) posture

The audit flagged "IPR posture" as part of the open-standard checklist. The openwop project's posture is:

#### §D.1 — Contribution model

- **DCO sign-off required.** Every commit MUST carry a `Signed-off-by:` trailer per the Developer Certificate of Origin v1.1 (`https://developercertificate.org/`). The DCO is the project's contribution license proxy; no separate CLA is required.
- **Patent grant:** Contributing to the openwop spec under Apache-2.0 grants every other licensee a patent license under the contributor's own patents reading on the contribution, per the Apache-2.0 §3 patent grant. The DCO sign-off includes the affirmation that the contributor either owns the contribution or has rights to license it.
- **Trademark:** "openwop" is not currently trademarked. If the working group ratifies a trademark (per `RFCS/0038-working-group-charter.md`), the trademark MUST be granted under a fair-use policy permitting "OpenWOP-compliant" claims by any host passing the conformance suite at the published gate version.

#### §D.2 — License layout

- **Code surfaces** (SDKs at `sdk/{typescript,python,go}/`, reference hosts at `examples/hosts/*/`, conformance suite at `conformance/`, scripts at `scripts/*`, registry tooling at `registry/`): **Apache License 2.0** (current; see `LICENSE`).
- **Spec prose** (`spec/v1/*.md`, `RFCS/*.md`, `docs/*.md`): **Creative Commons Attribution 4.0 International (CC-BY-4.0)** (current; see `LICENSE-DOCS`).
- **Schemas and OpenAPI/AsyncAPI** (`schemas/*`, `api/*.yaml`): **Apache-2.0** alongside the code, NOT CC-BY-4.0 — they are machine-readable specifications consumed by code, treated as code per the JSON Schema convention.
- **Third-party content** brought into the repo (e.g., vendored libraries under `conformance/scripts/pack-vendor.sh`) retains its original license; the `LICENSE` file lists every such dependency.

#### §D.3 — Disclosure obligations

A contributor who knows that their contribution is encumbered by a patent they (or their employer) controls MUST disclose this fact in the PR. The maintainers will route to legal review before merge. If the encumbrance prevents a royalty-free grant under Apache-2.0 §3, the maintainers will reject the contribution.

This RFC does NOT establish a "patent advisory committee" or similar standing body — that is a working-group decision per `RFCS/0038`. Until then, the lead maintainer makes the patent-review call (transitional, like the lead-maintainer tiebreaker in `GOVERNANCE.md` §"Decision making").

### §E — Cross-link from existing surfaces

This RFC is reference-able from:

- `spec/v1/host-extensions.md` §"The rule" — adds a one-line footer linking to RFC 0043 for the formal policy.
- `spec/v1/registry-operations.md` §"Operator-side normative reference" — adds a header linking to RFC 0043 for the policy layer.
- `RFCS/0038-working-group-charter.md` §"Working Group composition" — adds an item that the WG inherits responsibility for RFC 0043 policies upon ratification.
- `GOVERNANCE.md` §"Path to working group" — adds RFC 0043 as a precondition for working-group activation (alongside ratifying RFC 0038).
- `MAINTAINERS.md` — registry-maintainer expectations cross-link to RFC 0043 §B.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1 — this RFC is policy text, with no wire-shape impact:

- No new fields, schemas, endpoints, or event types are added.
- No existing required-field, optional-field, event-type, endpoint, or `MUST` requirement is changed.
- Existing v1 conformance passes are unaffected.

The IPR section §D codifies the existing license layout in `LICENSE` + `LICENSE-DOCS` (Apache-2.0 for code + CC-BY-4.0 for prose); it does NOT change either license. The DCO sign-off requirement is already in `CONTRIBUTING.md`.

The namespace-reservation rules in §C codify the existing practice (`openwop.*` and `core.*` are already de facto reserved; this RFC documents the gate). No published pack, profile, or event type is invalidated.

## Conformance

### Existing scenarios that cover this surface

- `pack-registry.test.ts` — covers the registry-served pack-manifest shape.
- `pack-registry-publish.test.ts` — covers server-side publish-time signature checks.
- `registry-public.test.ts` — covers the live `packs.openwop.dev` tarball + signature roundtrip.
- `node-pack-manifest-shape.test.ts` (server-free) — covers `pack.json` validity.

### New scenarios

None required at the wire-shape level (the RFC is policy text). A future scenario MAY assert that a pack with a `private.*` prefix is rejected at registry submission, but the rejection happens server-side at the registry, not at the host — the host doesn't see invalid submissions. The conformance suite already tests installed-pack validity via the four scenarios above.

### Policy-compliance verification

The audit-friendly equivalent of "conformance" for this RFC is a **policy-audit checklist**:

- [ ] `scripts/check-doc-pack-claims.mjs` confirms every pack referenced from spec docs is published or marked `private.*`.
- [ ] `scripts/audit-pack-coverage.mjs` confirms every `core.openwop.*` typeId has a conformance scenario.
- [ ] CI checks that no PR introduces an `openwop.*` or `core.*` field without an RFC reference.
- [ ] `MAINTAINERS.md` review confirms the lead-maintainer is named and the DCO check is enforced (already implemented as the `dco` GitHub Action).

## Alternatives considered

1. **Land each policy section as a separate RFC** (one for IPR, one for registry, one for namespaces). Rejected because the audit's specific complaint was that these policies were fragmented; splitting them re-creates the fragmentation. A single document is the credibility signal.
2. **Wait for the working group to ratify policies upon formation.** Rejected because the registry is already live; policies governing it need to exist before the WG forms, not after. The WG's ratification can be a yes/no vote on this Draft.
3. **Defer the IPR section §D to a separate legal review.** Rejected because Apache-2.0 + CC-BY-4.0 + DCO is the existing posture; this RFC codifies it, not changes it. A legal review is not blocking codification of existing practice.
4. **Require a CLA instead of the DCO.** Rejected because DCO is the lightweight industry standard (Linux Foundation, Docker, GitLab, et al. use it); CLAs add friction and signal corporate gatekeeping that does not match the project's bootstrap-phase posture.

## Unresolved questions

1. **DNS verification flow for `vendor.<org>.*` ownership** — should the DNS TXT record live at `_openwop._owner.<domain>`, or at the registry's choice of well-known path? Need maintainer decision.
2. **Registry yank — should the 72-hour author-retraction window be longer?** npm uses 72 hours; Python PyPI uses no fixed window. 72 is the proposal.
3. **Trademark posture if + when the WG forms** — should `OpenWOP` be a trademark? Many open standards (e.g., HTTP, MQTT) avoid trademarks; some (e.g., Linux®, Java®) lean on them. The bootstrap-phase decision is "no trademark"; the WG can revisit.
4. **Patent disclosure SLA** — if a contributor discloses an encumbering patent, how long does the project have to make a merge/reject decision? 14 days is the proposal.
5. **OTel attribute namespace policy** — §A.6 says `openwop.*` is reserved; should this RFC also reserve `host.*` for the host-capability namespace? Today `host.*` is host-extensions-territory.

## Implementation notes (non-normative)

- **Effort estimate:** 1 day to land the spec cross-links + 1 day for the WG charter strengthening + this RFC text = ~2 days work.
- **Co-landing recommendation:** land alongside RFC 0042 (experimental tier) since both are governance/policy additions that respond to the same audit. Separate RFCs because the wire-surface impact is different (0042 adds a schema field; 0043 is policy-only).
- **WG ratification path:** when the `GOVERNANCE.md` working-group tripwire fires (≥3 organizations + ≥2 non-steward hosts), the WG's first ballot is "ratify RFC 0043 §B and §C verbatim, or amend." This RFC's `Draft` status ensures the policy is auditable today; ratification flips it to `Accepted`.
- **No wire-shape risk.** Because the RFC is policy text, the `openwop:check` gate is not affected. Schema and OpenAPI are unchanged.

## Acceptance criteria

- [ ] Spec text cross-links landed in `host-extensions.md`, `registry-operations.md`, `GOVERNANCE.md`, `RFCS/0038-working-group-charter.md`, `MAINTAINERS.md`.
- [ ] NEW `docs/governance/registry-policy.md` lands as a one-stop policy index pointing at this RFC.
- [ ] CHANGELOG entry under `[Unreleased]` referencing this RFC.
- [ ] 7-day public comment window closes without unresolved objections (additive policy).
- [ ] Working group, when formed, ratifies the policy (gated on `GOVERNANCE.md` tripwire — this is a future-action gate, not a blocker for landing the Draft).

## References

- Audit document: 2026-05-22 standards-readiness review finding (7) — `docs/AUDIT-RESPONSE-2026-05.md`.
- `GOVERNANCE.md` §"Path to working group" — the tripwire that gates WG ratification of this policy.
- `RFCS/0038-working-group-charter.md` — the WG charter that adopts RFC 0043 upon ratification.
- `spec/v1/host-extensions.md` — the canonical prefix table that becomes normative under this RFC.
- `spec/v1/registry-operations.md` — the operational reference this RFC's §B sits above.
- `SECURITY/external-audit-engagement.md` §2.1 — the pre-audit publication decision context this RFC's §B.2 trust-tier table reflects.
- Linux Foundation DCO v1.1 — `https://developercertificate.org/`.
- Apache License 2.0 §3 patent grant.
- Creative Commons CC-BY-4.0 — `https://creativecommons.org/licenses/by/4.0/`.
- `CONTRIBUTING.md` §"Sign your commits" — existing DCO enforcement.
