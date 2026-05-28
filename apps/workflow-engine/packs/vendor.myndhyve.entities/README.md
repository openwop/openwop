# `vendor.myndhyve.entities`

MyndHyve entities + validation + asset-decision + messaging primitives. 5 nodes.

| Pack | `vendor.myndhyve.entities` |
| peerDependencies | `host.entities: supported`, `host.messaging: supported` |
| License | Apache-2.0 |

## Nodes (typeId-preserve)

| typeId | role | what it does |
|---|---|---|
| `core.entities.projectCreate` | side-effect | Create a Project for a given Canvas Type. Idempotency-keyed via `ctx.sideEffects` when available. |
| `core.validation.crossStageCheck` | gate | Deterministic field comparison across two artifacts. No LLM. Compare modes: equal / gte / lte / exists / count-match. |
| `core.workflow.assetDecisionGate` | gate | HITL — pick a workspace asset (brand / persona / KB) or request a new one. Auto-resolves when the inheritance variable is already set. |
| `messaging.chatSend` | side-effect | Send a message to an explicitly targeted connector + conversation. |
| `messaging.chatReply` | side-effect | Reply to the message that triggered the run (reads `_ingressEnvelope` from run variables). |

`crossStageCheck` is the only cacheable node — pure deterministic computation. The other four are side-effectful.

## Host contract

```typescript
// host.entities — covers projectCreate + assetDecisionGate
ctx.entities.createProject({ userId, name, canvasTypeId, type, status, settings, idempotencyKey })
  → Promise<{ id: string }>

ctx.entities.listAssets({ assetType, filterConfig })
  → Promise<Array<{ id, name, description?, status? }>>

ctx.entities.getAsset({ assetType, assetId })
  → Promise<Record<string, unknown> | null>

// host.messaging — covers chatSend + chatReply
ctx.messaging.dispatchEgressEnvelope({ envelope, connectorInstanceId, nodeId })
  → Promise<{ success, deliveryId?, platformMessageId?, durationMs?, error? }>

// HITL: assetDecisionGate
ctx.suspend({ reason: 'approval', prompt: {...}, availableAssets, actionIds })
  → Promise<{ decision: 'approved'|'rejected', approved?, feedback?: assetId, notes? }>
```

## crossStageCheck

```yaml
config:
  failOnMismatch: false   # default: warnings-only
  checks:
    - name: "Plan covers all PRD features"
      sourcePath: "features"
      targetPath: "features"
      compare: "count-match"
    - name: "PRD audience matches"
      sourcePath: "audience"
      targetPath: "audience"
      compare: "equal"
inputs:
  sourceArtifact: { ... PRD ... }
  targetArtifact: { ... Plan ... }
```

`failOnMismatch:false` returns `success:true` even when warnings exist (warnings-only mode). `failOnMismatch:true` flips `success` to `false` on any mismatch — workflow authors branch on `.success` to halt the run.

## assetDecisionGate auto-resolution

When `autoResolveVariable: 'brandId'` is configured AND `ctx.variables.get('brandId')` is already set (typically by an upstream `launch-studio.linkStep`), the gate resolves instantly to `use-existing` without pausing — used for Launch Studio → Campaign Studio asset inheritance.

## chatReply requires a trigger

`messaging.chatReply` reads the originating ingress envelope from `ctx.variables.get('_ingressEnvelope')`. This is set by a chat-message trigger upstream. Workflows without a chat-message trigger should use `messaging.chatSend` with explicit targeting instead.

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve) — Phase 4 #2
- `vendor.myndhyve.launch-studio` — `linkStep` upstream of `projectCreate` in the LS pipeline; supplies the inheritance variables that `assetDecisionGate.autoResolveVariable` reads
- `core.openwop.triggers` — `core.trigger.chatMessage` sets `_ingressEnvelope` for `chatReply`
