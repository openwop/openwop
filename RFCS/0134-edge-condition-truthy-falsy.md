# RFC 0134: Edge conditions — `truthy` / `falsy` operators

| Field             | Value                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0134                                                                                                                                                                  |
| **Title**         | Edge conditions — `truthy` / `falsy` operators                                                                                                                        |
| **Status**        | `Active`                                                                                                                                                                |
| **Author(s)**     | openwop-app maintainers                                                                                                                                                |
| **Created**       | 2026-07-23                                                                                                                                                              |
| **Updated**       | 2026-07-23 (Draft → Active: wire schema + spec + conformance landed; Active → Accepted gate is the openwop-app reference-host witness of the §B host-mapping leg — RFC 0132/0133 precedent) |
| **Affects**       | `schemas/workflow-definition.schema.json` (§EdgeCondition), `schemas/workflow-chain-pack-manifest.schema.json` (§EdgeCondition, inlined), `spec/v1/workflow-definition.md`, conformance scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                      |
| **Supersedes**    | —                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                      |

## Summary

A `WorkflowEdge.condition` (`EdgeCondition`) routes a target node only when the
condition holds against a source node's output. The wire `EdgeCondition.type` enum is
`["expression", "equals", "notEquals", "contains", "regex"]` — every operator except
`expression`/`regex` compares the `left` path against a `right` operand. There is no
way, over the wire, to express the most common branch shape of all: **"take this edge
iff `left` is truthy"** (an approval gate's `approved` output, a boolean flag, a
present-or-absent field) — or its negation. Hosts that evaluate edges already implement
`truthy`/`falsy` operators internally (they are the natural predicate for a boolean
gate output), but a conformant client cannot emit them and a portable workflow-chain
pack cannot carry them. This RFC adds `truthy` and `falsy` to the `EdgeCondition.type`
enum. Additive — no existing condition changes meaning.

## Motivation

Two concrete, current gaps:

1. **The wire cannot express a boolean branch.** The canonical approval pattern is
   `core.chat.approvalGate` → two conditioned edges: one fires when `approved` is
   truthy (proceed), one when `approved` is falsy (reject). Modelling this over the
   wire today forces `{ type: "equals", left: "approved", right: true }` /
   `{ type: "notEquals", left: "approved", right: true }`. That is a **semantic
   mismatch on the two paths that matter**: `equals true` is `false` for a *skipped*
   upstream (output `undefined`), whereas `falsy` is `true` — and reject-safe barrier
   wiring (a `none_failed` fan-in over a `core.fail` that runs only on the falsy edge)
   depends on the skipped-source path evaluating the way `truthy`/`falsy` do, not the
   way `equals`/`notEquals` do. Authors that need the correct skip semantics have no
   wire operator for it.

2. **Portable chains can't carry it, so real workflows can't convert.** RFC 0013
   workflow-chain packs use the SAME `EdgeCondition` shape (inlined in
   `workflow-chain-pack-manifest.schema.json`). A host expanding a chain maps the wire
   condition to its executor's native condition. The openwop-app reference host's
   mapper supports exactly the wire operators — so a chain **cannot** express a
   truthy/falsy branch, and workflows built on the approval-gate + reject-safe-barrier
   pattern (a challenge-authoring "factory", a multi-channel campaign orchestration)
   are blocked from converting to editable chain packs. This RFC unblocks them.

The operators are not new *behavior* — hosts that route on a boolean gate output
already compute truthiness. RFC 0134 makes the wire able to **say** it, closing a
gap between what hosts do and what the protocol can express.

## Proposal

### Wire shape change (`schemas/workflow-definition.schema.json` §EdgeCondition)

Add two members to the `type` enum. `truthy`/`falsy` take a `left` path and **no**
`right` operand (they test the resolved value of `left` for JS-style truthiness).

```diff
 "EdgeCondition": {
   "type": "object",
   "properties": {
     "type": {
       "type": "string",
-      "enum": ["expression", "equals", "notEquals", "contains", "regex"]
+      "enum": ["expression", "equals", "notEquals", "contains", "regex", "truthy", "falsy"]
     },
     "left": { "type": "string", "description": "Left operand path (e.g., 'status', 'output.approved')." },
     "right": { "description": "Right operand value (any JSON value)." },
     "expression": { "type": "string", "description": "Used when type='expression'." }
   },
   "additionalProperties": false
 }
```

