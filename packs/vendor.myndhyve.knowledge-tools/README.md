# vendor.myndhyve.knowledge-tools

> First reference consumer of the v1 `host.knowledge` surface ([spec §host.knowledge](../../spec/v1/host-capabilities.md#host-knowledge)). Two typeIds: `knowledge.retrieve` (thin pass-through) + `knowledge.augment-prompt` (composition primitive).

## Nodes

| typeId | Role | What it does |
|---|---|---|
| `knowledge.retrieve` | action | Issues a RAG retrieval via `ctx.knowledge.retrieve`. Surfaces chunks + de-duplicated sources + `hasResults`. Optional `config.scoreFloor` drops chunks below a caller-defined relevance score; `droppedByScoreFloor` reports the count. |
| `knowledge.augment-prompt` | action | Retrieves, then builds an AI-ready augmented user message: prefixes a grounding header, embeds a `=== Sources ===` block with per-chunk `[#N]` markers (truncated to `maxCharsPerChunk`, total capped at `totalCharBudget`), then appends the user question. Emits a `citations[]` list so the caller can render footnotes in the response UI. Falls back to a "no source material" header when retrieval returns 0 results. |

## Required host capability

`peerDependencies: { "host.knowledge": "supported" }` — both nodes call `ctx.knowledge.retrieve(...)` directly. See [spec §host.knowledge](../../spec/v1/host-capabilities.md#host-knowledge) for the wire contract.

## `knowledge.augment-prompt` example

```js
const result = await nodes['knowledge.augment-prompt']({
  knowledge: {
    retrieve: async () => ({
      chunks: [
        {
          chunkId: 'c1',
          content: 'FlashPick supports up to 50 items per checkout.',
          headingPath: ['Checkout', 'Item limits'],
          pageNumber: 12,
          documentTitle: 'FlashPick Operator Guide',
          assetId: 'asset_flashpick_guide',
          collectionId: 'col_kb',
          relevanceScore: 0.87,
        },
      ],
      sources: [{ sourceId: 'asset_flashpick_guide', assetId: 'asset_flashpick_guide', title: 'FlashPick Operator Guide', headingPath: ['Checkout', 'Item limits'], pageNumber: 12 }],
      hasResults: true,
    }),
  },
  inputs: { userMessage: 'How many items can a customer check out at once?' },
});

// result.outputs.augmentedUserMessage:
//   Use ONLY the sources below to answer. Each chunk is labeled [#N]; cite as [#N] when you use it.
//
//   === Sources ===
//   [#1] FlashPick Operator Guide — Checkout › Item limits (p. 12)
//   FlashPick supports up to 50 items per checkout.
//   === End Sources ===
//
//   User question:
//   How many items can a customer check out at once?

// result.outputs.citations:
//   [{ marker: '[#1]', sourceId: 'asset_flashpick_guide', documentTitle: 'FlashPick Operator Guide',
//      headingPath: ['Checkout', 'Item limits'], pageNumber: 12, relevanceScore: 0.87 }]
```

## Score filtering — two layers

| Knob | Where it runs | When to use |
|---|---|---|
| `inputs.scoreThreshold` / `config.scoreThreshold` | passed to `ctx.knowledge.retrieve`; enforced **by the host** | when you want the host's pipeline (which may have re-ranker tie-breaking knowledge) to apply the floor |
| `config.scoreFloor` | enforced **by this pack** after retrieval | when you want a stricter floor than the host enforces, or you don't trust caller-side `scoreThreshold` propagation |

Both can be set; both are AND-ed (host returns chunks ≥ scoreThreshold, then this pack drops chunks below scoreFloor).

## Failure-mode mapping

The pack propagates the spec's `host.knowledge` error codes verbatim. Non-retryable codes (caller-fault) → `retryable: false`; transient codes → `retryable: true`:

| Spec error code | Pack `error.retryable` |
|---|---|
| `host_capability_missing` | `false` (workflow-register should have rejected) |
| `knowledge_workspace_forbidden` | `false` |
| `knowledge_collection_not_found` | `false` |
| `knowledge_query_too_long` | `false` |
| `knowledge_quota_exhausted` | `true` |
| any other thrown error | `true` (default to retry; assume transient) |

## License

Apache-2.0 — see [LICENSE](./LICENSE).
