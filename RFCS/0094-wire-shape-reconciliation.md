# RFC 0094: Wire-shape reconciliation — schema/prose defect repairs and forward-compat closure policy

| Field | Value |
|---|---|
| **RFC** | 0094 |
| **Title** | Repair the wire-shape defects found in the 2026-06-11 corpus review: the unsatisfiable `createRun` request schema, the missing `cancelling` run status, the closed `RunEventType` enum that contradicts the documented ignore-unknown policy, the three-way `ai.message.chunk` payload drift, the incomplete `InterruptPayload.kind` union, the universal-envelope-kinds vs `openwop-core` profile contradiction, the missing `capabilities.grpc` and `limits.maxRequestBodyBytes` schema surface, and a documented schema-closure policy in `COMPATIBILITY.md` |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-11 |
| **Updated** | 2026-06-11 (`Draft → Active` — comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus during the bootstrap phase (waiver recorded in the `MAINTAINERS.md` ledger). Every item repairs a surface that is today self-contradictory or unimplementable as published; in each case the resolution adopts the reading that the majority of the corpus' own sources already state.) |
| **Affects** | `api/openapi.yaml` (`createRun` request composition, `info.version`) · `api/asyncapi.yaml` (`ai.message.chunk` `$ref`, `info.version`, self-description, heartbeat channel address, mixed-mode note) · `schemas/run-options.schema.json` · `schemas/run-snapshot.schema.json` (`cancelling`) · `schemas/run-event.schema.json` (vendor-event branch, closure) · `schemas/run-event-payloads.schema.json` (`outputChunk` required set) · `schemas/capabilities.schema.json` (`grpc` block, `limits.maxRequestBodyBytes`) · interrupt-kind enumeration (schema + `spec/v1/interrupt.md`) · `spec/v1/ai-envelope.md` (universal-kinds gating) · `COMPATIBILITY.md` (schema-closure policy) · `spec/v1/registry-operations.md` / OpenAPI scope note · conformance scenarios · `CHANGELOG.md` |
| **Compatibility** | `additive` / defect repair (see §Compatibility — each item either accepts strictly more inputs than before or repairs a shape no implementation could have satisfied as published) |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

The 2026-06-11 corpus review found that several published wire artifacts disagree with each other or with themselves: the `createRun` request schema rejects every documented request body (two `additionalProperties: false` branches inside one `allOf`), the `cancelling` status documented in `rest-endpoints.md` and OpenAPI cannot be represented by `run-snapshot.schema.json`, the closed `RunEventType` enum makes schema-validating clients reject the additive/vendor events that `COMPATIBILITY.md` and `version-negotiation.md` order them to ignore, the `ai.message.chunk` payload has three disagreeing definitions, the `InterruptPayload.kind` union omits four kinds the same document defines, `ai-envelope.md` requires universal kinds that `profiles.md` permits `openwop-core` hosts to omit, and `grpc-transport.md` (Stable) mandates a `capabilities.grpc` advertisement that does not exist in the capabilities schema. This RFC repairs each surface, adopting in every case the reading the majority of the corpus already states, and writes down the schema-closure policy whose absence let the drift accumulate.

## Motivation

Each defect is a live interop hazard: a strictly-validating client cannot create a run, cannot deserialize a snapshot mid-cancel, and hard-fails on the first additive event a v1.x host emits; two hosts implementing `ai.message.chunk` from different sources emit incompatible payloads; a host cannot conformantly advertise the Stable gRPC transport at all. None of these can be fixed editorially because each requires choosing which of the disagreeing sources wins — that choice is this RFC.

## Proposal

### A. `createRun` request composition (`api/openapi.yaml`, `schemas/run-options.schema.json`)

Remove `additionalProperties: false` from both `allOf` branches (the inline request object and `run-options.schema.json`); close the **composed** request schema with `unevaluatedProperties: false` (JSON Schema 2020-12). Validated effect: every documented request body passes; undeclared properties still fail at the composed level. Standalone `run-options.schema.json` becomes open at its own root; the closure now lives at the composition site, which is the only place 2020-12 can express it.

### B. `cancelling` run status (`schemas/run-snapshot.schema.json`)

Add `"cancelling"` to the `status` enum. `rest-endpoints.md` and OpenAPI already document the transition; the snapshot schema was the omission. A snapshot read during the cancel cascade is now representable.

### C. `RunEventType` forward-compat (`schemas/run-event.schema.json`)

The `type` field becomes `anyOf: [<the existing closed enum>, <vendor-extension pattern per host-extensions.md's vendor event naming convention>]`, and the event object's closure is relaxed per §G (server-emitted ⇒ open). The enum remains the authoritative catalog of protocol-owned types; the pattern branch admits only correctly-prefixed vendor events. This aligns the schema with `COMPATIBILITY.md` ("Clients MUST ignore unknown event types") and `version-negotiation.md` ("readers ignore unknown").

### D. `ai.message.chunk` single-sourcing (`schemas/run-event-payloads.schema.json`, `api/asyncapi.yaml`)

`$defs/outputChunk` becomes `required: ["nodeId", "runId", "chunk", "isLast"]`, retaining optional `channel`. AsyncAPI's hand-copied inline payload is replaced by a `$ref` to the schema. Rationale: two of the three published sources (AsyncAPI and `stream-modes.md`, which calls `{nodeId, runId, chunk, isLast}` the minimum compliant payload) already required the full set; the standalone schema was the defective restatement.

### E. `InterruptPayload.kind` completion (interrupt schema surface + `spec/v1/interrupt.md`)

The `kind` union is extended to the eight kinds `interrupt.md` actually defines: `approval | clarification | external-event | custom | conversation.start | conversation.exchange | conversation.close | low-confidence`, wherever the union is enumerated (prose union, event-payload schema, and the doc's "four `kind` discriminators" status line). Conversation kinds remain gated on the conversation capability per `capabilities.md`'s refusal contract.

### F. Universal envelope kinds vs `openwop-core` (`spec/v1/ai-envelope.md`)

The universal-kinds clause is scoped: the four universal kinds MUST appear in `supportedEnvelopes` **on hosts that advertise envelope support (non-empty `supportedEnvelopes`)**. `openwop-core`'s empty-`supportedEnvelopes` carve-out in `profiles.md` stands. A host that advertises any envelope kind without the universal four remains non-conformant.

### G. Schema-closure policy (`COMPATIBILITY.md`)

New subsection "Schema closure": **client-submitted** shapes are closed (`additionalProperties`/`unevaluatedProperties: false` at the outermost composition) so typos fail fast; **server-emitted** shapes are open so v1.x hosts can add optional fields per §2.1 without breaking validating clients. Applied in this RFC to the central server-emitted shape that violated it (`run-event.schema.json`); a full sweep of the remaining server-emitted schemas is a named follow-up, not silently included.

### H. Missing capabilities surface (`schemas/capabilities.schema.json`)

1. `capabilities.grpc` block exactly as `grpc-transport.md` mandates: `{ supported: boolean, service: string (const "openwop.v1.Engine" for v1), tls: <the doc's enumeration> }` (additive, optional — absent ⇒ no gRPC transport).
2. `limits.maxRequestBodyBytes` (integer, optional) — `capabilities.md` documented it as optional v1, but the closed `limits` object made advertising it a validation failure.

### I. Editorial alignments folded in (non-normative)

`info.version` in both `api/openapi.yaml` and `api/asyncapi.yaml` bumped from `1.0` to the corpus version `1.1.0`; AsyncAPI self-description "3.0" corrected to 3.1.0; the AsyncAPI heartbeat channel address aligned with the heartbeat surface actually defined in `host-capabilities.md`; a mixed-mode (comma-list `streamMode`) note added where AsyncAPI bindings imply single values; the production `/v1/packs/*` registry surface's OpenAPI scope clarified per `registry-operations.md` (host-served paths added, or an explicit separate-document scope note if the registry is a distinct service — whichever `registry-operations.md` states).

## Compatibility

- **A** accepts strictly more documents than before (the old composition accepted none — ajv-verified); no valid implementation could depend on the old schema.
- **B, C, E, H** are additive enum/field/branch extensions. B and C affect server-emitted shapes: a client pinned to the old schema was already broken by the documented behavior (`cancelling` transitions, ignore-unknown policy) — the schema moves to match the documented contract, per the same defect-repair rationale as A.
- **D** tightens `required` on an event payload — formally a tightening, but the AsyncAPI document and the normative prose already required the full set; only the standalone schema lagged. No conformance scenario asserts emission without `runId`/`isLast`. Classified defect repair; hosts emitting the schema-minimal payload were already non-conformant against `stream-modes.md`.
- **F** relaxes a MUST for `openwop-core`-only hosts (the direction that un-breaks `profiles.md`) and preserves it everywhere envelopes are advertised.
- **G** is policy documentation plus one schema relaxation (opening `run-event`), which is additive for consumers.

## Conformance

- `grpc-transport.test.ts` (new; gated on `capabilities.grpc`) — advertisement-shape scenario per `grpc-transport.md`.
- `version-fold.test.ts` and `stream-text-fixture.test.ts` (new; consume the previously-orphaned `conformance-version-fold.json` / `conformance-stream-text.json` fixtures).
- `i18n-negotiation.test.ts` (new; gated on `capabilities.i18n`) — closes the i18n coverage gap.
- `spec-corpus-validity` re-validates all schema changes; a satisfiability probe for the composed `createRun` request body is added so the §A defect class cannot silently return.

## Alternatives considered

- **Keep `RunEventType` closed and version the schema per event addition.** Forces a schema release for every additive event and still breaks deployed validators between releases; contradicts the corpus' own ignore-unknown rule.
- **Adopt the standalone schema's minimal `outputChunk` (drop `runId`/`isLast` from required).** Loosening instead of tightening — but it would make the normative prose's "minimum compliant payload" wrong and break consumers that already rely on `isLast` for fold termination (both reference consumers do).
- **Demote `grpc-transport.md` from Stable instead of adding the schema block.** Honest, but the doc's contract is sound and implemented host-side; the schema block was the only missing piece. Demotion would churn status for a defect that is one additive block.
- **Do nothing.** Leaves `createRun` unvalidatable and the event stream un-validatable, which actively punishes the strictest-conforming clients.

## Unresolved questions

None blocking. Named follow-up (not in this RFC): the full server-emitted schema-closure sweep per §G, and a canonical error-code registry (surfaced while pinning RFC 0093 §B's `token_expired`).

## Implementation notes (non-normative)

ajv (2020-12 mode, as used by `spec-corpus-validity`) supports `unevaluatedProperties`. SDK type updates (`cancelling` status, `outputChunk` type) land in the openwop-sdks repo as a follow-up; no SDK change is required for wire compatibility.

## Acceptance criteria

- [x] Schema / OpenAPI / AsyncAPI changes merged; redocly + asyncapi lints green; `spec-corpus-validity` green.
- [x] Spec prose updated (`interrupt.md` kind union, `ai-envelope.md` universal-kinds scope, `COMPATIBILITY.md` closure policy).
- [x] New conformance scenarios landed in `@openwop/openwop-conformance` 1.22.0, capability-gated where applicable.
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] Reference host advertises `capabilities.grpc` (where it serves gRPC) and passes 1.22.0 (tier-2 evidence per `GOVERNANCE.md` §Acceptance evidence tiers); `Active → Accepted` on that evidence.

## References

- 2026-06-11 corpus review (this branch's PR); ajv satisfiability verification of the `createRun` defect.
- RFC 0021/0030–0033 (envelope series), RFC 0031 (discriminated unions), RFC 0058 (`maxRunDurationMs`), RFC 0093 (companion hardening RFC).
- `COMPATIBILITY.md`, `spec/v1/stream-modes.md`, `spec/v1/grpc-transport.md`, `spec/v1/version-negotiation.md`.
