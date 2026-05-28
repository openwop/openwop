# `core.openwop.agents.support-triage`

Customer support triage agent. Categorizes inbound tickets, routes to queues, signals severity + customer-segment priority.

| Pack name | `core.openwop.agents.support-triage` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders` |
| License | Apache-2.0 |

## Why this exists

Customer support is the highest-production-adoption agent vertical in 2026. Triage is the cheapest, highest-impact starting point — it doesn't take action, it just routes. Pairs naturally with `core.openwop.agents.support-resolver` (which actually answers).

## Outputs

- `queue` — caller-supplied list of valid queues; agent picks one.
- `severity` — `low` / `medium` / `high` / `critical`.
- `priority` — derived from severity + customer segment (a `high`-severity ticket from an enterprise customer is `P1`; same severity from a free-tier user might be `P3`).
- `skillTags[]` — suggested skill tags for routing within a queue.
- `rationale` — one-paragraph explanation.

## Handoff schemas

- `schemas/support-triage.task.schema.json` — `{ subject, body, customerSegment?, validQueues, skillVocabulary? }`
- `schemas/support-triage.return.schema.json` — `{ queue, severity, priority, skillTags, rationale }`
