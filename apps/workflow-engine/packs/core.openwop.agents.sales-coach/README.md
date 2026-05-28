# `core.openwop.agents.sales-coach`

Sales Coach agent. Analyzes call transcripts for coaching moments, recommends next steps, tracks rep development arc.

| Pack name | `core.openwop.agents.sales-coach` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Coaching dimensions

| Dimension | What it measures |
|---|---|
| `talkRatio` | rep talk-time vs prospect talk-time (target: 40-50% rep) |
| `discoveryDepth` | depth + breadth of discovery questions (vs pitching too early) |
| `objectionHandling` | whether objections were acknowledged, reframed, resolved |
| `nextStepClarity` | did the rep secure a specific, time-bound next step |
| `confidenceSignal` | rep's tone + assertiveness |

## Long-term memory

Tracks per-rep performance over time. Coaching recommendations cite recent improvements ("you've doubled your discovery questions in 3 weeks — keep going") or regressions ("the next-step ask was clear in your last 5 calls but missed today").

Triggers RFC 0004 redaction harness — prospect-side PII in transcripts is masked before persistence.

## Handoff schemas

- `schemas/sales-coach.task.schema.json` — `{ transcript? OR summary, repId, callMetadata?, focusDimensions? }`
- `schemas/sales-coach.return.schema.json` — `{ dimensionScores, coachingMoments[], recommendations[], developmentArc }`
