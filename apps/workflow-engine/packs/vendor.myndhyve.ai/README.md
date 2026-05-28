# `vendor.myndhyve.ai`

MyndHyve envelope-protocol AI pack. **Distinct from `core.openwop.ai`** — this pack is for MyndHyve-specific workflows that route LLM output through typed envelopes (`prd.create`, `theme.create`, etc.) into canonical artifact stores.

| Pack | When to use |
|---|---|
| `core.openwop.ai` | Generic LLM chat / structured output / embeddings. Vendor-neutral. Runs on any OpenWOP host advertising `aiProviders.supported`. |
| `vendor.myndhyve.ai` (this pack) | MyndHyve workflows that emit typed envelopes into the workflow's envelope stream + that resolve prompts from MyndHyve's prompt library. |

Both packs can be installed together; they don't conflict.

| Field | Value |
|---|---|
| peerDependencies | `host.aiEnvelope: supported`, `host.promptLibrary: supported` |
| License | Apache-2.0 |

## Nodes (typeId-preserve)

| typeId | role |
|---|---|
| `core.ai.generateFromPrompt` | Inline system prompt → LLM → typed envelope |
| `core.ai.awaitEnvelope` | Suspend waiting for a typed envelope to arrive on the run's envelope stream |
| `core.ai.callPrompt` | Resolve prompt from library by `promptId` → LLM → typed envelope. Pins prompt version at dispatch for replay determinism. |

All three side-effectful + cacheable. Engine Layer-2 cache + deterministic Idempotency-Key derivation ensure cost-once on replay.

## Host contract

```typescript
ctx.aiEnvelope.generate({
  systemPrompt, envelopeType, provider?, model?, temperature?,
  maxTokens?, userMessage?, variables?, context?, idempotencyKey
}) → Promise<{ envelopeType, payload, envelopeId, usage?, model? }>

ctx.aiEnvelope.await({ envelopeType, timeoutMs })
  → Promise<{ envelopeType, payload?, envelopeId?, timedOut? }>

ctx.promptLibrary.get(promptId)
  → Promise<{ systemPrompt, version, promptId }>
```

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve)
- `core.openwop.ai` pack — for vendor-neutral LLM nodes
