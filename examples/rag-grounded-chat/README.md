# rag-grounded-chat

> 2-node reference workflow exercising the v1 [`host.knowledge`](../../spec/v1/host-capabilities.md#host-knowledge) spec extension. Composes the [`vendor.myndhyve.knowledge-tools`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.knowledge-tools/index.json) pack (RAG retrieval + prompt augmentation) with the spec-canonical [`core.openwop.ai`](https://packs.openwop.dev/v1/packs/core.openwop.ai/index.json) pack (free-form LLM chat). Demonstrates how to produce a cited answer from a knowledge base with zero ad-hoc RAG plumbing.

## The workflow

| Workflow | Use case | Nodes |
|---|---|---|
| [`rag-grounded-chat.json`](./rag-grounded-chat.json) | End-user asks a natural-language question; you want the model to answer using ONLY content from your knowledge base, with inline `[#N]` citations the UI can render as footnotes. | 2 |

## Pipeline

```
┌─────────────────────────────────────┐
│ knowledge.augment-prompt            │  Retrieves chunks via ctx.knowledge.retrieve,
│ → augmentedUserMessage + citations[]│  then builds an AI-ready user prompt:
│                                     │    - grounding header
│                                     │    - === Sources === block with [#N] markers
│                                     │    - the user's original question
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│ core.ai.chatCompletion              │  System prompt instructs the model to
│ → text answer                       │  cite [#N] markers; user message is the
│                                     │  augmented prompt from upstream.
└─────────────────────────────────────┘
```

## Required host capabilities

| Capability | Used by |
|---|---|
| `host.knowledge: supported` | `augment-question` (calls `ctx.knowledge.retrieve`) |
| `aiProviders: supported` | `answer-with-sources` (routes via `ctx.callAI`) |

## Output shape

The terminal `answer-with-sources` node returns the model's text. The upstream `augment-question` node's outputs are also persisted on the run:

| Field | Source node | Use |
|---|---|---|
| `augment-question.outputs.citations` | `knowledge.augment-prompt` | Render footnotes in the UI. Each `{ marker, sourceId, documentTitle, headingPath, pageNumber, relevanceScore }` matches the `[#N]` markers the model is instructed to cite. |
| `augment-question.outputs.sources` | `knowledge.augment-prompt` | De-duplicated source list (one entry per document/asset, not per chunk). |
| `augment-question.outputs.hasResults` | `knowledge.augment-prompt` | `false` when retrieval returned 0 chunks — UI can short-circuit before showing a no-source answer. |
| `answer-with-sources.outputs.content` | `core.ai.chatCompletion` | The AI's text with inline `[#N]` citations matching the citations array. |
| `answer-with-sources.outputs.usage` | `core.ai.chatCompletion` | Token usage for cost attribution. |

## Activation

1. Host advertises `host.knowledge: supported` + `aiProviders: supported` (with at least one provider entry matching `aiProvider`).
2. Host's knowledge adapter is wired to a real RAG backend (vector store + BM25 + optional rerank).
3. Host's pack registry has both `vendor.myndhyve.knowledge-tools@1.0.0` + `core.openwop.ai@1.0.0` available.
4. POST the workflow JSON to `/v1/workflows`.
5. POST a run via `/v1/runs` with `{ workflowId: "vendor.myndhyve.rag-grounded-chat", variables: { userQuestion, aiProvider, aiModel, ... } }`.

See [`spec/v1/rest-endpoints.md`](../../spec/v1/rest-endpoints.md) for the run lifecycle.

## When to override `retrievalQuery`

`knowledge.augment-prompt` defaults `retrievalQuery` to `userMessage`. Override when the user's natural-language phrasing would retrieve poorly:

| `userQuestion` | Better `retrievalQuery` |
|---|---|
| "How does it work?" | "product onboarding flow" |
| "Can I cancel anytime?" | "subscription cancellation policy" |
| "Why is this slow?" | "performance troubleshooting database queries" |

The user-facing prompt still shows the original question; only retrieval is influenced.

## When the knowledge base has no answer

If `knowledge.augment-prompt` returns `hasResults: false`, the augmented user message uses a "no source material" header. The `core.ai.chatCompletion` system prompt in this workflow instructs the model to say so honestly rather than inventing facts. Two patterns for handling this:

1. **Soft path** (this workflow): trust the model's "I don't know" answer; the UI shows it as-is.
2. **Hard gate**: insert a `core.openwop.data.branch` node after `augment-question` that short-circuits to a canned "no information available" response when `hasResults === false`, skipping the AI call entirely. Saves tokens for low-coverage queries.

## What's NOT in this JSON

- **Multi-turn conversation history** — single-turn Q&A. To support follow-up questions, accumulate previous turns in a run variable + extend `answer-with-sources.inputs.messages[]` to include them before the new user message. Note that retrieval still uses the latest question only unless you build a query-rewriter upstream.
- **Reranking** — handled host-side inside `ctx.knowledge.retrieve` if the host's adapter is wired to a reranker (Vertex AI rerank, Cohere rerank, etc.). The pack is reranker-agnostic.
- **Citation enforcement** — the system prompt asks the model to cite; this workflow does not post-validate that the response actually contains `[#N]` markers. To enforce, replace `core.ai.chatCompletion` with `core.ai.structuredOutput` + a JSON schema requiring `citationMarkers[]` to be non-empty.

## See also

- [`docs/PACK-CATALOG.md`](../../docs/PACK-CATALOG.md) — categorized inventory of all 62 published packs
- [`spec/v1/host-capabilities.md#host-knowledge`](../../spec/v1/host-capabilities.md#host-knowledge) — the `host.knowledge` capability contract
- [`packs/vendor.myndhyve.knowledge-tools/README.md`](../../packs/vendor.myndhyve.knowledge-tools/README.md) — node-level details + score-filtering knobs
- [`examples/market-intel-pipeline/`](../market-intel-pipeline/) — multi-pack composition reference
- [`examples/ads-publish-pipeline/`](../ads-publish-pipeline/) — end-to-end creative + publish pipeline

## License

Apache-2.0.
