# vendor.myndhyve.app-builder

> Two App Builder typeIds against `host.chat` + `host.aiEnvelope.await` (both v1-specced). Per-screen single-task generation + iterate-tasks multi-task serial loop. **First pack consuming both `host.chat` AND `host.aiEnvelope.await` together.**

## Nodes

| typeId | Role | What it does |
|---|---|---|
| `app-builder.per-screen` | action (chat+envelope) | Sends a per-screen prompt via `ctx.chat.sendMessage`, awaits the typed envelope (default `screen.emit`) via `ctx.aiEnvelope.await`. Bounded retry on timeout (config.taskRetryCount). |
| `app-builder.iterate-tasks` | action (chat+envelope) | Multi-task loop over feature tasks extracted from a plan artifact (4 AI shapes supported). Serial; task-level failure isolation by default; `failOnAnyTaskError` opts into all-or-nothing. |

## Required host capabilities

```json
"peerDependencies": {
  "host.chat": "supported",
  "host.aiEnvelope.await": "supported"
}
```

- `ctx.chat.sendMessage(...)` per [spec §host.chat](../../spec/v1/host-capabilities.md#host-chat) — pack invokes with `{ role: 'user', content, idempotencyKey }`.
- `ctx.aiEnvelope.await({ envelopeType, timeoutMs })` per [spec §host.aiEnvelope](../../spec/v1/host-capabilities.md#host-aiEnvelope) — pack reads `{ envelopeType, payload?, envelopeId?, timedOut? }`.

## What's in the pack vs. what's the host's job

| Concern | In pack | Notes |
|---|---|---|
| Prompt construction | ✅ | `buildPerScreenPrompt` lifted verbatim from `perScreenPrompt.ts` |
| Plan-task extraction | ✅ | Robust 4-shape parser from `iterateTasksExecutor.ts:extractFeatureTasks` |
| Chat-send + envelope-await | ✅ | Via the two host capabilities |
| Bounded retry on timeout | ✅ | `taskRetryCount` knob |
| Categorized failure reasons | ✅ | `timeout / cancelled / envelope-malformed / ai-no-response / route-failed / other` |
| Failures-by-reason histogram | ✅ | For host-side dashboards |
| **Progress card rendering** | ❌ | Host concern — host MAY emit progress cards from `taskResults[]` |
| **Per-task completion cards** | ❌ | Host concern — `taskResults[]` carries per-task screenId for host to render |
| **WOP Pilot materializer** | ❌ | MyndHyve-specific WopStackItem minting; host wires that separately |
| **Engine-internal envelope routing** | ❌ | `_currentAIStepNode` / `_injectedEnvelopeResult` vars are spec-internal; `host.aiEnvelope.await` handles |
| **Telemetry calls** | ❌ | Host emits from return values (recordAutoPlayTask is host's pattern, not pack's) |
| **Artifact-sync registration check** | ❌ | Host responsibility before invoking |

## Failure categorization

Mirrors the source `TaskFailureReason` taxonomy:

| Reason | Match | Retryable |
|---|---|---|
| `timeout` | "Timed out waiting for..." / "timeout" | **Yes** — bounded by `taskRetryCount` |
| `cancelled` | "Workflow cancelled" / abort signal | No |
| `envelope-malformed` | "EnvelopeParser" / "invalid JSON" / "could not parse" | No |
| `ai-no-response` | "empty response" / "no content" / "zero chunks" | Yes (via host retry) |
| `route-failed` | "injection failed" / "run no longer active" | No |
| `other` | catch-all | No |

## Plan-task extraction — 4 AI shapes supported

```
1. Canonical PlanModel:     { steps: [...] }
2. AI default:              { tasks: [...] }
3. AI-confused envelope:    { "tasks.create": [...] }
4. AI-nested phase wrapper: { "tasks.create": { phases: [{ tasks: [...] }] } }
```

Filtering priority:
1. `task.isFeatureTask === true` — explicit feature-task flag
2. `task.kind in ['design', 'action', 'feature']` — canonical kind
3. **AI fallback** — everything except explicit `'planning'` phase/kind (permissive — better one extra placeholder than zero output)

This robustness is intentional and load-bearing — production runs have observed all 4 shapes from drifting AI plan output.

## Smoke test surface

```js
const fakeChat = { sendMessage: async () => ({ messageId: 'm1', sentAt: new Date().toISOString() }) };
const fakeEnvelope = { await: async () => ({ envelopeType: 'screen.emit', payload: { artifactId: 'screen-abc' }, envelopeId: 'env-1' }) };

const r = await nodes['app-builder.per-screen']({
  chat: fakeChat,
  aiEnvelope: fakeEnvelope,
  inputs: { task: { id: 't1', title: 'Onboarding' }, prd: { title: 'AcmeApp' } },
});
// r.outputs.screenId === 'screen-abc'
```

## Differences vs MyndHyve source

**`engine.on('envelope:injected', ...)` listener → `ctx.aiEnvelope.await(...)`**: source maintains its own listener + cleanup. Pack delegates to the host's `await` primitive — same effective contract, less boilerplate.

**`pushStepNode` / `popStepNodeForNode` engine-internal accounting → omitted**: this is the host's envelope-routing implementation detail. The pack doesn't need to participate.

**Progress card rendering**, **per-task completion cards**, **pilot materializer**, **telemetry calls**, **artifact-sync precheck** — all host concerns, not in pack. Pack returns the data the host needs (`taskResults[]` + `failuresByReason`).

**`failOnAnyTaskError`**: source defaults to `false` (task-level failure isolation). Pack preserves this. Skipped tasks (abort-mid-iteration OR fail-fast-tripped) carry `skipped: true` so the host can distinguish them from genuine failures.

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `perScreen` + helpers | `perScreenExecutor.ts` (80) + `perScreenPrompt.ts` (113) | ~190 |
| `iterateTasks` + plan-shape parser | `iterateTasksExecutor.ts` (250 of 794 relevant) | ~250 |

~440 LOC of relevant source ported to ~440 LOC pure JS (no compression — input-shape parsing is verbatim).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
