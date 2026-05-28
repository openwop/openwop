# `vendor.myndhyve.launch-studio`

MyndHyve Launch Studio backbone — 2 coordination nodes.

| Pack | `vendor.myndhyve.launch-studio` |
| peerDependencies | `host.launchStudio: supported`, `host.kanban: supported` |
| License | Apache-2.0 |

## Nodes (typeId-preserve)

| typeId | role | what it does |
|---|---|---|
| `launch-studio.linkStep` | side-effect | Links a Project to a Launch Studio step. Sets `${stepId}_projectId` (canonical step-state variable); propagates inherited `brandId`/`designSystemId`/`prdId` for cross-step decision gates. |
| `launch-studio.dispatchStackItems` | side-effect | Transitions ready WOP stack items `todo → doing` for a canvas type. Optionally resolves cross-step linked-project artifacts onto `${canvasTypeId}_resolvedArtifacts`. |

Both side-effectful. `dispatchStackItems` is cacheable; `linkStep` is not (mutates run-variable state).

## Pipeline

```
core.entities.projectCreate
  → launch-studio.linkStep
    → core.control.subWorkflow (the step's actual canvas workflow)
      → launch-studio.dispatchStackItems
```

## Host contract

```typescript
// host.launchStudio
ctx.launchStudio.getStudio(studioId)
  → Promise<Studio | null>
  // Studio = { brandId?, designSystemId?, prdId?, sharedArtifactRefs[], ... }

ctx.launchStudio.buildProjectContext({ studio, userId, canvasTypeId })
  → Promise<ProjectContext>

ctx.launchStudio.resolveLinkedArtifacts({ studio, userId, sourceCanvasTypeId })
  → Promise<Record<string, unknown>>

// host.kanban (shared with vendor.myndhyve.kanban)
ctx.kanban.getReadyTasks(boardId)
  → Promise<Array<{ id: string, ... }>>

ctx.kanban.moveTask(taskId, 'doing')
  → Promise<void>
```

## Behavioral notes

- Both nodes return `success: false` + `error` string on missing required inputs (no throw — mirrors legacy executors for back-compat with existing templates).
- `host_capability_missing` IS thrown when the host adapter itself is absent. Required inputs validate first.
- `linkStep` always sets `${stepId}_projectId` even when studio lookup returns null — that variable is the M3.1 view-model's canonical step-state read.
- `dispatchStackItems` returns immediately after transitioning items — actual task execution happens async via the host's TaskExecutor.

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve) — Phase 4 #1
- `vendor.myndhyve.kanban` — shares the `host.kanban` capability
- `vendor.myndhyve.entities` — `core.entities.projectCreate` is the upstream node in the LS pipeline
