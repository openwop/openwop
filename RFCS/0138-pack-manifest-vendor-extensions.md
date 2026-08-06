# RFC 0138: Vendor-extension hatch on pack manifests

| Field             | Value                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0138                                                                                                                                                                                                                                               |
| **Title**         | Vendor-extension hatch on pack manifests                                                                                                                                                                                                           |
| **Status**        | `Active`                                                                                                                                                                                                                                           |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                     |
| **Created**       | 2026-08-06                                                                                                                                                                                                                                         |
| **Updated**       | 2026-08-06                                                                                                                                                                                                                                         |
| **Affects**       | `spec/v1/node-packs.md`, `spec/v1/host-extensions.md`, all 8 pack-manifest schemas + `schemas/registry-version-manifest.schema.json`, `SECURITY/invariants.yaml`, `SECURITY/threat-model-node-packs.md`, `conformance/src/scenarios/pack-manifest-extensions.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1                                                                                                                                                                                                             |
| **Supersedes**    | —                                                                                                                                                                                                                                                  |
| **Superseded by** | —                                                                                                                                                                                                                                                  |

## Summary

`host-extensions.md` §"Vendor-prefixed namespaces" carries a normative MUST: *"A client receiving an unknown vendor-prefixed field MUST treat it as opaque."* Every pack manifest, however, set `additionalProperties: false` with no pattern escape — so a vendor-prefixed field could not legally exist on a pack manifest at all. **The corpus mandated a behavior for a case it structurally forbade.** This RFC adds an `^(x-|vendor\.)` escape hatch to the root and per-item entry object of all eight pack-manifest schemas plus the registry publication contract, and makes the opacity rule normative rather than advisory — including an explicit definition of what "ignore" means, since "opaque" is the kind of word implementers read as *"store it somewhere for now."*

## Motivation

### The concrete blocker

A tier-1 reference host is blocked migrating `community.openwop.canvas-checklist`, an artifact-type pack carrying an `x-openwop-app.canvas` key (477 bytes, load-bearing — it registers a canvas component catalog). Under `additionalProperties: false` that pack is structurally illegal, so migrating it to the canonical shape would **delete a working feature**. The host's only conformant options were to stop shipping the feature or to stop publishing the pack.

### The contradiction is corpus-wide, not an artifact-type anomaly

A survey of all pack manifests found **not one** carried any `patternProperties` anywhere. The closed posture was uniform, and so was the contradiction.

The requesting host argued from RFC 0071 Phase 2, which permits `vendor.<org>.<kind>` / `x-<kind>` field *types* that other hosts MUST ignore or degrade: *"the corpus already decided extensions are legitimate there. Same RFC, opposite posture on the same question."*

That analogy is **weaker than the host thought**, and it is worth saying why, because accepting it for the wrong reason would license a wider hatch than this RFC grants. A `type` *value* drawn from an open enum is not the same mechanism as an object *property* hatch: an extension `type` value flows through a single, already-typed slot whose degradation contract is fully specified ("degrade to a plain text input"), whereas an extension property adds unbounded new structure to an object with no such contract. The precedent establishes that *extensions are legitimate in pack content*; it does not by itself establish where the hatch belongs or what a consumer owes it.

**The stronger argument is the one the host did not make.** The `host-extensions.md` MUST is not advice — it is a normative requirement on client behavior, and it is unsatisfiable by construction wherever the schema forbids the field it describes. That is a defect in the corpus regardless of whether any host is blocked. The blocked pack is the symptom; the contradiction is the bug.

### Why the spec is the right place

An extension hatch is a wire-shape question. If each host decides independently whether its manifest reader tolerates unknown properties, then "portable pack" stops meaning anything: the same tarball installs on one host and is rejected by another, with no capability flag to predict which. Publishing it is pointless. This has to be settled in the schema, once.

## Proposal

### Wire shape

Add to each in-scope schema, at the manifest root **and** at each kind's per-item entry object:

```diff
   "additionalProperties": false,
