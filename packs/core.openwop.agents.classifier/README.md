# `core.openwop.agents.classifier`

Fast single-shot text classifier. Caller supplies labels + multi-label flag; agent picks the best-fit label(s) with confidence + rationale.

| Pack name | `core.openwop.agents.classifier` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders` |
| License | Apache-2.0 |

## When to use it

- Routing decisions ("which queue does this ticket go to?")
- Intent detection ("what is the user asking for?")
- Tagging ("which 3 tags from this list apply?")
- Content moderation flags ("does this match any policy category?")

For free-form extraction, use `core.openwop.agents.structured-extractor`. For research-grade classification with retrieval, build a custom workflow.

## Multi-label vs single-label

The `task.multiLabel` flag controls:
- `false` (default) — return exactly one label.
- `true` — return 0..N labels (each above its own confidence threshold).

## Handoff schemas

- `schemas/classifier.task.schema.json` — `{ input, labels: [{id, description}], multiLabel?, language? }`
- `schemas/classifier.return.schema.json` — `{ labels: [{id, confidence, rationale}], stoppedReason }`
