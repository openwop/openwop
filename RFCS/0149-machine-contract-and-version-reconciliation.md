# RFC 0149: Machine-Contract and Version Reconciliation

| Field | Value |
| --- | --- |
| **RFC** | 0149 |
| **Title** | Machine-Contract and Version Reconciliation |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-11 |
| **Affects** | `api/openapi.yaml`, `api/asyncapi.yaml`, `schemas/capabilities.schema.json`, `spec/v1/{capabilities,version-negotiation,profiles}.md`, normative examples, corpus generators and SDK parity gates |
| **Compatibility** | `safety-fix` for machine-contract defects; editorial/additive for examples and authoring lint |
| **Supersedes** | Contradictory base-path, discovery-wrapper, and protocol-version examples |
| **Superseded by** | — |

## Summary

This RFC reconciles OpenWOP's machine contracts so OpenAPI, AsyncAPI, SDKs, prose examples, discovery layout, and protocol-version grammar resolve to one canonical interpretation. It removes the duplicated OpenAPI `/v1` base, validates every normative example, standardizes `protocolVersion` as major.minor, and adds authoring-time typo detection without closing forward-compatible server-emitted documents at runtime.

## Motivation

The canonical OpenAPI server URL ends in `/v1` while versioned paths also begin `/v1`, so generic resolution yields `/v1/v1/runs`. Normative capability examples still use the prohibited top-level `capabilities` wrapper even though RFC 0073 requires families at the document root. `protocolVersion` is described as semver, accepted with `startsWith('1.')`, and illustrated as `1.0`. Validators pass because they check shape, not cross-artifact intent.

## Proposal

### §A — Canonical URL resolution

```diff
 servers:
-  - url: https://{host}/v1
+  - url: https://{host}
```

All canonical versioned paths remain `/v1/*`; `/.well-known/openwop` remains unversioned. A corpus gate **MUST** resolve every server/path pair and prove exactly one `/v1` segment for versioned operations. SDK operation URLs and AsyncAPI bindings **MUST** match the resolved OpenAPI path.

### §B — Discovery examples and authoring validation

Every OpenWOP discovery example **MUST** place canonical capability families at document root. A top-level property named `capabilities` in an OpenWOP discovery example **MUST** fail authoring CI. Server-emitted discovery remains open at runtime for additive v1 fields. Authoring lint **MUST** reject:

- a legacy `capabilities` wrapper;
- a property within edit distance one of a canonical family unless it is namespaced `x-host-*` or `vendor.*`; and
- a vendor field occupying a canonical reserved name.

The runtime schema **MUST NOT** reject an otherwise legal unknown server-emitted property solely because an older client does not recognize it.

Positive:

```json
{ "protocolVersion": "1.0", "idempotency": { "supported": true } }
```

Negative authoring example:

```json
{ "protocolVersion": "1.0", "capabilities": { "idempotency": { "supported": true } } }
```

### §C — Protocol version grammar

`protocolVersion` **MUST** use ASCII `<major>.<minor>` with no leading zero except zero itself: `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`. `1.0` and `1.12` are valid; `1`, `1.0.0`, `v1.0`, and `01.0` are invalid. Compatibility comparison uses the integer major as the hard boundary and minor as the additive contract level. Patch belongs to suite/SDK versions, not the spec version.

Hosts **MUST** advertise the highest protocol minor they implement. Consumers **MUST** reject a different unsupported major and **MUST** tolerate a higher minor under v1 additive rules while capability-gating optional behavior.

### §D — Lifecycle coherence

The corpus generator **MUST** fail when an `Accepted` RFC retains an unresolved acceptance blocker not explicitly carried to a register/known-limit, or when a Stable/FINAL spec describes its owning RFC as pending acceptance. Normative examples **MUST** be extracted into fixtures and validated against the same schemas used by conformance.

### §E — Security

Add invariant `discovery-canonical-family-no-shadow`: a vendor extension **MUST NOT** shadow or wrap a canonical capability family in a way that changes negotiation. This is structural and server-free. No discovery example may contain credentials or tenant data.

## Compatibility

The OpenAPI base correction describes the already normative endpoints and is a safety defect repair for generators; it does not move a real endpoint. Hosts that accidentally served `/v1/v1/*` MAY retain a non-normative redirect during migration. Example corrections and lifecycle lint are non-wire changes. The major.minor grammar codifies the dominant wire shape; the suite first warns on legacy `1.0.0`, then enforces after the 90-day safety window. Runtime discovery stays open, preserving v1 forward compatibility.

## Conformance

New scenarios:

- `openapi-resolved-paths.test.ts`;
- `openapi-asyncapi-sdk-parity.test.ts`;
- `capability-example-root-layout.test.ts`;
- `discovery-canonical-family-no-shadow.test.ts`;
- `protocol-version-grammar.test.ts`; and
- `rfc-lifecycle-coherence.test.ts`.

All are server-free and always-on. Fixtures cover valid root discovery, wrapper, typo, vendor extension, version grammar, and every extracted normative example. SDK repositories consume a generated canonical operation-path manifest.

## Alternatives considered

1. Remove `/v1` from every OpenAPI path. Rejected: it would make path keys disagree with actual endpoints and AsyncAPI organization.
2. Close discovery with `additionalProperties:false`. Rejected for v1 server-emitted forward compatibility.
3. Keep semver patch in `protocolVersion`. Rejected: the corpus version axis is major.minor and examples/behavior use it.
4. Do nothing. Rejected: green validators produce incorrect clients and contradictory examples.

## Unresolved questions

1. Which generators or clients have implemented a workaround for `/v1/v1`?
2. What edit-distance rule avoids false positives for legitimate extension names?
3. Is a temporary `1.0.0` normalization warning required for any deployed host?
4. Which stale lifecycle statements are intentional historical notes rather than defects?

## Implementation notes (non-normative)

Land the URL-resolution test before the YAML correction to prove it red. Example extraction should preserve source file/line in failures. This RFC is SR-2 under RFC 0147.

## Acceptance criteria

- [ ] OpenAPI paths resolve correctly and match AsyncAPI/SDKs.
- [ ] All normative discovery examples use root layout and validate.
- [ ] Authoring lint catches wrappers, canonical typos, and shadows without closing runtime discovery.
- [ ] Version grammar and migration warning land.
- [ ] Lifecycle coherence gate passes across the corpus.
- [ ] CHANGELOG, SDK path manifest, and version-negotiation runbook updated.

## References

- RFC 0073, RFC 0094, RFC 0144, RFC 0146
- `spec/v1/capabilities.md` §Document-root layout
- `spec/v1/version-negotiation.md`
- `COMPATIBILITY.md` §§2–3
- RFC 0147 Workstream 2
