# RFC 0075: Artifact-Type Packs — real-world adoption amendment (RFC 0071 Phase-1.1 erratum)

| Field | Value |
|---|---|
| **RFC** | 0075 |
| **Title** | Artifact-Type Packs — real-world adoption amendment |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-27 |
| **Updated** | 2026-06-01 (`Active → Accepted`) — graduated on the **non-steward host** MyndHyve, whose live discovery advertises the amendment's per-type facets field-for-field (rev `workflow-runtime-00449-fal @ 100%`, `https://api.myndhyve.ai`; steward-verified 2026-06-01). This RFC codifies what MyndHyve's real RFC 0071 adoption already does: `host.artifactTypes.supported: true` with **7 host-registered artifact types**, each carrying the amendment's facets — `validation: "open"` (the P0-2 MUST→SHOULD relaxation + `validation` field for AI-produced artifacts), `registrationSource: "host"` (P0-1 host-native, no-pack registration), `schemaVersion: 1` (P1-2 `schemaVersions` decoupling), and `validated: true` (P1-1 per-type facet). The amendment required no new MyndHyve code — its AI-native host surfaced these facets when it implemented 0071 — and the server-free `artifact-type-pack-manifest-validation.test.ts` (incl. the new `validation: open|closed` enum) passes on `main`. The P1-3 schema-resolvability MUST for no-pack types is honoured by the `registrationSource:"host"` types serving resolvable schemas. · 2026-05-27 |
| **Affects** | `spec/v1/artifact-type-packs.md`, `spec/v1/host-capabilities.md` §host.artifactTypes, `spec/v1/capabilities.md`; `schemas/artifact-type-pack-manifest.schema.json`, `schemas/run-event-payloads.schema.json`; conformance scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 (one MUST→SHOULD relaxation, otherwise additive) |
| **Supersedes** | — (amends RFC 0071 Phase 1) |
| **Superseded by** | — |

## Summary

RFC 0071 Phase 1 (artifact-type packs) graduated `Active → Accepted` 2026-05-27 on MyndHyve's production adoption (#275) — and implementing it as a *real* host surfaced gaps the spec's design assumptions don't cover: it was written for **deterministic producers distributing signed packs**, but the first adopter is an **AI-native host with built-in artifact types and no packs**. This RFC folds in six adoption-grounded amendments — host-native registration (P0-1), an `additionalProperties:false` MUST→SHOULD relaxation + a `validation` field for AI-produced artifacts (P0-2), per-type capability facets + `validated`/`schemaVersions` decoupling (P1-1/P1-2), a schema-resolvability MUST for no-pack types (P1-3), and a store-only conformance reference host (P2-1). All are additive or MUST→SHOULD relaxations; nothing breaks existing conformance.

## Motivation

The feedback originates from MyndHyve, the first non-steward and first AI-native host to adopt RFC 0071 Phase 1 end-to-end (`docs/openwop-adoption/0071-realworld-adoption-feedback-myndhyve.md`, grounded in `…-myndhyve-adoption-evidence.md`). Two root facts drive the changes: (1) MyndHyve's artifact types are **host-native** (its Canvas Type system predates packs) and it published **no signed packs** — yet it validates + emits `registered: true`; and (2) its 79 artifact schemas carry `.passthrough()` (open) with **zero** `additionalProperties:false`, because strict validation demonstrably rejected valid LLM output in production. The spec is the right place because these are not host bugs — they are the realistic shape of *every* AI-native adopter, and the current letter forces each into either over-publishing or quietly violating a MUST.

This RFC also closes a candor gap in the Phase-1 graduation: the steward accepted `registered: true` for host-native types the spec defined as pack-only, served from URLs the spec only SHOULD-recommended. P0-1 + P1-3 bless and make verifiable what was already accepted.

## Proposal

### P0-1 — Host-native registration tier + `registrationSource` (`artifact-type-packs.md` §"Binding")

Registration gains two tiers: **pack-registered** (matches an installed pack) and **host-registered** (a host-native type validated against a host-known schema, independent of packs). Both are `registered: true`-eligible. The run event gains optional provenance:

```diff
 "artifact.created": {
   "artifactType": "vendor.myndhyve.prd", "registered": true,
+  "registrationSource": "host"   // "pack" | "host"
 }
```

A host MAY emit `registered: true` for a host-registered type **only if** its schema is resolvable (P1-3). `registrationSource` is optional; absent ⇒ existing semantics.

### P0-2 — `additionalProperties:false` MUST→SHOULD + `validation` field (§"The ArtifactType declaration", `schemaRef`)

