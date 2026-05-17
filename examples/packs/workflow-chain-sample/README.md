# `vendor.openwop.workflow-chain-sample`

> Reference workflow-chain pack proving [RFC 0013](../../../RFCS/0013-workflow-chain-packs.md) end-to-end. In-tree only — NOT published to `packs.openwop.dev`. Status: example.

This pack is the canonical proof that the workflow-chain pack contract from [`spec/v1/workflow-chain-packs.md`](../../../spec/v1/workflow-chain-packs.md) is implementable with real-world-shaped content. It exists to:

1. Exercise the new `schemas/workflow-chain-pack-manifest.schema.json` against a non-trivial manifest.
2. Demonstrate the `kind: "workflow-chain"` discriminator that distinguishes chain packs from node packs at the registry layer (Phase 2 — `registry/scripts/build-index.mjs` + `conformance-check.mjs`).
3. Surface real chain shapes the reference expansion library (Phase 3 — `conformance/src/lib/workflow-chain-expansion.ts`) can be exercised against.

## What's in the pack

Two chains showing the two common shapes:

| chainId | Shape | Demonstrates |
|---|---|---|
| `vendor.openwop.workflow-chain-sample.summarize-text` | 1 node, 0 edges | Literal parameter substitution into a single `core.ai.callPrompt` system prompt — the canonical "drag-tile that expands to one configured node" pattern (mirrors the spec's Generate PRD example) |
| `vendor.openwop.workflow-chain-sample.fetch-and-summarize` | 2 nodes, 1 edge | Multi-node chain composition: `core.openwop.http.get` fetches the URL, then `core.ai.callPrompt` summarizes the body. Edge wiring (`fetch.body → summarize.sourceText`), parameter substitution across multiple nodes, capability propagation (`side-effectful` from HTTP fetch propagates to both expanded nodes per spec §Capability propagation) |

Both chains validate against the new schema:

```bash
cd conformance
npx vitest run src/scenarios/workflow-chain-pack-manifest-validation.test.ts
```

The reference expansion library (Phase 3) can expand them in isolation:

```typescript
import { expandChain } from '@openwop/openwop-conformance/lib/workflow-chain-expansion.js';
import packManifest from './pack.json' with { type: 'json' };

const chain = packManifest.chains.find((c) => c.chainId === 'vendor.openwop.workflow-chain-sample.summarize-text');
const fragment = expandChain(chain, {
  expansionId: 'demo01',
  params: { sourceText: '…', targetLength: 'one-paragraph', tone: 'neutral' },
  isTypeIdResolvable: (typeId) => typeId === 'core.ai.callPrompt',
});

// fragment.nodes[0].id          === 'vendor_openwop_workflow-chain-sample_summarize-text_demo01_summarize-call'
// fragment.nodes[0].typeId      === 'core.ai.callPrompt'
// fragment.nodes[0].config.systemPrompt has the placeholders substituted
// fragment.nodes[0].capabilities === ['cacheable']
```

## What this pack is NOT

- **NOT published** to `packs.openwop.dev`. Public-registry publication of workflow-chain packs is gated on the same external security audit that gates the new `core.openwop.*` packs (see [`SECURITY/external-audit-engagement.md`](../../../SECURITY/external-audit-engagement.md) §2.1). Until that audit completes, chain packs are in-repo / lockfile-resolvable only.
- **NOT signed**. No `pack.json.sig` or signing keys ship in this directory. Production chain packs MUST be signed per `node-packs.md §Signing` (reused unchanged for chain packs per `workflow-chain-packs.md §"Expansion semantics" step 2`). The signing test path is exercised in `conformance/src/scenarios/workflow-chain-pack-signature-verification.test.ts` using an in-memory keypair.
- **NOT a runtime artifact**. Workflow-chain packs have NO `runtime` field (that's a node-pack-only surface). Chain packs are workflow-edit-time abstractions — they expand into concrete `core.*` / published-vendor typeIds the runtime already dispatches.
- **NOT the eventual MyndHyve preset library**. The 55 unpublished editor presets from the CANVAS-PACKS-INVENTORY audit will land as `vendor.myndhyve.app-builder-presets@1.0.0` etc. (RFC 0013 Phase 4 deferred work). This sample is shape-only, not content-equivalent.

## When this pack matters

- Schema authors evolving `workflow-chain-pack-manifest.schema.json` MUST re-validate this pack stays accepted after their changes.
- Reference-host implementers building chain expansion in their workflow editor should use this pack as a smoke target: load it, render the parameter form, expand on drop, verify the resulting workflow JSON.
- Future Phase 4 vendor packs (`vendor.myndhyve.app-builder-presets`, `vendor.myndhyve.campaign-studio-presets`, etc.) should mirror this pack's structure for the chain-entry shape (label, description, parameters, dag, outputs, capabilities) so cross-vendor consistency is preserved.

## Related

- [`RFCS/0013-workflow-chain-packs.md`](../../../RFCS/0013-workflow-chain-packs.md) — the source RFC.
- [`spec/v1/workflow-chain-packs.md`](../../../spec/v1/workflow-chain-packs.md) — normative manifest format + expansion semantics.
- [`schemas/workflow-chain-pack-manifest.schema.json`](../../../schemas/workflow-chain-pack-manifest.schema.json) — canonical JSON Schema this pack validates against.
- [`conformance/src/lib/workflow-chain-expansion.ts`](../../../conformance/src/lib/workflow-chain-expansion.ts) — reference expansion library.
- [`spec/v1/node-packs.md`](../../../spec/v1/node-packs.md) — sibling pack format whose Naming / Versioning / Signing / Lockfile rules workflow-chain packs reuse unchanged.
