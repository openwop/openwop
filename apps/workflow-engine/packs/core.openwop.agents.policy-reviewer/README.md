# `core.openwop.agents.policy-reviewer`

Reviews content against caller-supplied policy rules. Pass / fail / borderline / N/A per rule with quoted evidence.

| Pack name | `core.openwop.agents.policy-reviewer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## Use cases

- Ad policy review (Meta/Google/TikTok compliance)
- Content moderation (community guidelines)
- Code-of-conduct review (HR / employee communications)
- Regulatory compliance (GDPR claims, financial disclaimers)
- Brand-voice review (claims that match brand guidelines)

## Decision values

| Decision | Meaning |
|---|---|
| `pass` | rule clearly satisfied |
| `fail` | rule clearly violated; cite the violating phrase |
| `borderline` | could go either way; escalate to human |
| `n/a` | rule doesn't apply to this content |

## Handoff schemas

- `schemas/policy-reviewer.task.schema.json` — `{ content, rules: [{id, description, severity?}], knowledgeSourceIds? }`
- `schemas/policy-reviewer.return.schema.json` — `{ overallDecision, ruleDecisions: [{ruleId, decision, evidence, rationale}], blockingFailureCount }`
