# `vendor.myndhyve.market-intel-crew`

Vendor showcase agent pack. Wraps the existing 9 `vendor.myndhyve.market-intel-*` node typeIds into a single chat-driven Research Director persona.

| Pack name | `vendor.myndhyve.market-intel-crew` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 (`research-director`) |
| Signing key | `myndhyve-internal-1` |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Why this exists

The 9 `market-intel-*` node packs already implement the full VoC pipeline (query-builder → discovery → community-rank → thread-triage → content-extraction → voc-extraction → opportunity-scoring → ad-angles → audience-targeting). End-users currently consume them by authoring workflow JSON.

This pack adds a **chat-driven Research Director persona** that:

1. Takes a natural-language brief ("research the ICP for our enterprise data-platform offering").
2. Plans which pipeline steps are needed.
3. Orchestrates dispatch via the existing typeIds (`market-intel.query-builder`, etc.).
4. Synthesizes results into a single research deliverable.
5. Persists ICP / topic / cycle artifacts to long-term memory for re-use.

This converts the existing node-pack investment into an end-user-accessible agent surface without requiring users to author workflow JSON by hand.

## Tool allowlist

References all 9 published market-intel typeIds. The CI `check-agent-tool-allowlist.mjs` script (Phase 6 of the rollout) verifies these refs against the latest published versions.

## Handoff schemas

- `schemas/research-director.task.schema.json` — `{ brief, icp?, scope?, depth? }`
- `schemas/research-director.return.schema.json` — `{ summary, voc, opportunities, recommendedAngles, audienceTargeting, sources }`