The same two-member addition applies to the **inlined** `EdgeCondition` `$def` in
`schemas/workflow-chain-pack-manifest.schema.json` (RFC 0013 keeps the manifest
self-contained for pack-loader validators), so a chain fragment edge can carry the
operators.

### Behavior (RFC 2119)

- A host that evaluates `EdgeCondition` **MUST** treat `type: "truthy"` as: the edge
  contributes to the target iff the value at `left` (resolved against the source node's
  output, same resolution as the other operators) is **truthy** — i.e. not one of
  `false`, `null`, `undefined`, `0`, `NaN`, `""`, or absent. `type: "falsy"` is its
  exact complement (the edge contributes iff `left` resolves to one of those values, or
  is absent).
- `truthy`/`falsy` **MUST NOT** require `right`; a host **MUST** ignore `right` if
  present on a `truthy`/`falsy` condition (it is meaningless, not an error — forward-compat).
- `left` is **REQUIRED** for `truthy`/`falsy` (as for `equals`/`notEquals`/`contains`);
  a `truthy`/`falsy` condition missing a non-empty `left` is a malformed edge and the
  host **MUST** reject it at ingest/expansion (the existing `chain_edge_condition_invalid`
  / definition-validation path), never silently drop the edge.
- A host that does **not** implement these operators (a pre-0134 host) will reject an
  unknown `type` at schema validation — the additive enum is opt-in per host, and the
  capability is discoverable by the conformance scenario below (no new capability flag;
  the operator set is part of the always-advertised workflow-definition contract, so a
  host claiming v1 workflow support that rejects a `truthy` edge is simply not yet on
  0134).

### Examples

Positive — an approval-gate branch (both edges from the gate node):

```json
{ "from": "approve", "to": "apply",  "condition": { "type": "truthy", "left": "approved" } }
{ "from": "approve", "to": "reject", "condition": { "type": "falsy",  "left": "approved" } }
```

Negative — fails validation (missing `left`):

```json
{ "from": "approve", "to": "apply", "condition": { "type": "truthy" } }
```

## Compatibility

**Additive.** New optional enum members on an existing field. No existing
`EdgeCondition` (which uses one of the five prior operators) changes meaning or
validity. A workflow/chain that does not use `truthy`/`falsy` is byte-identical and
replays identically. Lands in v1.x. A host adopts it by extending its condition mapper;
until it does, a `truthy` edge fails that host's schema validation (honest — the host
does not yet honor the operator, so it must not accept it).

## Conformance

A new scenario `edge-condition-truthy-falsy`:

- **§A (always-on, corpus):** `workflow-definition.schema.json` §EdgeCondition `type`
  enum contains `truthy` and `falsy`; the manifest schema's inlined `EdgeCondition`
  matches; the spec (`workflow-definition.md`) documents the no-`right` semantics + the
  required-`left` rule.
- **§B (capability-gated on the host actually expanding/evaluating conditions):** a
  workflow-chain pack whose fragment carries a `truthy` and a `falsy` edge off one
  approval-gate node instantiates through `from-chain` and the expanded
  `WorkflowDefinition`'s edges carry the mapped host-native truthy/falsy conditions
  (the reference host's `edgeConditionMapping` maps `truthy → truthy`, `falsy → falsy`);
  a `truthy` edge missing `left` is refused `chain_edge_condition_invalid`.

Reference-impl-tier witness (the RFC 0132/0133 precedent): the openwop-app tier-1
reference host is the witness. The RFC moves **Draft → Active** on the schema/spec/
conformance landing, and **Active → Accepted** once the reference host maps the
operators and the §B scenario passes non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`.

## Security

None. Edge conditions carry no credentials and route control flow only; `truthy`/`falsy`
add no evaluation power beyond the existing operators (they are a strict subset of what
`expression` could already express on hosts that implement it). No SSRF/egress/secret
surface. The required-`left` fail-closed rule preserves the existing "never a silently
dead edge" invariant.

## Unresolved questions

1. **`right` on truthy/falsy — ignore vs reject?** Resolved: **ignore** (forward-compat;
   a future operator variant could give `right` meaning). A host MAY warn.
2. **A dedicated capability flag?** Resolved: **no.** The operator set is part of the
   always-present workflow-definition contract (not an optional family); adoption is
   discoverable by the conformance scenario, matching how the other five operators are
   handled (no per-operator flag).
