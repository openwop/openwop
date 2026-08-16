# RFC 0152: A2A 1.0 Versioned Composition

| Field | Value |
| --- | --- |
| **RFC** | 0152 |
| **Title** | A2A 1.0 Versioned Composition |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-16 later (S15, suite 1.112.0: dual-era `A2AFakePeer` at 1.0; `a2a-1-0-agent-card`, `a2a-card-runtime-consistency`, `a2a-1-0-task-roundtrip`, `a2a-peer-authority` legs; correction: openwop-app passes §A only — its §B legs are `blocked`, no invoke seam). 2026-08-16 (§C/§D/§E prose landed in `spec/v1/a2a-integration.md` §"A2A 1.0 versioned composition" — pinned to A2A 1.0.0 (2026-03-12): Agent Card projection table, JSON-RPC-at-1.0 interface floor (G4/UQ3), the D.1–D.7 translation tables (operations, Message, Part/Artifact, Task/TaskState with the stored-vocabulary bijection, streaming, configuration/push, errors), identity/no-enumeration rules, `a2a-0.3-legacy` named and time-bounded to 2027-03-12 (UQ1 date), `interop_version_unsupported` error code, seam §22 catalogued. Not landed: a 1.0-shaped fake peer, the seven named scenarios, the two unregistered invariants, a real upstream peer, the 0.3 adopter inventory.) 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** the A2A 1.0 profile, its legacy-deprecation window, and validation against a real upstream peer.) |
| **Affects** | `spec/v1/a2a-integration.md`, `schemas/capabilities.schema.json`, A2A projection schemas, conformance fake/real peers, RFC 0100, `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` A2A 1.0 profile with legacy 0.3 deprecation |
| **Supersedes** | Unqualified A2A support and A2A 0.3 as the current profile |
| **Superseded by** | — |

## Summary

This RFC adds an exact `a2a-1.0` composition profile, requires A2A version signaling and current Agent Card/interface projection, and renames existing 0.3 behavior as `a2a-0.3-legacy`. Hosts may support both during migration, but must not advertise generic A2A compatibility without declaring supported interfaces and versions.

## Motivation

OpenWOP's A2A mapping targets 0.3. The current A2A 1.0 specification changes interoperability details and requires explicit version handling, including the `A2A-Version` header and `supportedInterfaces`. Unqualified `a2a.supported:true` cannot tell a peer which contract it can safely use.

## Proposal

### §A — Discovery

```diff
 "a2a": {
   "supported": true,
+  "protocolVersions": ["1.0", "0.3"],
+  "preferredVersion": "1.0",
+  "profiles": ["a2a-1.0", "a2a-0.3-legacy"],
   "durableTasks": true
 }
```

An A2A-capable host **MUST** advertise non-empty `protocolVersions` and `preferredVersion` present in that array. New hosts **SHOULD** prefer `1.0`. Legacy-only hosts advertise `profiles:["a2a-0.3-legacy"]`; `supported:true` without versions becomes deprecated and cannot substantiate current-A2A claims.

### §B — Version negotiation

For A2A 1.0 requests, the sender **MUST** send `A2A-Version: 1.0`; the receiver **MUST** validate it according to A2A 1.0. Unsupported versions **MUST** fail with the upstream-defined version error projected through the canonical OpenWOP interop error envelope when the failure crosses an OpenWOP boundary. A host **MUST NOT** silently downgrade an authenticated request. Policy-forbidden downgrade fails closed and emits a content-free negotiation audit event.

### §C — Agent Card and interface projection

OpenWOP's A2A endpoint **MUST** publish an A2A 1.0-conformant Agent Card and `supportedInterfaces` for the actual transports it serves. OpenWOP capability projection **MUST NOT** invent an interface absent from the card. Identity, skills, auth schemes, streaming, push, and durable-task flags **MUST** be derived from the same source used by runtime routing.

### §D — Task and event mapping

The child implementation specification **MUST** provide a field-by-field translation table for A2A 1.0 message, task, status, artifact, streaming, and push structures to OpenWOP run/event/interrupt constructs. Unknown upstream fields **MUST** remain opaque and **MUST NOT** become authority, prompts, tool calls, or workflow variables without a declared mapping. Durable tasks retain RFC 0100 persistence, replay, and push-SSRF invariants.

### §E — Identity and security

A2A authentication establishes a peer principal; it does not grant OpenWOP authorization. Tenant, workspace, scopes, delegated actor, and audience **MUST** be resolved and authorized at the OpenWOP boundary. Push URLs remain SSRF-validated. Version downgrade, card/runtime drift, cross-tenant task lookup, and artifact content leakage receive threat-model coverage.

Add invariants `a2a-version-no-silent-downgrade`, `a2a-card-runtime-consistent`, and `a2a-peer-no-authority-escalation`.

## Compatibility

Additive discovery fields and profile. A2A 0.3 continues under an exact legacy name for a proposed 12-month window after A2A 1.0 acceptance. Existing `a2a.supported:true` remains parseable but cannot support “current A2A” claims after the migration window. Removal of 0.3 is v2 or a separately justified upstream-security safety fix.

