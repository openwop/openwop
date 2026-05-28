# core.openwop.a2a

Client-side A2A (Agent-to-Agent) primitives. Workflows consume remote A2A agents via the host's A2A client (`ctx.a2a.*` surface — same shape openwop already uses for `ctx.mcp.*`). Tracks `spec/v1/a2a-integration.md` (FINAL v1).

## TypeIds

| typeId | role | streams? | purpose |
|---|---|---|---|
| `core.openwop.a2a.discover-agent` | side-effect | no | Fetch `/.well-known/agent.json` (or extended card if authenticated). |
| `core.openwop.a2a.send-message` | side-effect | no | `message/send` — synchronous task creation. |
| `core.openwop.a2a.send-and-stream` | streaming-output | yes | `message/stream` — opens SSE; emits per-event downstream. |
| `core.openwop.a2a.get-task` | side-effect | no | `tasks/get`. |
| `core.openwop.a2a.list-tasks` | side-effect | no | `tasks/list` (cursor-paginated). |
| `core.openwop.a2a.cancel-task` | side-effect | no | `tasks/cancel`. |
| `core.openwop.a2a.resubscribe` | streaming-output | yes | `tasks/resubscribe` — re-attach an SSE stream after disconnect. |
| `core.openwop.a2a.multi-turn-coordinator` | side-effect | no | Suspends the workflow on `INPUT_REQUIRED` / `AUTH_REQUIRED` task states; resumes by continuing the same task. |
| `core.openwop.a2a.push-config-create` | side-effect | no | Register a webhook for async task delivery. |
| `core.openwop.a2a.push-config-get` | side-effect | no | Read a registered webhook config. |
| `core.openwop.a2a.push-config-list` | side-effect | no | List registered webhook configs for a task. |
| `core.openwop.a2a.push-config-delete` | side-effect | no | Remove a webhook config. |

Replay model: each node declares `cacheable + side-effectful`. Engine's Layer-2 invocation log keys on (runId, nodeId, request-hash).

Server-side A2A (workflow IS an A2A agent) lives in Wave 3 (see `docs/PACK-CATALOG.md`).
