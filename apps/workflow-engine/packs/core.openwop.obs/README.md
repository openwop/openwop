# core.openwop.obs

Observability emission primitives. Workflows publish logs, metrics, traces, and alerts under the canonical `openwop.*` OTel namespace per `spec/v1/host-extensions.md` and `spec/v1/observability.md`. The host owns the actual OTel collector — these nodes are thin emitters that delegate to `ctx.observability` when the host advertises it, or no-op gracefully when it does not.

## TypeIds

| typeId | role | purpose |
|---|---|---|
| `core.obs.log` | side-effect | Structured log emit (level, message, attributes). |
| `core.obs.metric-counter` | side-effect | Increment a counter under `openwop.workflow.*`. |
| `core.obs.metric-gauge` | side-effect | Set a gauge value. |
| `core.obs.metric-histogram` | side-effect | Record a histogram sample. |
| `core.obs.trace-span-start` | side-effect | Start a child span; returns a span handle to a downstream `trace-span-end`. |
| `core.obs.trace-span-end` | side-effect | End a span by handle, optionally setting `status` + `attributes`. |
| `core.obs.alert-fire` | side-effect | Fire an alert event downstream alert routers consume (Slack / PagerDuty / email vendor packs). |

Every emission is namespaced under `openwop.workflow.<attribute>` if not already prefixed, per `host-extensions.md` §"Canonical prefixes".
