# `core.openwop.agents.support-resolver`

Resolves support tickets by retrieving from the KB and drafting grounded answers. Escalates on low confidence.

| Pack name | `core.openwop.agents.support-resolver` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Pairs with `support-triage`

Typical workflow: ticket → `support-triage` (decides queue + priority) → `support-resolver` (drafts answer or escalates) → human reviews.

## Grounding

Every claim in the answer must be supported by retrieved KB content. The return payload includes a `citations[]` array mapping answer segments to source IDs. If retrieval returned weak hits, the resolver escalates rather than hallucinating.

## Long-term memory

Persists `(query-shape, resolved-from-source, customer-satisfaction-signal-if-known)` for resolution-pattern analysis. Triggers RFC 0004 redaction harness to mask any customer PII before persistence.

## Handoff schemas

- `schemas/support-resolver.task.schema.json` — `{ ticket: {subject, body}, knowledgeSourceIds, escalationContext? }`
- `schemas/support-resolver.return.schema.json` — `oneOf [{ answer, citations, suggestedActions }, { escalation: {reason, suggestedSpecialist} }]`
