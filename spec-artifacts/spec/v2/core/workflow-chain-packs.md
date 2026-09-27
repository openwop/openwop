# Workflow Chain Packs

> **Status: Stable.**
> **Normative home:** `workflowChainPacks`.

## Why this exists

A workflow-chain pack ships a reusable fragment a host expands into a concrete definition, and may compose other chains as co-registered children. The manifest is `schemas/v2/workflow-chain-pack-manifest.schema.json`; installation and signing follow [packs.md](packs.md).

## Exact pins

Every reference a chain makes to a node type or an external chain MUST pin an exact version per referenced `typeId` (`core.ai.callPrompt@1.0.0`). A host MUST refuse to register a chain whose reference carries a range or no version.

## Co-registered children

When a parent chain expands a `subChainRef`, the child is registered as its own workflow. A host MUST:

- **Identity** — register the child under a deterministic id, so two parents composing the same child share one registration.
- **Reference count** — count each parent that references the child; deleting a parent decrements the count.
- **Deletion** — delete the child only when its last parent is deleted.
- **Ownership record** — persist the resolved child version in the parent's ownership record, so a re-instantiation or `:fork` reproduces the same child.

The ownership record is a [persistence.md](persistence.md) store.

## Parameter substitution

`{{params.<name>}}` tokens are substituted at expansion time, when the author drops the tile. A persisted definition MUST NOT contain a `{{params.*}}` token, and a host MUST NOT defer substitution to dispatch time.

## Composition depth

A host MUST bound sub-chain nesting by `workflowChainPacks.subChains.maxDepth` ([capabilities.md](capabilities.md)), default 8. A composition that exceeds the depth, or that transitively composes itself, MUST fail closed with `sub_chain_cycle`; the depth check and the cycle check compose as one guard.

## Edge conditions

Fragment edges carry the same `condition` and `triggerRule` shapes as a top-level definition (`schemas/v2/workflow-definition.schema.json`). `EdgeCondition.type` is one of `expression`, `equals`, `notEquals`, `contains`, `regex`, `truthy`, `falsy`; `truthy` and `falsy` take `left` and no `right`.

A host MUST carry both fields through expansion verbatim and MUST honor them on expanded edges as on authored ones. [form-content-packs.md](form-content-packs.md) reuses this operator set for field visibility.

*Sources: RFC 0133, RFC 0177.*
