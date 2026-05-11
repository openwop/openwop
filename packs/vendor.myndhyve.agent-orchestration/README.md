# `vendor.myndhyve.agent-orchestration`

RFC 0002/0003/0006-based agent coordination pack. 6 nodes.

| Pack | `vendor.myndhyve.agent-orchestration` |
| peerDependencies | `host.agentRuntime: supported` |

## Nodes (typeId-preserve)

| typeId | role | RFC anchor |
|---|---|---|
| `agent.spawn` | side-effect | RFC 0007 §A1 / RFC 0008 AgentManifest |
| `agent.delegate.smart` | side-effect | RFC 0011 §F (conservative-path low-confidence escalation) |
| `agent.consensus.vote` | side-effect | — |
| `agent.message.send` | side-effect | RFC 0007 B2.3 messaging reducer |
| `agent.skill.invoke` | side-effect | RFC 0008 toolAllowlist |
| `agent.swarm.execute` | side-effect | — |

All side-effectful + cacheable. Engine Layer-2 cache covers replay cost-once.

## delegate-smart conservative path

`agent.delegate.smart` inherits RFC 0011 §F conservative-path semantics. When the router's confidence is below `config.escalationThreshold` (default 0.7 per RFC 0007 §A1), the node `ctx.suspend`s with `reason: 'low-confidence'`. On resume:
- If reviewer approves → returns the approved `agentInstanceId`, with `escalated: true`
- If reviewer rejects → throws typed `delegate_rejected` error

Hosts that don't expose `ctx.suspend` fall through (logged); not recommended for production.

## consensus tie-breaking

Two strategies:
- `unresolved` (default) — return `winningOption: null`, `isTie: true`. Workflow author branches to escalation.
- `first` — first option in `config.options` array wins on tie. Deterministic.

## swarm strategies

- `map` — one task per agent, return all results
- `map-reduce` — map + reduce step (requires `config.reducer` skillId)
- `competitive` — first to complete wins; others cancelled

## message-send + RFC 0007 B2.3 reducer

The host's messaging reducer is append-only + idempotent on `messageId` + replay-deterministic. The pack derives a stable `messageId` from `(runId, nodeId, recipient, content)` — replays don't duplicate-message.

## Host contract

```typescript
ctx.agentRuntime.spawn({ agentRef, session?, overrides?, idempotencyKey })
  → Promise<{ agentInstanceId, agentId, spawnedAt }>

ctx.agentRuntime.route({ candidates, task, taskData?, idempotencyKey })
  → Promise<{ selectedAgentInstanceId, confidence, rationale?, alternatives? }>

ctx.agentRuntime.vote({ voters, options, question, context?, idempotencyKey })
  → Promise<{ votes: Array<{ agentInstanceId, option, rationale? }> }>

ctx.agentRuntime.message({ toAgentInstanceId?, groupId?, content, fromAgentInstanceId?, metadata?, messageId })
  → Promise<{ messageId, sentAt, deliveredTo }>

ctx.agentRuntime.skill({ agentInstanceId, skillId, args?, timeoutMs?, idempotencyKey })
  → Promise<{ result, isError, durationMs }>

ctx.agentRuntime.swarm({ agents, strategy, reducer?, perTaskTimeoutMs?, task, taskData?, perAgentTask?, idempotencyKey })
  → Promise<{ results?, reduced?, winner?, succeeded, failed, durationMs? }>

ctx.suspend({ reason, resumeKey, proposed?, threshold? })
  → Promise<{ approved, approvedAgentInstanceId?, rejectedReason? }>  // for delegate.smart escalation
```

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve)
- `RFCS/0002-agent-identity-and-reasoning-events.md` §F (suspend semantics — was RFC 0007 in original numbering)
- `RFCS/0003-agent-packs.md` (AgentManifest + toolAllowlist — was RFC 0008)
- `RFCS/0006-orchestrator.md` §F (conservative path — was RFC 0011)
