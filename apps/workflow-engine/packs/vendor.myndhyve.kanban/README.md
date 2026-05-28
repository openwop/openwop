# `vendor.myndhyve.kanban`

MyndHyve kanban-coordination pack. 7 nodes covering board lifecycle, task management, timeline planning, automation, and resource monitoring.

| Pack | `vendor.myndhyve.kanban` |
| peerDependencies | `host.kanban: supported` (+ `host.aiEnvelope` softly required by `task.decompose`) |

## Nodes (typeId-preserve)

| typeId | role |
|---|---|
| `kanban.board.create` | side-effect |
| `kanban.board.review` | side-effect (read with summary) |
| `kanban.task.assign` | side-effect |
| `kanban.task.decompose` | side-effect (AI-powered) |
| `kanban.timeline.plan` | side-effect (compute) |
| `kanban.workflow.automate` | side-effect |
| `kanban.resource.monitor` | side-effect (read) |

All side-effectful + cacheable. Engine Layer-2 cache covers replay cost-once.

## task.decompose AI dependency

`task.decompose` requires both `host.kanban` AND `host.aiEnvelope`. The pack manifest only declares `host.kanban` (peer-level), since the other 6 nodes don't need AI. Hosts without `aiEnvelope` can register the pack but `task.decompose` throws `host_capability_missing` at dispatch.

If you want strict peer-dep enforcement at register time, ship a separate pack with both deps; the 6-node base remains universally registerable.

## Workflow automate rule shapes

| Trigger | Action |
|---|---|
| `column-transition` | `assign`, `move-column`, `set-label`, `send-notification`, `invoke-workflow` |
| `due-date-approaching` | (same set) |
| `label-changed` | (same set) |
| `assignee-changed` | (same set) |

Closed enums on type fields; payload shape is rule-specific (allowed per `additionalProperties: true` on each).

## Host contract

```typescript
ctx.kanban.boardCreate({ name, columns, description?, projectId?, idempotencyKey })
  → Promise<{ boardId, createdAt }>

ctx.kanban.boardReview({ boardId, includeArchived, atRiskThresholdDays })
  → Promise<{ boardName?, totalTasks, columnCounts, atRiskTasks, reviewedAt? }>

ctx.kanban.taskAssign({ taskId, assigneeId, notifyAssignee, comment?, idempotencyKey })
  → Promise<{ previousAssigneeId?, assignedAt? }>

ctx.kanban.taskGet(taskId) → Promise<TaskDetail>            // optional accessor
ctx.kanban.taskCreateBatch({ parentTaskId, subtasks, idempotencyKey })
  → Promise<{ subtaskIds: string[] }>                        // optional, used when createOnBoard=true

ctx.kanban.timelinePlan({ boardId, scheduler, ... })
  → Promise<{ schedule, criticalPath, projectEndDate? }>

ctx.kanban.automateRules({ boardId, rules, replaceExisting, idempotencyKey })
  → Promise<{ activeRules, added, appliedAt? }>

ctx.kanban.resourceMonitor({ boardId, maxConcurrentPerAssignee, includeAgents })
  → Promise<{ assigneeLoad, wipBreaches, overdueTasks, monitoredAt? }>

ctx.aiEnvelope.generate(...) // for task.decompose
```

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve)
- `vendor.myndhyve.ai` — `task.decompose` shares the envelope-generation primitive