`schemaRef`'s "MUST set `additionalProperties: false`" relaxes to **SHOULD** (the `$id` requirement stays MUST). **Framing: this corrects an internal inconsistency, not an AI carve-out** — a closed-world artifact contract contradicts the protocol's own forward-compatibility mandate (`COMPATIBILITY.md` §2.1: *consumers MUST ignore unknown fields*). A new optional `validation: "open" | "closed"` field on the `ArtifactType` declaration advertises strictness: `closed` ⇒ a consumer MAY rely on no unknown fields; `open` (recommended for AI/LLM output; the default when absent) ⇒ consumers MUST ignore unknown fields. The host validates emit-time output against the schema as-written; it does **not** maintain a separate strict contract schema (the two-schema split was considered and rejected as overhead the problem doesn't need).

### P1-1 — Per-type capability facets (`host-capabilities.md` §host.artifactTypes)

`host.artifactTypes` gains an optional `types` map keyed by `artifactTypeId`, each entry `{ validated, validation, schemaVersion, store, render, export }` overriding the global object (the fallback). This expresses a heterogeneous fleet ("validate these 7, store the rest") that a host-global object cannot — the literal cause of MyndHyve's forced 16→7 advertisement trim.

### P1-2 — `schemaVersions` is a declaration; `validated` is the guarantee

`schemaVersions["X"] = N` is defined as a **version declaration** ("I know X at version N"), decoupled from the **runtime validation guarantee** carried by the per-type `validated` facet (P1-1). Removes the ambiguity that forced the 16→7 trim.

### P1-3 — Schema-resolvability MUST for no-pack types (§"Schema distribution")

When a host advertises a `schemaVersion` for a type **without** a published pack, serving the canonical `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` URL becomes a **MUST** (was SHOULD). This makes `registered: true` (P0-1) downstream-verifiable. **Byte-identical clause clarified:** the in-tarball/host-served byte-identical requirement applies only when *both* copies exist; a no-pack type ships only the served URL.

### P2-1 — Store-only conformance reference host

Add a `render: false` store-only posture to a reference host (the SQLite reference host) so the store-without-render negotiation guarantee is actually exercised end-to-end, not just soft-skipped against a render-everything host. Steward-side; tracked as a follow-on conformance task.

## Compatibility

**Additive**, with one MUST→SHOULD relaxation (P0-2). Per `COMPATIBILITY.md` §2.1 + §4:

- **P0-1** `registrationSource`, **P0-2** `validation`, **P1-1** `types` — all new optional fields; absent ⇒ prior semantics; consumers ignore unknown fields.
- **P0-2 relaxation** — MUST→SHOULD is backward-compatible: existing strict (`additionalProperties:false`) schemas still conform; the relaxation only *permits* open schemas.
- **P1-2** — a clarification of previously-undefined semantics (additive per §4).
- **P1-3** — tightens SHOULD→MUST **only** for the no-pack case; pack-publishing hosts unaffected. A host advertising a no-pack `schemaVersion` without serving the URL was shipping an unverifiable claim; this closes that hole. (MyndHyve owns the impl cost — serving its 7 schema URLs — and is unblocked to do so by P0-2, which legalizes serving its open schemas.)

No existing required field, type, event-shape, or error code changes. Spec **minor** bump.

## Conformance

- `chat-card-pack-manifest-validation` is unaffected. `artifact-type-pack-manifest-validation.test.ts` gains a positive case asserting the new `validation: "open"|"closed"` field validates.
- The `registrationSource` enum + the `validation` field are exercised by the server-free manifest/run-event schema-validity scenarios (Ajv2020 round-trip).
- **P2-1** lands the store-without-render behavioral coverage end-to-end via the SQLite reference host's `render: false` posture (follow-on).
- The `artifact-schema-compile-bounded` (R1) invariant is unchanged — relaxing `additionalProperties` does not touch compilation bounds.

## Alternatives considered

- **P0-2 bare MUST→SHOULD without the `validation` field.** Rejected: drops the cross-host consumer's ability to know whether to expect a closed shape. The field is one advertised value and is the negotiation hook.
- **P0-2 two-schema split** (strict published contract + lenient host validation schema). Rejected: maintaining two schemas per type is overhead for a closed-world guarantee the protocol rarely needs and §2.1 already discourages.
- **Do nothing.** Rejected: every AI-native adopter would quietly violate the strict MUST and emit unverifiable `registered: true` — encoding the lenient reality is more honest and durable.

## Unresolved questions

1. Should `validation: "closed"` ever be *required* for a type a consumer treats as a cross-host contract, or is advisory-only sufficient? (Current: advisory; default `open`.)
2. P2-1 host choice — SQLite reference host vs. a dedicated conformance harness driving a `render:false` advertisement.

## Implementation notes (non-normative)

- MyndHyve sequences its side: P0-2 lands → it serves its 7 schema URLs (`z.toJSONSchema()` + canonical `$id` injection + a `/schemas/artifacts/:id.schema.json` route) + advertises `validation: "open"` → `registered: true` becomes downstream-verifiable. It will re-run conformance against any revised scenarios.
- README RFC counts + `protocol:status` synced per the adding-RFCs gate.

## Acceptance criteria

- [x] Spec text merged: `artifact-type-packs.md` (P0-1/P0-2/P1-3), `host-capabilities.md` §host.artifactTypes (P1-1/P1-2).
- [x] Schemas: `artifact-type-pack-manifest.schema.json` (`validation`), `run-event-payloads.schema.json` (`registrationSource`).
- [x] Conformance: `validation`-field positive case; `registrationSource` enum round-trip.
- [x] CHANGELOG entry.
- [x] **P2-1** store-only reference host exercises store-without-render end-to-end — the **in-memory reference host** advertises `host.artifactTypes { store:true, render:false }` + the `/v1/host/sample/artifacttypes/{install,produce}` seam; `artifact-type-store-without-render` + `artifact-type-pack-install` PASS against it (steward-verified locally, 2026-05-27).
- [x] MyndHyve serves its host-native schema URLs + advertises `validation: "open"` (host-side, P1-3 close-out) — shipped on rev `workflow-runtime-00398-vup`, steward curl-verified 2026-05-27 (all 7 schema URLs resolve; `registered:true` downstream-resolvable). G3 closed.

## References

- Adoption feedback: `docs/openwop-adoption/0071-realworld-adoption-feedback-myndhyve.md`
- Adoption evidence: `docs/openwop-adoption/0071-artifact-type-packs-myndhyve-adoption-evidence.md`
- Amends: [`RFCS/0071-artifact-type-and-chat-card-packs.md`](./0071-artifact-type-and-chat-card-packs.md)
- Spec: [`spec/v1/artifact-type-packs.md`](../spec/v1/artifact-type-packs.md), [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) §host.artifactTypes
- `COMPATIBILITY.md` §2.1 (forward-compat / ignore-unknown-fields — the basis for P0-2)