+  "patternProperties": {
+    "^(x-|vendor\\.)": {
+      "description": "Vendor / host extension escape hatch (RFC 0138). … SECURITY: an extension value is PACK-AUTHORED, therefore untrusted; \"ignore\" means ignore."
+    }
+  },
```

The hatch takes no `type` constraint: an extension value MAY be any JSON value. Constraining it would be a semantics claim this protocol explicitly declines to make.

### In scope — 9 schemas

| Schema | Root | Per-item entry |
|---|---|---|
| `node-pack-manifest.schema.json` | ✅ | `$defs/PackNode` |
| `workflow-chain-pack-manifest.schema.json` | ✅ | `$defs/WorkflowChain` |
| `prompt-pack-manifest.schema.json` | ✅ | — (entries are `prompt-template.schema.json`, out of scope) |
| `artifact-type-pack-manifest.schema.json` | ✅ | `$defs/ArtifactType` |
| `chat-card-pack-manifest.schema.json` | ✅ | `$defs/Card` |
| `connection-pack-manifest.schema.json` | ✅ | `provider` (single object, not an array) |
| `form-content-pack-manifest.schema.json` | ✅ | `$defs/FormTemplate` |
| `frontend-plugin-manifest.schema.json` | ✅ | `$defs/uiPlugin` |
| `registry-version-manifest.schema.json` | ✅ | — (entries already loose per RFC 0107 G1) |

**On the registry publication contract.** Including it is not incidental. Its per-item content arrays are already carried loosely (RFC 0107 G1), so entry-level extensions passed publication before this RFC — but its **root** was closed. A pack carrying a root-level extension therefore validated against its source manifest and was then rejected at registry `PUT`. That is the same split-brain this RFC exists to close, one layer down, and it was measured rather than assumed (see §Conformance).

**On `frontend-plugin-manifest.schema.json`.** It is the eighth pack kind and it gets the hatch on the same reasoning. It is called out because its name does not carry `-pack-`, which is exactly how it was nearly omitted: the first draft of the conformance scenario enumerated manifests by naming convention and skipped it silently. The scenario now asserts an explicit in-scope count.

### Normative prose (`spec/v1/node-packs.md` §"Vendor extensions on pack manifests")

- A consumer that does not recognize an extension property **MUST ignore it** and **MUST NOT** reject the pack for its presence.
- A registry **MUST NOT** refuse a submission solely because it carries an unrecognized extension property.
- Every other property name remains closed — a misspelled canonical field (`dispalyName`) is still rejected. The hatch admits *declared* extensions, not arbitrary keys.
- Extension properties are **NOT** a versioning or capability-negotiation channel. A host **MUST NOT** infer support for anything from their presence, and **MUST NOT** make correct handling of a canonical field depend on one.

### Trust boundary (normative)

An extension property's value is **pack-authored content** and is therefore **untrusted**, exactly as `form-content-packs.md` §"Trust boundary" treats pack-authored strings. A signature proves authorship, not content safety.

> **"Ignore" means ignore.** A consumer that does not recognize an extension property MUST NOT render it, execute it, interpret it as markup or a templating directive, use it to select a code path, or persist it into a surface where it will later be interpreted. Retaining the raw bytes for round-trip fidelity is permitted; acting on them is not.

This clause is normative rather than advisory by deliberate choice. "Opaque" reads to many implementers as *"store it somewhere for now"* — and a hole that hosts half-honor by stashing untrusted blobs into rendering paths is **strictly worse than having no hatch at all**, because it converts a publication failure (loud, at `PUT`) into an injection surface (silent, at render). Enforced as the `pack-manifest-extension-opaque` invariant.

### Out of scope (deliberate, not oversight)

`agent-manifest.schema.json` (a node pack's `agents[]`) and `prompt-template.schema.json` (a prompt pack's `prompts[]`) are separate contracts with their own compatibility surfaces, not pack-manifest structure. They are listed by name in the conformance scenario's `OUT_OF_SCOPE` map so the exclusion is a stated decision rather than a gap.

### Examples

**Positive** — the motivating pack, now publishable:

```json
{
  "name": "community.openwop.canvas-checklist",
  "version": "1.0.0",
  "kind": "artifact-type",
  "engines": { "openwop": ">=1.1.0 <2.0.0" },
  "artifactTypes": [
    {
      "artifactTypeId": "community.openwop.doc.checklist",
      "schemaRef": "schemas/checklist.json",
      "x-openwop-app.canvas": { "components": ["checklist"] }
    }
  ]
}
```

A host that does not know `x-openwop-app.canvas` installs this pack and ignores the key. It does **not** reject the pack, and it does **not** render the key's contents.

**Negative** — a typo is still a typo:

```json
{ "artifactTypeId": "community.openwop.doc.checklist", "schemaRef": "…", "dispalyName": "Checklist" }
```

Rejected. `dispalyName` matches neither a canonical property nor `^(x-|vendor\.)`, so `additionalProperties: false` still applies.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1, against the §2.2 prohibited list:

| §2.2 clause | Status |
|---|---|
| Required field becoming optional / removed / type-changed | None. No existing property touched. |
| Optional field type-changed | None. |
| Event type shape change | Not applicable — no events. |
| Endpoint request/response contract change | None. `PUT` accepts a strict superset of what it accepted before. |
| `MUST` requirement relaxed | **None — and this is the load-bearing point.** No MUST is relaxed. The `host-extensions.md` opacity MUST is made *satisfiable* for the first time, and a new MUST-ignore obligation is added. The change tightens implementer obligation while loosening schema acceptance. |
| Error code / HTTP status meaning change | None. |

Forward-compatibility guarantees, stated specifically:

- Every manifest valid before this RFC remains valid, byte-for-byte. The hatch adds accepted shapes and removes none. Asserted by a conformance leg, not by inspection.
- A consumer written against the pre-0138 schemas rejects an extended manifest. That is the pre-existing behavior this RFC corrects, not a regression it introduces; such a consumer is not made *newly* wrong.
- No capability flag is required or defined. Extension support is not negotiable and MUST NOT be advertised — a host that "does not support extensions" is simply non-conformant, the same as one that rejects any other valid manifest. Adding a flag would let a host advertise its way out of a MUST.

## Conformance

`conformance/src/scenarios/pack-manifest-extensions.test.ts` — 19 assertions, always-on and server-free (<1s), in three parts:

1. **Coverage.** Every in-scope manifest root carries the hatch, enumerated against an explicit count of 9 rather than a naming glob. A new pack kind that forgets the hatch fails this leg; adding one requires either wiring the hatch or naming the exclusion in `OUT_OF_SCOPE`.
2. **Narrowness.** `x-openwop-app.canvas` and `vendor.acme.rating` validate; `dispalyName` is still rejected; an unextended pack still validates. Plus a cross-schema sweep asserting no hatch pattern anywhere matches a bare canonical-looking key — a pattern widened to `^.*` would pass part 1 and fail here.
3. **Prose.** The corpus states the MUST-ignore, the "ignore means ignore" definition, the pack-authored/untrusted framing, and the not-a-capability-channel rule. The schema alone cannot express "MUST ignore"; without the prose the hatch is just a hole.

**Non-vacuity, verified by sabotage** rather than asserted:

| Sabotage | Result |
|---|---|
| Widen a hatch pattern to `^.*` | 3 failed / 14 passed |
| Remove a hatch entirely | 1 failed / 16 passed |
| Restore | 17 passed |

(Counts from the pre-widening 17-assertion revision; the leg count is now 19.)

The registry split-brain in §Proposal was likewise measured before being fixed — a root-level extension probe against `registry-version-manifest.schema.json` returned `must NOT have additional properties` while an entry-level probe passed.

No capability gate: the hatch is unconditional wire shape, so gating it would be wrong (`conformance/coverage.md` §"Capability-gated scenarios: shape vs behavior" — this is shape).

## Alternatives considered

1. **Do nothing.** Leaves a normative MUST unsatisfiable and forces a shipping host to choose between a working feature and a publishable pack. The contradiction stands on its own merits as a defect; the blocked host only dates it.
2. **Artifact-type only.** Fixes the reported symptom and leaves seven identical contradictions in place, guaranteeing the same report arrives per kind. The closed posture was uniform, so the fix should be. Rejected.
3. **`additionalProperties: true` on manifests.** Simpler, and much worse: it discards typo detection, which is `additionalProperties: false`'s real job. `dispalyName` silently becoming a no-op is a worse failure than a rejected pack. Rejected.
4. **A registered-extensions registry** (hosts reserve namespaces à la RFC 0043). Real benefits — collision avoidance, discoverability — but it makes shipping an extension a governance transaction, which is precisely the friction `x-` prefixes exist to avoid, and it does not resolve the contradiction any faster. Compatible as a future layer if collisions ever materialize; not a prerequisite. Deferred, not rejected.
5. **A `host.packExtensions.supported` capability flag.** Rejected on the reasoning in §Compatibility: it would let a host advertise its way out of a MUST.

## Unresolved questions

1. **Collision policy.** Two vendors could both claim `x-canvas`. This RFC does not arbitrate. `host-extensions.md` recommends `private.<host>.*` for host-internal namespaces, which sidesteps it for the disciplined; alternative 4 is the escalation if collisions become real.
2. **Size bounds.** No cap is placed on an extension value. `SECURITY/threat-model-node-packs.md` already bounds total tarball and manifest size, which transitively bounds this, so a per-property cap looked like duplicated policy at a second, driftable location. If a registry reports manifest bloat traceable to extensions, revisit.
3. **Round-trip fidelity.** The RFC permits retaining raw bytes but does not *require* a host to preserve extensions across install → re-export. Requiring it would be a real interop property; it needs a host that actually round-trips packs to validate the requirement against, and none does today.
4. **`prompt-template.schema.json` / `agent-manifest.schema.json`.** Out of scope here (§Out of scope). Whether they need the same treatment is a live question that should be answered by their owners, not assumed by this RFC.

## Implementation notes (non-normative)

The schema change is mechanical; the prose is the substance. The single-highest-value review target is the "ignore means ignore" blockquote — a host that reads the hatch as permission to stash pack-authored blobs into a rendering path has made things worse than before this RFC landed.

Sequencing: the hatch is inert until a host publishes an extended pack, so nothing depends on host uptake. The requesting host can migrate `community.openwop.canvas-checklist` as soon as the schemas ship.

### On the persisted-`artifactTypeId` constraint raised alongside this RFC

The requesting host raised a related but **separate** blocker: the canonical namespace pattern applies to `artifactTypeId` too, and `RunArtifactRecord.artifactTypeId` is a persisted field, so migrating `doc.one-pager` / `brand.kit` to reverse-DNS form would edit durable data.

**This RFC does not solve that, and should not be read as doing so.** The extension hatch is about *unknown property names*; the `artifactTypeId` constraint is about the *value* of a canonical, required, persisted field. They are different problems that happen to block the same migration.

The position this RFC takes: a data migration of persisted `artifactTypeId` values is a **host-side** concern, and one this protocol will not require. A host may legitimately (a) migrate durable rows behind a backfill, (b) keep an alias map from legacy ids to canonical ones at its own boundary, or (c) publish under canonical ids while continuing to serve legacy ids internally. None of these needs protocol surface. What the protocol *does* owe that host is an explicit statement that its legacy ids were never wire-conformant, so option (c) is a host-internal compatibility shim and not a conformance claim — which is a prose gap worth its own RFC, filed by whoever owns RFC 0071. Recorded here so the constraint is answered rather than silently inherited.

## Acceptance criteria

- [x] Spec text merged (`node-packs.md` §"Vendor extensions on pack manifests"; `host-extensions.md` cross-link at the contradiction site)
- [x] All 8 pack-manifest schemas + the registry publication contract updated
- [x] Conformance scenario covering the new surface, non-vacuity sabotage-verified
- [x] SECURITY invariant `pack-manifest-extension-opaque` + threat-model row, landing in the same PR as the MUST-NOT it enforces
- [x] CHANGELOG entry
- [ ] Reference host implements — the requesting host has stated it will implement the host side once this RFC number lands

## References

- `spec/v1/host-extensions.md` §"Vendor-prefixed namespaces" — the MUST this RFC makes satisfiable
- `spec/v1/node-packs.md` §"Vendor extensions on pack manifests" — the normative text added here
- `spec/v1/form-content-packs.md` §"Trust boundary" — the pack-authored/untrusted precedent (RFC 0137)
- RFC 0071 — artifact-type + chat-card packs; source of the `vendor.<org>.<kind>` / `x-<kind>` field-type precedent examined in §Motivation
- RFC 0107 — the registry publication contract and its G1 loose-carriage pattern
- RFC 0117 — front-end plugin packs (`frontend-plugin-manifest.schema.json`)
- `SECURITY/invariants.yaml` — `pack-manifest-extension-opaque`, `form-content-pack-string-trust-boundary`
- `COMPATIBILITY.md` §2.1 (additive), §2.2 (prohibited changes)
- Prior art: OpenAPI `x-` specification extensions; JSON-LD `@vocab`; HTTP `X-` headers (and RFC 6648's deprecation of the convention — noted because it argues *against* `x-`, and this RFC keeps it anyway for consistency with the corpus's existing `x-openwop-form` and RFC 0071 precedents rather than minting a third convention)
