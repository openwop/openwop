# OpenWOP v2 Core — Overview

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0167, 0168, 0169, 0171, 0174.**

## Why this exists

`spec/v2/core/` is the front door a host implements to pass the 2.0.0 floor. This document fixes the reading order, restates the six axioms, and states once the rules other documents only reference.

## Reading order

1. `overview.md` — axioms, §0, claim vocabulary, `ext/` rule
2. `versioning.md` — major negotiation, `OpenWOP-Version`, the 18 axes, release identity
3. `capabilities.md` — one well-known resource, record type, closed root, derived profiles
4. `identity.md` — Subject, lanes, `SubjectLink`, id grammars, resume tokens
5. `runs.md` — create / get / cancel / fork, `configurable`, snapshot, owner
6. `events.md`, `errors.md`, `headers.md` — event `oneOf`, payload and error registries, `OpenWOP-*`
7. `streams.md`, `interrupt.md`, `idempotency.md`, `replay.md` — run-side surfaces
8. `persistence.md` — era key, v1 reader rule, pinned runs
9. `security-defaults.md`, `webhooks.md`, `interop.md` — obligations of a surface, signatures, A2A / MCP
10. `packs.md`, `connection-packs.md`, `form-content-packs.md`, `workflow-chain-packs.md` — pack identity, engines ceiling
11. `conformance.md` — requirement ids, witness classes, bundle v3, seams profile

## Axioms in force (RFC 0167 §A)

1. A MUST without a witness class is not a requirement.
2. One name per thing; every alias has a removal date in `spec/v1/deprecations.json` and a codemod id.
3. Closed by default: discovery root, event envelope, payload and error registries, bundle, and `configurable` are `additionalProperties: false`; vendor extension is one positive pattern in one namespace.
4. Registers are data: gaps, risks, deprecations, migrations, witness classes, and dispositions are files with schemas and gates; prose is checked against them, never the reverse.
5. Security defaults are obligations of the surface: a protecting behavior binds when the surface is advertised, never when a flag is set.
6. Nothing persisted under v1 is orphaned: every v1 artifact has a disposition in the migration register.

## §0 Closed-enum growth rule (RFC 0171 §A.5)

A registry-backed enum (event types, error codes, envelope kinds, reason vocabularies, lanes) grows by adding a row to its registry and regenerating. Consumers MUST accept an unknown member of a registry-backed enum and MUST NOT act on it. Producers MUST NOT emit an unregistered member. Adding a member is additive in v2.x; removing or renaming one is a major.

## v1 end-of-support (RFC 0174 §B.4)

v1 support ends at the later of (a) every INTEROP-MATRIX host's non-vacuous v2 bundle plus 90 days and (b) 18 months from the v2 release, where (b) applies if and only if an independent host is in the matrix at release. Phase 5 computes the date from the matrix; nothing else MAY set it. The hosts counted under (a) are those with a row in the INTEROP-MATRIX v2 table; a reference host that stays on the 1.x line through the overlap (the matrix says which) is not a v2 host and does not count. A host's bundle is "non-vacuous" when at least one claimed profile carries `witnessCount ≥ 1`. The anchor for a host is the date its signed bundle was committed to `evidence/v2-host-bundles/` in the spec repository, read from the public history (`git log --diff-filter=A`), never from `generatedAt` inside the bundle, which nothing signs; a later re-certification replaces the file and does not move the anchor. `evidence/v1-end-of-support.json` is the computed date and is GENERATED (`scripts/generate-v1-eos-clock.mjs`); `check-removal-dates.mjs` reads it and fails the v1-tree sources of every `v1-end-of-support` row on or after it.

## Profile claim vocabulary (RFC 0169 §C.3; RFC 0155 §A unchanged)

Normative for any public conformance statement:

- An unqualified "OpenWOP conformant" or "OpenWOP compatible" statement MUST mean `openwop-core-standard`, the executable floor, never the discovery predicate.
- A discovery-only claim MUST say `openwop-discovery-core` and MUST NOT use the same badge as `openwop-core-standard`.
- Every claim MUST state every additional profile it relies on; an omitted profile is an unclaimed one.
- A certification bundle MUST name canonical profile ids; `openwop-core` is deleted (see `capabilities.md`).
- A vendor extension MUST NOT use an `openwop-*` id without an accepted RFC.

## What is `ext/` (RFC 0174 §E.2; RFC 0169 §B.3)

`spec/v2/core/` is under 25,000 words (`scripts/check-core-budget.mjs`). Every `spec/v2/ext/<key>/` document MUST declare `witness` and both maturity axes (`technical`, `adoption`) in its header. A MUST with `witness: unwitnessable` MUST NOT appear in `core/`; a document whose only witness is "deferred to Active → Accepted" enters `ext/` or is deleted. An `ext/` family is advertised only under a wire-legal witness class (see `capabilities.md`).

## What a MUST means (RFC 0168 §B.1; Axiom 1)

Every MUST, SHOULD, and MAY in `core/` is a requirement with an id in `requirements.json` and a `witness` from `witnessable-unaided | witnessable-gated | seam-gated | claims-check | negative-existence`. A seam-gated MUST MUST mint a normative observation path before the cut or is demoted to SHOULD (RFC 0168 §B.3; see `conformance.md`).
