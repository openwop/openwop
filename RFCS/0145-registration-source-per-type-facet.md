# RFC 0145: `registrationSource` as a per-type artifact capability facet

| Field             | Value                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0145                                                                                                                          |
| **Title**         | `registrationSource` as a per-type artifact capability facet                                                                  |
| **Status**        | `Active`                                                                                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts), on a finding from the openwop-app reference host                                              |
| **Created**       | 2026-08-10                                                                                                                    |
| **Updated**       | 2026-08-10                                                                                                                    |
| **Affects**       | `schemas/capabilities.schema.json` (`artifactTypes.types.*`), `spec/v1/artifact-type-packs.md` §"Per-type facets", `spec/v1/host-capabilities.md` §host.artifactTypes |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — one optional facet on a per-type entry; no field becomes required, changes type, or is removed |
| **Supersedes**    | —                                                                                                                             |
| **Superseded by** | —                                                                                                                             |

> **Status note.** `Active`: the corpus change lands with this RFC and the wire shape is locked. `Accepted` waits on a host advertising the facet truthfully — the reference host dropped `registrationSource` from its advert during the RFC 0144 migration precisely because it was undeclared, and asked for it to be declared rather than re-adding it unilaterally. Amends RFC 0075's facet set.

## Summary

`artifact-type-packs.md` §"Schema distribution" makes serving a type's canonical schema URL a **MUST** for host-registered (no-pack) types and only a **SHOULD** for pack-backed ones — because for a host-registered type the served URL is the *only* resolution path. So whether a type is pack-backed or host-native changes what a consumer may rely on. **Discovery does not disclose which.** A consumer either fetches and hopes, or installs the pack to discover there wasn't one. This RFC adds `registrationSource` (`"pack"` | `"host"`) to the per-type facet set, mirroring the field `artifact.created` already carries.

## Motivation

### The asymmetry is normative and currently invisible

`artifact-type-packs.md:87`, verbatim: *"**Serving is a MUST for host-registered (no-pack) types (RFC 0075 / P1-3).** When a host advertises a `schemaVersion` for a type that is **not** backed by an installed pack … the canonical served URL is the _only_ resolution path, so serving it **MUST** be honored … Pack-publishing hosts are unaffected (the schema travels in the tarball; serving stays a SHOULD for them)."*

Two consumers of the same advert therefore have different guarantees available, and no way to tell which one they have:

| Type is… | Schema resolvable via | Serving the canonical URL |
|---|---|---|
| pack-backed | the signed tarball **or** the served URL | SHOULD |
| host-registered | the served URL **only** | **MUST** |

A consumer that needs the schema — a peer host forwarding an artifact, a UI resolving a stored artifact's shape — has to guess which regime applies. Guessing wrong in one direction means fetching a URL that was never promised; in the other, installing a pack that does not exist.

### It is already first-class on the wire

`run-event-payloads.schema.json` `$defs.artifactCreated.registrationSource` is `enum: ["pack", "host"]`, and `artifact-type-packs.md` §"Binding" already requires a host to set it alongside `registered: true`. The concept, the vocabulary, and the normative meaning all exist. **Only the discovery surface is missing** — so a consumer learns the provenance *after* an artifact is created, when what it needed was to know before resolving a schema.

### Why this passes the test `schemaEndpoint` failed

During the RFC 0144 migration the reference host emitted an undeclared top-level `schemaEndpoint` key and asked whether to keep it. It was dropped, on the ground that §"Schema distribution" fixes the canonical URL as `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` — **derivable** from an `artifactTypeId` the consumer must already hold. A discovery key that restates a computable value earns nothing and enshrines one host's invention as protocol surface.

`registrationSource` is the mirror image, and the same test decides it the other way:

- **Not computable.** Nothing in the identifier, the URL convention, or the rest of the advert discloses whether a pack backs the type.
- **It gates a normative difference**, not a convenience — MUST vs SHOULD on the only resolution path.

The host applied that test to itself and dropped its own per-type `schemaUrl` for the same reason it dropped `schemaEndpoint`; it then asked for `registrationSource` to be **declared upstream rather than re-added locally**. That is the correct order, and this RFC is the upstream half.

## Proposal

Add `registrationSource` to the per-type facet set (`artifact-type-packs.md` §"Per-type facets", `host-capabilities.md` §host.artifactTypes), and declare it on the per-type entry in `capabilities.schema.json`:

```jsonc
"artifactTypes": {
  "supported": true,
  "types": {
    "vendor.acme.cad.model": { "validated": true, "registrationSource": "pack" },
    "app.audit":             { "validated": true, "registrationSource": "host", "schemaVersion": 1 }
  }
}
```

### Normative requirements

