# `core.openwop.agents.sdr`

Sales Development Representative agent. Researches a prospect, drafts personalized outreach across email/LinkedIn/SMS, persists prospect history for follow-ups.

| Pack name | `core.openwop.agents.sdr` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Why this exists

SDR agents are the highest-ROI vertical in 2026 (3.4-month median payback per IDC enterprise data). Mirrors Salesforce Agentforce's flagship "Sales Development Rep" template + Relevance AI's SDR agent + Gumloop's sales pack.

## Channels

- **Email** — full message body, subject line, plain-text fallback. ~300 words max.
- **LinkedIn** — InMail or comment. 300-char InMail limit honored.
- **SMS** — 1-3 messages of ≤160 chars each. No links unless requested.

## Long-term memory

`memoryShape.longTerm: true` — persists `(prospect-id, persona-derived-attributes, prior-message-summaries, response-signals)` for follow-up sequences. Triggers RFC 0004 redaction harness to mask any PII in retrieved enrichment that shouldn't persist.

## Handoff schemas

- `schemas/sdr.task.schema.json` — `{ prospect: {name, company, role, contact}, channel, intent, priorContextRef? }`
- `schemas/sdr.return.schema.json` — `{ message, subject?, channel, tone, followupRecommendation? }`
