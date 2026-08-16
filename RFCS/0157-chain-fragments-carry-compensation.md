# RFC 0157: Chain fragments carry compensation (RFC 0013 revision × RFC 0151 §B)

| Field             | Value                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0157                                                                                                                                                                   |
| **Title**         | Chain fragments carry compensation (RFC 0013 revision × RFC 0151 §B)                                                                                                   |
| **Status**        | `Accepted`                                                                                                                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts); measured and requested by the openwop-app maintainers (ADR 0554 P2)                                                                     |
| **Created**       | 2026-08-16                                                                                                                                                             |
| **Updated**       | 2026-08-16 (Draft → Accepted same day: schema mirrors + spec prose + reference expansion + conformance landed together; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers", the RFC 0134/0135 precedent for RFC 0013 revisions. **Landed:** the wire and the suite. **Carried, not closed:** host adoption — the in-memory reference host's byte-mirrored expansion core does not yet run `carryCompensation`, and no host expands a compensating chain non-vacuously.) |
| **Affects**       | `schemas/workflow-chain-pack-manifest.schema.json` (`$defs.FragmentNode.compensation`, `$defs.WorkflowChain.compensation`), `spec/v1/workflow-chain-packs.md` (§"Compensation (RFC 0157)", expansion steps 3/5/6/9, error codes), `conformance/src/lib/workflow-chain-expansion.ts` (`carryCompensation`, `expandChainWithCompensation`), NEW `conformance/src/scenarios/chain-compensation-expansion.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1                                                                                                                                 |
| **Supersedes**    | —                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                      |

## Summary

RFC 0151 §B lets a `WorkflowNode` declare its inverse action (`compensation { nodeTypeId, inputMapping?, retry?, requiresApproval? }`) and, since #1009, lets a workflow carry a compensation policy at `settings.compensation`. RFC 0013 workflow-chain packs mirror `WorkflowNode` into `FragmentNode` — and the mirror stopped at `id/typeId/name/position/config/inputs`. `FragmentNode`'s own description says new `WorkflowNode` fields must be mirrored; `compensation` (`b4796755`) was not. So on a host where **every workflow is a chain or a stack**, no node could own an inverse action, no chain could carry a policy, and no unwind could ever occur: RFC 0151 §B was reachable only through a hand-authored `POST /v1/workflows`. This RFC mirrors both surfaces into the chain manifest and defines how they survive expansion into the registered `WorkflowDefinition`.

## Motivation

Measured by the openwop-app maintainers while implementing ADR 0554 P2 (2026-08-16): `schemas/workflow-chain-pack-manifest.schema.json` `$defs.FragmentNode` carries exactly `['id','typeId','name','position','config','inputs']` and the manifest mentions `compensation` nowhere; the host's `expandChain` builds expanded nodes from that same allowlist. The host did **not** add a host-private key — a guess at a contract with an owner is the failure ADR 0548 invariant 4 exists to prevent — and asked for the revision instead. Two things are needed: (1) a fragment node that can declare its compensator, and (2) a chain-level policy that arrives in `settings.compensation` on the registered definition, so a chain-first host can reach RFC 0151 §B at all.

## Proposal

### §A — `FragmentNode.compensation`

`$defs.FragmentNode` gains OPTIONAL `compensation`, a **byte-mirror** of `workflow-definition.schema.json#/$defs/WorkflowNode/properties/compensation` (closed; `nodeTypeId` REQUIRED). It is descriptive — it says *what* the inverse action is — and any host **MUST** carry it through expansion verbatim, whether or not it advertises `capabilities.compensation`.

### §B — `WorkflowChain.compensation`

`$defs.WorkflowChain` gains OPTIONAL `compensation`, a **byte-mirror** of `compensation-policy.schema.json` (RFC 0151 §B; closed; `triggers` REQUIRED). It requests an unwind. On expansion it becomes the registered definition's `settings.compensation`:

- parent has none ⇒ **copy**;
- parent has one that is deep-equal (key-order insensitive) ⇒ **accept**;
- otherwise ⇒ **`chain_compensation_policy_conflict`** (HTTP `409`, `details.chainId`). Expansion **MUST NOT** merge policies — a merged policy nobody wrote is exactly the guess-at-a-contract failure the policy exists to prevent; the author reconciles and re-expands.

A host that does not advertise `capabilities.compensation` **MUST** refuse a chain carrying a policy with `capability_required` (`compensation.md` §"Workflow policy") — the same rule as a hand-authored `settings.compensation`.

### §C — Expansion rules

Numbered against `workflow-chain-packs.md` §"Expansion semantics":

- **3b** — every `compensation.nodeTypeId` **MUST** resolve exactly as `typeId` does (`chain_unresolvable_typeid`), so an unwind cannot fail on a typo first discovered during a failure.
- **5b** — `{{params.<name>}}` inside `inputMapping` **MUST** be substituted at expansion (author-time literals; RFC 0151 §B's recorded-facts rule is unaffected).
- **6b** — fragment node-id references inside `inputMapping` (`${nodes.<id>.…}` / `nodes.<id>.…`) **MUST** be rewritten with the expansion prefix exactly as edge refs are; references to non-fragment ids pass through.
- **9b** — the chain-level policy is carried per §B before persistence.

### §D — Mirrors, not `$ref`s

Both surfaces are copied inline; the manifest schema keeps only `#/…` refs. A new cross-file `$ref` in a schema is a suite-minor change every downstream fixed-list validator must absorb (`fixtures-valid.test.ts` learned this from `compensation-policy.schema.json` on 2026-08-16). Two conformance legs assert each mirror stays byte-equal (apart from its own `description`) to its source, so drift cannot be silent.

### §E — Reference implementation placement

`conformance/src/lib/workflow-chain-expansion.ts` gains `carryCompensation(chain, expanded, ctx, parentSettingsCompensation?)` and `expandChainWithCompensation(...)`, composed **after** the byte-mirrored core `expandChain` rather than inside it — the core is mirrored verbatim by the in-memory reference host and gated in CI (`check-workflow-chain-expansion-sync.mjs`), and this pass composes on its output. A host runs the core, then the carry.

## Compatibility

**Additive.** Two new OPTIONAL properties on closed objects; a chain that declares neither is byte-identical and expands identically. Existing chains, hosts, and registries are unaffected. Lands in v1.x. A host adopts it by extending its expander; until it does, a manifest carrying either surface fails that host's schema validation of the pinned manifest schema (honest — the host does not yet carry it, so it must not accept it silently). Downstream validators with fixed ref lists are unaffected (§D).

## Conformance

`chain-compensation-expansion.test.ts` (server-free): the two mirrors; a manifest with both surfaces validates and a foreign key inside either is rejected; the manifest stays self-contained; expansion carries the declaration verbatim with params substituted and id refs rewritten; an unresolvable compensator fails `chain_unresolvable_typeid` before any node is emitted; the policy is copied / accepted / conflicted. Suite `1.110.0 → 1.111.0`.

The host half — a host's own expander honouring 3b/5b/6b/9b — is witnessed through the live `workflow-chain-host-expansion` path once a host adopts this RFC. Per RFC 0147 §A.5 that host witness is what would substantiate a *behavioural* claim; this RFC lands the wire and the reference, and says so.

## Security

Same tier as RFC 0151 §B (security-high, RFC 0147 R9): a compensation is a second effect. Nothing here widens it — the declaration is descriptive, the policy can only escalate approval scope, and the conflict rule fails closed. `inputMapping` substitution happens at author time from author-supplied parameters (never from a model or a peer), so `compensation-input-recorded-facts-only` is preserved. No new invariant.

## Unresolved questions

1. **Deferred mode (RFC 0124):** should `{{params.*}}` inside `inputMapping` be deferrable per run like `config`/`inputs` tokens? **Deferred** — frozen at drop time for now (`workflow-chain-packs.md` WCP6); a compensator's inputs varying per run is a design question RFC 0151 §B's recorded-facts rule should answer first.
2. **Sub-chain co-expansion (RFC 0133):** does a child chain's policy conflict with the parent's, or apply only to the child's co-registered definition? **Resolved for v1:** it applies to the child's own registered definition (each co-registered workflow owns its `settings`); a parent–child policy difference is not a conflict.

## Acceptance criteria

- [x] Schema mirrors land, closed, self-contained, byte-equal to their sources under test.
- [x] Spec prose lands (`workflow-chain-packs.md` §"Compensation (RFC 0157)", steps 3/5/6/9, error code, gap WCP6).
- [x] Reference expansion lands below the mirrored core; server-free witness passes.
- [ ] A host expands a compensating chain non-vacuously through the live `workflow-chain-host-expansion` path. (Carried — host adoption; openwop-app ADR 0554 P2 is the first candidate.)
- [ ] The in-memory reference host's mirrored core adopts `carryCompensation`. (Carried — `openwop-examples`.)

## References

- [RFC 0013 — Workflow-chain packs](./0013-workflow-chain-packs.md) · [RFC 0124](./0124-portable-per-run-parameter-deferral.md) · [RFC 0133](./0133-workflow-chain-composition.md) · [RFC 0134](./0134-edge-condition-truthy-falsy.md) · [RFC 0135](./0135-workflow-chain-internal-visibility.md) — prior RFC 0013 revisions
- [RFC 0151 — Compensation and Partial-Failure Profile](./0151-compensation-and-partial-failure-profile.md) · [`spec/v1/compensation.md`](../spec/v1/compensation.md) · [`schemas/compensation-policy.schema.json`](../schemas/compensation-policy.schema.json)
- [`spec/v1/workflow-chain-packs.md`](../spec/v1/workflow-chain-packs.md) · [`schemas/workflow-chain-pack-manifest.schema.json`](../schemas/workflow-chain-pack-manifest.schema.json)