1. `registrationSource` is **OPTIONAL** and takes exactly `"pack"` or `"host"`, matching `artifact.created.registrationSource`.
2. **Absent ⇒ unspecified provenance**, exactly as on the event. It MUST NOT be read as a default of `"pack"`, and a host MUST NOT be treated as non-conformant for omitting it.
3. A host that advertises `registrationSource` for a type MUST advertise the value it would emit on `artifact.created` for that type. **The two surfaces MUST NOT disagree** — a discovery advert of `"pack"` with an event payload of `"host"` is a false advertisement, not a permitted divergence.
4. Advertising `"host"` for a type does not by itself create the §"Schema distribution" serving obligation — that obligation attaches to advertising a `schemaVersion` for a no-pack type, and is unchanged by this RFC. This facet **discloses** which regime applies; it does not move the boundary.

### What this does NOT do

- **No new obligation.** Every MUST it makes legible predates it.
- **No inference.** A host MUST NOT derive `registrationSource` from an identifier's shape — `vendor.*` does not imply `"pack"`, and a bare legacy id (RFC 0141) implies nothing.
- **No global form.** The facet is per-type only. Provenance is a property of a type, not of a host; a host with both pack-backed and host-native types cannot answer globally, which is the same argument that made the rest of the facet set per-type (RFC 0075 / P1-1).

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. One optional property on the per-type entry object. The entry is `additionalProperties: false`, so declaring the facet is **strictly permissive** — it admits a document that was previously rejected and invalidates none. No existing property changes meaning or type; no error code changes; a host that never advertises it stays conformant with today's semantics (unspecified provenance).

## Conformance

`artifact-type-registration-source.test.ts` — always-on corpus legs:

- the per-type entry declares `registrationSource` with `enum: ["pack","host"]`, and it is **not** required;
- a per-type entry carrying `registrationSource: "host"` validates, and one carrying an out-of-enum value (`"registry"`) does **not** — the enum is load-bearing here, unlike RFC 0136's `format`, because this facet has exactly two meanings and an unrecognised third is a wire error rather than a hint to ignore;
- both prose sites list the facet, so the schema and its normative surface cannot drift apart — the defect RFC 0144 exists to close.

**Deliberately not built:** a leg asserting discovery and `artifact.created` agree (requirement 3). It needs a host that advertises the facet *and* emits a matching artifact; asserting it against a host that advertises nothing would be vacuously green. Carried as G1.

## Alternatives considered

1. **Leave it undeclared; let hosts emit it under `additionalProperties`.** Rejected — the per-type entry is `additionalProperties: false`, so it is not merely undeclared but *forbidden*; and an undeclared field with normative meaning is exactly the defect RFC 0144 was written to close. Re-creating it one RFC later would be self-refuting.
2. **Infer provenance from the identifier.** Rejected — `vendor.acme.*` is a *registry namespace*, not a statement about installation, and RFC 0141 legacy identifiers carry no namespace at all. This is the same wrong-surface inference RFC 0136 requirement 4 forbids for `format`.
3. **A global `registrationSource`.** Rejected — a host with both pack-backed and host-native types would have to advertise a false intersection, which is the argument that made the whole facet set per-type.
4. **Fold into RFC 0144's schema without an RFC.** Rejected, and this is the one worth stating plainly: RFC 0144 declared five families *as their prose already documented them*. `registrationSource` is not in RFC 0075's facet list. Adding it by editing that schema would put a wire field on the wire with no normative surface behind it — the defect 0144 exists to fix, run in reverse.

## Unresolved questions

1. Whether `registered: false` (unregistered) types should be expressible here at all. Today they cannot appear in `types` meaningfully — the facet set describes registered behaviour — and the unregistered tier is deliberately first-class and un-advertised. Left alone.
2. Whether a future facet should disclose *which* pack backs a type (name + version) rather than only that one does. Deferred: it is a larger surface, and the MUST/SHOULD asymmetry this RFC closes does not depend on pack identity.

## Open spec gaps

| ID | Gap |
|---|---|
| G1 | **Cross-surface agreement (requirement 3) is unwitnessed.** No leg asserts that a host's advertised `registrationSource` matches what it emits on `artifact.created`. It needs a host advertising the facet *and* emitting a matching artifact; built against a host advertising nothing, it would be vacuously green. Closes when a host advertises the facet — the reference host is the intended first. |
| G2 | **Vendored-schema staleness is silent.** The reference host discovered during the RFC 0144 migration that its vendored `capabilities.schema.json` was 7 properties behind the corpus, so it had been validating against a contract that predated the declaration it was checking. A declaration only helps if the copy checked against is current, and nothing warns either way. Not specific to this RFC; recorded because this RFC adds one more property that a stale copy will silently miss. Sibling of RFC 0144 G3. |

## References

- `spec/v1/artifact-type-packs.md` §"Schema distribution — source of truth and runtime mirror" (:87) — the MUST/SHOULD asymmetry this facet discloses
- `spec/v1/artifact-type-packs.md` §"Per-type facets (RFC 0075 / P1-1)" — the facet set amended
- `schemas/run-event-payloads.schema.json` `$defs.artifactCreated.registrationSource` — the existing wire vocabulary this mirrors
- RFC 0144 — declared `artifactTypes`; this RFC adds a facet to it through prose first, per RFC 0144 §A's rule
- openwop-app `e65ff6888` (2026-08-10) — the migration that dropped the undeclared field and raised the ask
