# RFC 0021: AI Envelope Primitive

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0021                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Title**         | AI Envelope Primitive — wire shape, universal kinds, Envelope Contract gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Author(s)**     | OpenWOP Working Group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Created**       | 2026-05-18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Updated**       | 2026-05-18 (Active → Accepted: all 6 §7 acceptance-criteria items satisfied. The internal 5/6 were met at filing (DRAFT → FINAL spec, top-level envelope schema, 4 universal-kind payload schemas, conformance scenario, CHANGELOG line). The external 6/6 — third-party host adoption — was closed by MyndHyve at <https://myndhyve-prod.web.app> on 2026-05-18: discovery doc advertises `supportedEnvelopes: ["clarification.request", "schema.request", "schema.response", "error"]` plus matching `schemaVersions` entries; landed via MyndHyve commit `4d475f0b` (workflow-runtime Cloud Run revision `workflow-runtime-00169-5kl`, 100% traffic). Conformance evidence: `OPENWOP_BASE_URL=https://myndhyve-prod.web.app npx vitest run src/scenarios/ai-envelope-shape.test.ts` → 18/18 assertions pass on `9fb9bfc` of this repo, covering schema-compile, positive/negative round-trip validation, advertisement contract, behavioral `acceptEnvelope` pipeline (accept / invalid / gated / breached / trust-normalization paths), and universal-kind allowlist override.) |
| **Affects**       | `spec/v1/ai-envelope.md` (DRAFT → FINAL v1.1) · `schemas/ai-envelope.schema.json` (NEW) · `schemas/envelopes/{clarification.request,schema.request,schema.response,error}.schema.json` (NEW) · `schemas/capabilities.schema.json` (Capabilities.supportedEnvelopes is now schema-defined, not just example-text) · 1 new conformance scenario · CHANGELOG                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Amended by**    | [RFC 0033](./0033-envelope-completion-contract.md) (error-code rename)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Summary

Promotes `spec/v1/ai-envelope.md` from DRAFT v1.x to FINAL v1.1 and closes the long-standing wire-shape gap where 8 v1 surfaces (`capabilities.md` §`supportedEnvelopes`, `capabilities.md` §`schemaVersions`, `capabilities.md` §`limits.{envelopesPerTurn, schemaRounds, clarificationRounds}`, `host-capabilities.md` §`host.aiEnvelope.generate`, `workflow-chain-packs.md` §`envelopeType`, `profiles.md` §`openwop-interrupts`, `host-extensions.md` §"Canonical-prefix table," `positioning.md` line 119) all reference "AI Envelope" as a typed-wire concept without specifying its shape, universal kinds, schema discipline, Envelope Contract gate, dedup/replay semantics, trust-boundary tagging, or redaction invariant.

This RFC lands the canonical `AIEnvelope` JSON Schema + per-payload schemas for the 4 universal kinds (`clarification.request`, `schema.request`, `schema.response`, `error`) + 1 conformance scenario asserting the shape contract. Vendor-namespaced kinds (`vendor.<host>.<kind>`) stay host-extension surface.

## Motivation

The protocol has been advertising envelopes since v1.0 without a wire-shape contract. Hosts have been free-handing implementation details — what's in `payload`, what's required, how `correlationId` interacts with replay, how `meta.contentTrust` propagates through `mcp-integration.md` §"Trust boundary," how `error` (LLM-emitted) is distinguished from `ErrorEnvelope` (host HTTP). Concretely:

- The reference workflow-engine sample at `apps/workflow-engine/backend/typescript/src/routes/discovery.ts:91` advertises `envelopesPerTurn: 32` but the schema for "an envelope" was never published.
- `RFCS/0020-host-mcp-server-composition.md` §A point 2 specifies that MCP `tools/call.arguments` arrive with `runOptions.trustBoundary: 'untrusted'`, but the envelope-level `meta.contentTrust` field that should mirror it had no wire contract.
- `profiles.md` lines 47/63 derive `openwop-interrupts` from `c.supportedEnvelopes.includes('clarification.request')` but didn't specify what's IN a `clarification.request`.

Adopters who needed the envelope shape were either (a) reverse-engineering it from the prose in `host-capabilities.md` §host.aiEnvelope, (b) reading the MyndHyve reference impl source code, or (c) waiting. This RFC unblocks (c) and obsoletes (a) and (b).

## Proposal

### §A — Top-level `AIEnvelope` schema

`schemas/ai-envelope.schema.json` (NEW). JSON Schema 2020-12, `$id` under `https://openwop.dev/spec/v1/ai-envelope.schema.json`, `additionalProperties: false` at the top level. Required fields: `type`, `schemaVersion`, `envelopeId`, `correlationId`, `payload`, `meta`. Optional: `nodeId`, `partial`.

The `meta` block is closed (`additionalProperties: false`) with required `source` ∈ `{ai-generation, user, system}` and `ts` (ISO 8601 UTC), plus optional `contentTrust` ∈ `{trusted, untrusted}`, `traceparent`, `label`. Vendor extensions go under `meta.<vendor>.<key>` per the canonical-prefix table.

### §B — 4 universal-kind payload schemas

Four NEW schemas under `schemas/envelopes/`:

- `clarification.request.schema.json` — `{ questions: Array<{ id, question, schema? }>, contextType? }`. Engine lifts to `kind: "clarification"` `InterruptPayload` per `interrupt.md`.
- `schema.request.schema.json` — `{ envelopeType, reason? }`. Engine responds out-of-band by re-injecting the kind's schema into the LLM context.
- `schema.response.schema.json` — `{ envelopeType, ack: true }`. Side-channel; never surfaces to users.
- `error.schema.json` — `{ code, message, details? }`. LLM-emitted error; distinct from the HTTP-level `error-envelope.schema.json`.

All four schemas have `$id` under `https://openwop.dev/spec/v1/envelopes/<kind>.schema.json`, `additionalProperties: false` on objects, and explicit `required` arrays.

### §C — Capability schema clarification

`schemas/capabilities.schema.json` already declares `supportedEnvelopes: string[]` and `schemaVersions: Record<string, number>`. This RFC does NOT change either declaration; it ONLY documents that:

- The 4 universal-kind strings MUST appear in `supportedEnvelopes` for any host advertising `aiProviders.supported: true`.
- `schemaVersions[<universal-kind>]` MUST be `1` when the host implements the schemas described in §B.

These constraints are advisory in v1.1 (a host that advertises `aiProviders.supported: true` but does not implement envelopes can still claim the capability — only the LLM-call surface). They tighten to mandatory in a future RFC if the ecosystem converges on universal-envelope expectations.

### §D — Conformance

`conformance/src/scenarios/ai-envelope-shape.test.ts` (NEW). Asserts:

1. `/.well-known/openwop` advertises `supportedEnvelopes` as a `string[]` (per existing `capabilities.schema.json`).
2. If the host advertises any envelope kind matching a universal one (`clarification.request`, `schema.request`, `schema.response`, `error`), the corresponding schema is Ajv2020-compileable.
3. The top-level `ai-envelope.schema.json` is itself Ajv2020-compileable + accepts a positive fixture + rejects a negative fixture (missing required field).

Capability-gated: scenarios skip on hosts that don't advertise `aiProviders.supported: true`.

### §E — Trust boundary

The `meta.contentTrust` field (`trusted` / `untrusted`) is the wire-level surface for the trust-boundary propagation introduced in RFC 0020 §D. When a workflow node receives an envelope flagged `untrusted`, downstream content forwarding to LLM surfaces MUST apply the `<UNTRUSTED>...</UNTRUSTED>` marker convention per `SECURITY/threat-model-prompt-injection.md`. The reference `core.openwop.ai@1.1.2` pack honors this end-to-end via `ctx.trustBoundary` propagation.

### §F — Redaction

`SECURITY/threat-model-secret-leakage.md` SR-1 carry-forward applies to envelope payloads: any `[REDACTED:<id>]` marker present in the envelope's source content MUST be preserved by the host's redaction pipeline (no rewriting to `<REDACTED:...>` or `***`). The `secret-leakage-eventlog-payload` invariant test (`conformance/src/scenarios/redaction.test.ts`) covers this when envelopes are projected onto `RunEventDoc`s.

## Compatibility

**Additive per `COMPATIBILITY.md §2.1`.** All claims:

- Existing required fields: unchanged. `capabilities.supportedEnvelopes` was already declared as `string[]`; this RFC ships schemas for the entries — no required-field change.
- Existing optional fields: unchanged.
- Existing event types: unchanged. Envelopes were already implicit in `RunEventDoc.causationId`; this RFC normates their own document shape but doesn't touch the event log.
- Existing endpoints: unchanged.
- Existing MUST requirements: not relaxed.
- Existing error codes: unchanged. The new `error` envelope is the **LLM's** error report; the host's HTTP-level `ErrorEnvelope` (per `error-envelope.schema.json`) is unchanged.

The 4 new universal-kind schemas + the top-level `ai-envelope.schema.json` are NEW additions. Hosts that don't advertise envelope kinds see no behavioral change. Hosts that DO advertise kinds gain a wire-level validation contract they can implement at their own pace.

## Conformance

The single new scenario (`ai-envelope-shape.test.ts`) is capability-gated. It runs ONLY when the host advertises `aiProviders.supported: true` AND its `supportedEnvelopes` array overlaps with the universal-kind set. Hosts that ship `aiProviders` without envelope support stay un-affected.

Acceptance criteria for promoting RFC 0021 to `Accepted` (post-Active):

- [x] `spec/v1/ai-envelope.md` status DRAFT → FINAL v1.1.
- [x] `schemas/ai-envelope.schema.json` ships.
- [x] 4 `schemas/envelopes/*.schema.json` files ship.
- [x] `conformance/src/scenarios/ai-envelope-shape.test.ts` ships.
- [x] CHANGELOG entry under `[Unreleased]`.
- [x] First non-steward host advertises 1+ universal-kind envelope schema (third-party validation gate per `RFCS/0001-rfc-process.md` §"Promotion to Accepted"). Closed 2026-05-18 by MyndHyve at <https://myndhyve-prod.web.app> advertising all 4 universal kinds with conformance pass at 18/18.

## Alternatives considered

1. **Defer to v1.2 / leave as DRAFT.** Rejected — the spec text has been stable since 2026-05-17 and 8 surfaces already depend on the concept. Deferring means more hosts ship implementations that drift before the schema lands.

2. **Ship only `ai-envelope.schema.json` (top-level), no per-kind payload schemas.** Rejected — the value of the universal-kind contract is the payload shape. Without per-kind schemas, hosts implementing `clarification.request` would still need to invent `questions[]` discipline.

3. **Promote `prd.create` / `theme.create` / `tasks.create` to core (universal).** Rejected per the spec text's §"Vendor-namespaced kinds" position — these are domain-specific kinds that belong in vendor namespaces (`vendor.myndhyve.prd.create`). Core v1 only commits to the 4 cross-domain universals.

## Unresolved questions

1. **`schemaVersions[<universal-kind>]` major-version bumps.** When a universal-kind schema gains a required field in v1.2, hosts that pinned `schemaVersions[clarification.request]: 1` need an upgrade path. Standard `additive` rules apply (new fields stay optional). RFC 0021 does NOT introduce a v2 of any kind today.

2. **Partial envelopes (`partial?: PartialInfo`).** The spec marks `partial` as `(in-flight)` — chunking semantics for streaming emissions are not normated by this RFC. Track 11 (Observability) may shape the eventual semantics if streaming envelope reconstruction needs cross-host alignment.

## Implementation notes (non-normative)

- The reference workflow-engine sample already advertises `envelopesPerTurn: 32` but doesn't yet enforce envelope-shape validation on inbound LLM emissions. Wiring `acceptEnvelope` per the spec's `AIEnvelopeAcceptor` interface is a follow-up sample-host task.
- The MyndHyve impl uses `vendor.myndhyve.{prd,theme,tasks}.create` envelope kinds; these stay outside RFC 0021's universal-kind set.
- The 4 universal-kind schemas at `schemas/envelopes/` correspond directly to the TypeScript payload types in `ai-envelope.md` §"Universal kinds (normative)" §163-211.

## References

- `spec/v1/ai-envelope.md` (the prose this RFC promotes).
- `RFCS/0020-host-mcp-server-composition.md` §D (trust-boundary propagation that `meta.contentTrust` exposes).
- `RFCS/0001-rfc-process.md` §"Promotion to Accepted" (third-party adoption gate).
- `SECURITY/threat-model-prompt-injection.md` (UNTRUSTED-marker convention `meta.contentTrust` triggers).
- `SECURITY/threat-model-secret-leakage.md` SR-1 carry-forward (envelope payload redaction invariant).
- `spec/v1/capabilities.md` §`supportedEnvelopes`, §`schemaVersions`, §`limits.{envelopesPerTurn, schemaRounds, clarificationRounds}` (existing surfaces that RFC 0021 closes the wire-shape gap for).
- `spec/v1/host-capabilities.md` §host.aiEnvelope (existing host contract).
- `spec/v1/host-extensions.md` §"Canonical-prefix table" (vendor-namespace discipline for non-universal kinds).
