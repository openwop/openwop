# `core.openwop.agents.audit-summarizer`

Compresses raw audit logs into structured executive summaries. Highlights anomalies. Tracks pattern shifts over time.

| Pack name | `core.openwop.agents.audit-summarizer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Input shapes

Supports any structured log shape — caller declares the schema via `task.logSchema` so the agent knows what fields exist (actor, action, resource, timestamp, etc.).

## Anomaly types

- `unusual_actor_access` — actor accessed resources they haven't touched before
- `off_hours_activity` — actions outside normal business windows
- `configuration_drift` — config-change actions that don't trace to a known change-management process
- `policy_violation` — actions matching caller-supplied violation patterns
- `volume_anomaly` — action volume significantly higher/lower than baseline

## Long-term memory

Persists `(period, actor-summary-stats, resource-summary-stats, anomaly-counts-by-type)` so subsequent runs can detect pattern shifts. Triggers RFC 0004 redaction harness for any actor/resource identifiers configured as PII.

## Handoff schemas

- `schemas/audit-summarizer.task.schema.json` — `{ logs[], logSchema, periodLabel, violationPatterns?, baselineRef? }`
- `schemas/audit-summarizer.return.schema.json` — `{ executiveSummary, anomalies, periodStats, patternShifts }`