## Conformance

New scenarios:

- `a2a-1.0-agent-card.test.ts`;
- `a2a-1.0-version-header.test.ts`;
- `a2a-1.0-task-roundtrip.test.ts`;
- `a2a-1.0-stream-push.test.ts`;
- `a2a-version-downgrade.test.ts`;
- `a2a-card-runtime-consistency.test.ts`; and
- `a2a-peer-authority.test.ts`.

Shape tests use official A2A 1.0 fixtures. Behavioral acceptance requires at least one real upstream A2A 1.0 peer in addition to the fake peer. Scenarios gate on the exact profile; claiming `a2a-1.0` makes them mandatory in strict certification.

## Alternatives considered

1. Update prose from 0.3 to 1.0 without versioned profiles. Rejected: future changes recreate ambiguity.
2. Replace 0.3 immediately. Rejected: unknown adopters need a migration window.
3. Let HTTP content negotiation infer the version. Rejected: A2A defines explicit version signaling.
4. Do nothing. Rejected: current-peer interoperability and claims are inaccurate.

## Unresolved questions

1. Exact 0.3 adopter population and ~~deprecation date~~. **Date resolved 2026-08-16:** 2027-03-12 (`a2a-integration.md` §A). Population still unknown (G1).
2. Which official A2A SDK/peer becomes the CI real-peer witness?
3. ~~Which A2A 1.0 interface variants are mandatory for OpenWOP's floor?~~ **Resolved 2026-08-16:** the JSON-RPC binding at 1.0 is the floor for the `a2a-1.0` profile; HTTP+JSON and gRPC are optional additional `supportedInterfaces` (`a2a-integration.md` §C; gap G4 closed).
4. ~~How are upstream error details redacted in OpenWOP audit events?~~ **Resolved 2026-08-16:** they are not redacted in place — they are dropped. Only the closed upstream `reason` (and `supportedVersions[]` for version errors) is projected; the boundary envelope is `interop_version_unsupported` / the D.7 table, and `message` never carries the peer's body (`a2a-integration.md` §D.7).

## Implementation notes (non-normative)

Generate the translation table from the pinned A2A 1.0 schema where possible. Do not hand-copy upstream types into multiple repositories. This RFC is SR-5 under RFC 0147.

## Acceptance criteria

- [ ] A2A 1.0 profile, discovery schema, and complete translation table land. (Discovery schema landed — `protocolVersions`/`preferredVersion`/`profiles` on the `a2a` family, with `versioned-composition-profiles.test.ts`. **Shape only.** 2026-08-16: **the profile prose and translation table landed** — `spec/v1/a2a-integration.md` §"A2A 1.0 versioned composition" §A–§E, D.1–D.7 field-by-field, pinned to A2A 1.0.0. Carried: nothing on this item except that the prose is witnessed only through the §B negotiation legs; §C/§D have no 1.0-shaped peer to run against.) (Formerly: nothing had landed. The RFC text is the only specification of this surface; no schema, no spec prose, no conformance. Status is `Accepted` per the corpus's own bar, which RFC 0147 §A.10 forbids citing as evidence the gap is closed.)
- [ ] Version header, downgrade, card/runtime, identity, durable task, streaming, and push tests pass. (**Version-header and downgrade witnesses now exist**: `a2a-version-negotiation.test.ts`, driven against `A2AFakePeer` with header capture. 2026-08-16 (suite 1.112.0): the fake peer is dual-era and the **card/runtime** (`a2a-card-runtime-consistency`), **identity** (`a2a-peer-authority`), and **durable-task/1.0 roundtrip** (`a2a-1-0-task-roundtrip`) legs exist, all gated on `a2a.profiles ∋ a2a-1.0` (or the §B advert + seam scenario) — `blocked` on today's 0.3 hosts, witnesses the day one flips. Carried: streaming and push legs (the peer honestly does not stream). The invoke seam is now catalogued (`host-sample-test-seams.md` §22); openwop-app's live origin passes the §A leg and has NOT wired the seam, so its §B legs are `blocked` — corrected 2026-08-16 from an earlier "passes §A/§B".)
- [ ] Real upstream A2A 1.0 peer passes in CI. (Carried, and externally gated: it needs a reachable upstream A2A 1.0 peer, which is not a corpus deliverable.)
- [ ] Legacy 0.3 profile and deprecation runbook published. (2026-08-16: **named and time-bounded** — `a2a-0.3-legacy` is defined as the pre-2026-08-16 body of `a2a-integration.md`; hosts SHOULD NOT advertise it after 2027-03-12 (A2A 1.0.0 published 2026-03-12 + the 12-month window). Carried: the deprecation *runbook* (what a 0.3-only host does on that date) is one paragraph in §A, not a runbook; and the adopter inventory (G1) is unknown.)
- [ ] Threat models, invariants, SDKs, interop matrix, and CHANGELOG updated. (Carried with the profile above.)

## References

- RFC 0100 and RFC 0147 Workstream 5
- [A2A Protocol 1.0 specification](https://a2a-protocol.org/latest/specification/)
- `spec/v1/a2a-integration.md`

