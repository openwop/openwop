# RFC 0135: Workflow-chain gallery visibility — `internal` chains

| Field             | Value                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0135                                                                                                                                                                    |
| **Title**         | Workflow-chain gallery visibility — `internal` chains                                                                                                                   |
| **Status**        | `Accepted`                                                                                                                                                                |
| **Author(s)**     | openwop-app maintainers                                                                                                                                                 |
| **Created**       | 2026-07-23                                                                                                                                                              |
| **Updated**       | 2026-07-23 (Draft → Active: manifest schema + spec + conformance landed; Active → Accepted 2026-07-23: openwop-app tier-1 reference host witnessed — vendored schema synced, `lesson-batch` marked `internal: true`, the gallery route + zero-config seeder omit internal chains (host regression legs in `workflow-from-chain-route.test.ts`), and the `workflow-chain-internal-flag` scenario + the RFC 0133 composition scenarios passed non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true` against suite 1.58.0 — rev `e9e0a5ed0`, PR openwop-app#2470)                                                                                                |
| **Affects**       | `schemas/workflow-chain-pack-manifest.schema.json` (§WorkflowChain), `spec/v1/workflow-chain-packs.md`, conformance scenarios                                            |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                       |
| **Supersedes**    | —                                                                                                                                                                       |
| **Superseded by** | —                                                                                                                                                                       |

## Summary

RFC 0133 made chains composable: a chain MAY declare `subChains[]` and dispatch a
sibling chain as a runtime child. That immediately creates a class of chain that exists
**only to be composed** — a child fragment a parent fan-outs over — which is
nevertheless indistinguishable, in the manifest, from a directly-runnable template. A
host's chain gallery (the template picker its builder or run-launcher lists) therefore
shows composition-only children as top-level runnable templates, inviting users to run
half a workflow on its own. The only mitigation today is a naming convention (a
"(… child) — not run on its own" label), which no machine surface can honor.

This RFC adds one OPTIONAL boolean to the manifest's `WorkflowChain`: **`internal`**.
An internal chain is loaded, validated, resolvable, composable, and expandable exactly
like any other chain — but a host's **default template-gallery listing MUST omit it**.
Presentation/discovery semantics only; explicitly **not** an authorization boundary.
Additive — no existing chain changes meaning.

## Motivation

Concrete and current: the openwop-app reference host ships
`openwop-app.kicktodo.challenge-factory`, whose four `build-N` nodes compose the
sibling chain `openwop-app.kicktodo.lesson-batch` (the RFC 0133 flagship). The
lesson-batch child appears in the host's builder gallery and `/` run picker as a
peer template of the factory itself, though running it alone produces a fragment of
the product flow (tracked as gap `CGX-1` in that host's workflows assessment; the
stop-gap is a parenthetical label). Every host that lists chains as instantiable
templates hits the same problem the moment RFC 0133 nesting is used — the manifest
can say "this chain HAS children" but not "this chain IS a child, don't list it."

## Proposal

### Wire shape change (`schemas/workflow-chain-pack-manifest.schema.json` §WorkflowChain)

One new OPTIONAL property:

```diff
 "WorkflowChain": {
   "type": "object",
   "properties": {
     "chainId":  { ... },
     "version":  { ... },
     "label":    { ... },
     "description": { ... },
+    "internal": {
+      "type": "boolean",
+      "description": "When true, this chain is a composition-only fragment (typically an RFC 0133 sub-chain child): hosts MUST omit it from default template-gallery listings while keeping it loadable, resolvable by id, composable, and expandable. Presentational/discovery semantics only — NOT an authorization boundary. Absent ⇒ false (listed)."
+    },
     ...
   },
   "required": ["chainId", "version", "label", "description", "parameters", "dag"],
   "additionalProperties": false
 }
```

### Behavior (RFC 2119)

- A host that presents loaded chains as **instantiable templates** (a builder gallery,
  a run picker, a template catalog endpoint) **MUST omit** chains with
  `internal: true` from that default listing. A host **MAY** offer an explicit
  opt-in view that includes internal chains (an author/admin/debug surface).
- A host **MUST NOT** change any non-presentational behavior on `internal`: the chain
  still loads and validates, `GET`-by-id / expansion / RFC 0013 `from-chain`
  instantiation / RFC 0133 sub-chain composition (`subChainRef` resolution,
  co-expansion, co-registration) all treat an internal chain exactly like a
  non-internal one. In particular a parent chain composing an internal child **MUST**
  keep working unchanged.
- `internal` is **advisory-presentational**. A host **MUST NOT** treat it as an access
  control: a caller that names an internal chain's id directly (from-chain, expansion
  seam, composition) is served normally. Anything security-relevant stays on the
  existing authz surfaces.
- Absent ⇒ `false`. A non-boolean `internal` fails manifest validation
  (`workflow_chain_pack_manifest_invalid`) like any other type violation.

### Examples

Positive — the composition-only child:

```json
{ "chainId": "openwop-app.kicktodo.lesson-batch", "version": "1.0.0",
  "label": "KickTodo — Lesson Batch (Challenge Factory child)",
  "description": "Builds one checkpoint batch of lessons. Composed by the Challenge Factory; not run on its own.",
  "internal": true, "parameters": { "...": "..." }, "dag": { "...": "..." } }
```

Negative — fails validation (non-boolean):

```json
{ "chainId": "acme.child", "internal": "yes", "...": "..." }
```

## Compatibility

**Additive.** A new OPTIONAL property with absent-⇒-false semantics. Every existing
chain (no `internal` key) is byte-identical, lists exactly as before, and replays
identically. A pre-0135 host validating with a stale vendored manifest schema will
reject a pack that carries the field (`additionalProperties: false`) — the standard
additive-field adoption path: hosts adopt by syncing the vendored schema (the F1
lesson), and pack authors SHOULD NOT ship `internal` in packs targeting hosts known
to be pre-0135. Lands in v1.x. No new capability flag — the field is part of the
manifest contract a `workflowChainPacks.supported` host already advertises.

## Conformance

A new scenario `workflow-chain-internal-flag` (server-free, always-on):

- the manifest schema's §WorkflowChain carries a boolean `internal` property;
- a manifest whose chain declares `internal: true` validates;
- a non-boolean `internal` is rejected;
- the spec documents the MUST-omit-from-default-gallery + not-an-authz-boundary rules.

The gallery-omission behavior itself is host-UI/catalog presentation with **no
normative wire listing endpoint**, so it is witnessed at the reference host rather
than over the wire: the openwop-app tier-1 reference host is the witness (the RFC
0132/0133/0134 precedent). The RFC moves **Draft → Active** on the schema/spec/
conformance landing, and **Active → Accepted** once the reference host syncs the
vendored schema, marks its composition-only child (`lesson-batch`) `internal: true`,
its gallery/picker listing omits internal chains (host regression test), and RFC
0133 composition over the now-internal child keeps passing non-vacuously.

## Security

None added. `internal` is presentational; the MUST-NOT-be-authz rule is normative
precisely so no host mistakes it for one (an internal chain's id resolves for any
caller the existing authz would serve). No credentials, egress, or replay surface.

## Unresolved questions

1. **Pack-level `internal` (whole pack hidden)?** Deferred — per-chain granularity
   covers the known cases (a pack typically mixes one public parent with its
   children); a pack-level flag can ride a future revision if a real consumer needs it.
2. **Should `from-chain` refuse a DIRECT user instantiation of an internal chain?**
   Resolved: **no** — internal is presentational, and a tenant deliberately minting
   an editable copy of a child (to customize it) is a legitimate authoring act. The
   gallery omission removes the accidental path; the deliberate path stays open.
