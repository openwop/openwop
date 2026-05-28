# `vendor.myndhyve.chat`

MyndHyve chat-bridge pack. Routes through the host's chat adapter to post messages, emit rich cards (progress + custom), patch existing cards, and gate runs on user phase-input.

| Pack name | `vendor.myndhyve.chat` |
| Version | `1.0.0` |
| peerDependencies | `host.chat: supported` |
| License | Apache-2.0 |

typeId-preserve: typeIds keep `core.chat.*` prefix (workflow-author-facing); pack scoping under `vendor.myndhyve.*` controls registry submission.

## Nodes

- **`core.chat.sendMessage`** — post a message with role/citations/sessionId override. Idempotency-key prevents duplicate posts on replay.
- **`core.chat.progressCard`** — emit a stage-based progress card. Subsequent `updateCard` calls with the same `cardId` mutate it.
- **`core.chat.updateCard`** — patch existing card. `merge` / `replace` patch modes. `found: false` when card doesn't exist (workflow branches to fallback).
- **`core.chat.phaseInputGate`** — HITL gate. Emits a phase-input dialog, suspends via `ctx.suspend({ reason: 'conversation-input', resumeKey: phaseId, answerSchema })`. Host validates response against schema before resuming. Optional `timeoutMs` resolves with `timedOut: true`.

## Suspend semantics (phaseInputGate)

Built on RFC 0007 §F suspend primitive. When the host advertises RFC 0010 `core.openwop.conversationPrimitive`, the reason is `'conversation-input'` (per H3 ratification — uses `'waiting-approval'` run-status); falls back to `'clarification'` on older hosts.

## Host contract

```typescript
ctx.chat.sendMessage({ role, content, citations?, sessionId?, idempotencyKey })
  → Promise<{ messageId, sentAt }>

ctx.chat.emitCard({ cardId, cardType, payload, idempotencyKey })
  → Promise<{ cardId, emittedAt }>

ctx.chat.updateCard({ cardId, patch, patchType, idempotencyKey })
  → Promise<{ cardId, updatedAt, found }>

ctx.suspend({ reason, resumeKey, answerSchema?, timeoutMs? })
  → Promise<{ answers?, respondent?, respondedAt?, timedOut? }>
```

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve)
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](../../RFCS/0002-agent-identity-and-reasoning-events.md) §F — suspend primitive (was RFC 0007 in original numbering)
- [`RFCS/0005-conversation.md`](../../RFCS/0005-conversation.md) — conversation primitive (RFC 0010 in original numbering)
