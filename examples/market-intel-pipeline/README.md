# market-intel-pipeline

> Reference workflow definitions composing the [vendor.myndhyve.market-intel-* pack catalog](https://packs.openwop.dev) into end-to-end VoC research pipelines. **9 packs orchestrated declaratively** — replaces the 830-LOC `executeMarketResearch` orchestrator that lives inside MyndHyve's `src/canvas-types/campaign-studio/nodes/marketIntel/executors.ts`.

## The two pipelines

| Workflow | When to use | Nodes |
|---|---|---|
| [`market-intel-research.json`](./market-intel-research.json) | You have ICP + product context. Want to generate explicit search queries first, then discover sources, then run the full VoC pipeline. | 9 |
| [`market-intel-ai-first-research.json`](./market-intel-ai-first-research.json) | You have a topic + ICP but no pre-curated queries. AI generates source URLs from the topic alone; thread-triage pre-filters before expensive extraction. | 8 |

## Conceptual pipeline (canonical)

```
                       ┌─────────────────────────────────┐
                       │ market-intel.query-builder      │  (optional — only in market-intel-research)
                       │ → queryGroups / competitorQueries│
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │ market-intel.ai-discovery       │
                       │ → sources[] / communities[]     │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │ host.webResearch.fetchBatch     │  (production-only: wired by host)
                       │ → fetched pages[]               │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │ market-intel.thread-triage      │  (optional cost-aware pre-filter)
                       │ → extractionQueue[]              │
                       └────────────────┬────────────────┘
                                        │
       ┌────────────────────────────────▼────────────────────────────────┐
       │   PER-PAGE FAN-OUT (host orchestrator: RFC 0007 fanOutSupported) │
       │                                                                  │
       │  ┌──────────────────────────────────────┐                       │
       │  │ market-intel.content-extraction ×N   │ → structured pages   │
       │  └──────────────────┬───────────────────┘                       │
       │                     │                                            │
       │  ┌──────────────────▼───────────────────┐                       │
       │  │ market-intel.voc-extraction ×N       │ → records, summary   │
       │  └──────────────────┬───────────────────┘                       │
       └────────────────────┬─┴──────────────────────────────────────────┘
                            │  (aggregate VoC records)
                            ▼
                       ┌─────────────────────────────────┐
                       │ market-intel.opportunity-scoring │
                       │ → rankedCommunities + rankedAngles│
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │ market-intel.ad-angles          │
                       │ → ad-angle briefs[]              │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │ market-intel.audience-targeting │
                       │ → per-platform targeting packs  │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │ ads.copy.generate               │
                       │ → ad-copy variants per placement│
                       └─────────────────────────────────┘
```

The reference workflow JSONs in this directory express the **single-source linear path** (no fan-out). For multi-source pipelines, hosts with RFC 0007 `fanOutSupported: true` translate the dispatcher's `nextWorkerIds.length > 1` into parallel runs of `content-extraction` + `voc-extraction`, then re-aggregate before `opportunity-scoring`.

## Required host capabilities

| Capability | Used by |
|---|---|
| `aiProviders: supported` | All 8/9 nodes (every typeId calls `ctx.callAI`) |
| `host.webResearch.fetchBatch: supported` (production) | The `fetchBatch` step between `ai-discovery` and `content-extraction`. Reference JSONs leave this step OFF the DAG and instead reference `$.run.variables.pageHtml` — host-fetched out-of-band. |

## Pack inventory

All 9 packs are published at `packs.openwop.dev`:

| Pack | typeId(s) | Spec PR |
|---|---|---|
| [`vendor.myndhyve.market-intel-query-builder@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-query-builder/index.json) | `market-intel.query-builder` | — |
| [`vendor.myndhyve.market-intel-discovery@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-discovery/index.json) | `market-intel.ai-discovery` | — |
| [`vendor.myndhyve.market-intel-thread-triage@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-thread-triage/index.json) | `market-intel.thread-triage` | — |
| [`vendor.myndhyve.market-intel-content-extraction@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-content-extraction/index.json) | `market-intel.content-extraction` | — |
| [`vendor.myndhyve.market-intel-voc@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-voc/index.json) | `market-intel.voc-extraction` | — |
| [`vendor.myndhyve.market-intel-opportunity-scoring@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-opportunity-scoring/index.json) | `market-intel.opportunity-scoring` | — |
| [`vendor.myndhyve.market-intel-ad-angles@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-ad-angles/index.json) | `market-intel.ad-angles` | — |
| [`vendor.myndhyve.market-intel-audience-targeting@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.market-intel-audience-targeting/index.json) | `market-intel.audience-targeting` | — |
| [`vendor.myndhyve.ads-copy-generate@1.0.0`](https://packs.openwop.dev/v1/packs/vendor.myndhyve.ads-copy-generate/index.json) | `ads.copy.generate` | — |

(`vendor.myndhyve.market-intel-community-rank` is an optional refinement step between `ai-discovery` and the rest — not in the reference DAGs but available for hosts that want to refine candidate communities before extraction.)

## Why a workflow definition, not an orchestrator pack?

The architect review concluded: **orchestration belongs to workflow authors in openwop**, not to leaf packs. Shipping `market-intel.research` as a pack would duplicate ~830 LOC of sub-prompt logic already encoded in the 9 leaf packs, AND violate openwop's separation of concerns (packs are nodes; workflows are graphs).

This directory's `.json` files are the canonical answer: declarative graphs that the host runs through its workflow engine, dispatching each node to the appropriate published pack at runtime.

## Activation

To use one of these workflows on an OpenWOP host:

1. Ensure the host advertises `aiProviders: supported` (+ `host.webResearch.fetchBatch: supported` for the production fan-out path).
2. Ensure the host's pack registry has the 9 listed packs available at compatible versions.
3. POST the workflow JSON to `/v1/workflows` (host endpoint).
4. POST a run via `/v1/runs` with `{ workflowId: "vendor.myndhyve.market-intel-research", variables: { researchTopic, icpContext, productContext } }`.

See [`spec/v1/rest-endpoints.md`](../../spec/v1/rest-endpoints.md) for the run lifecycle wire protocol.

## What's NOT in these JSONs

- **Multi-source fan-out** — left to host orchestrator (RFC 0007).
- **`market-intel.community-rank`** — optional refinement node; add between `discover-sources` and `extract-content` when candidate communities need ranking.
- **`market-intel.research` and `market-intel.ai-first-research` as typeIds** — *intentionally not packs*. The orchestrator-as-pack approach was reviewed and rejected; these workflow definitions are the canonical answer.
- **Paid-ads publishing** — the `ads.copy.generate` terminal node produces copy variants; to publish those to Meta / Google / TikTok, chain the output into [`examples/ads-publish-pipeline/`](../ads-publish-pipeline/). The bridge is the `audience-targeting.outputs.targetingPacks` field: the matching platform's targeting pack maps directly into the publish pipeline's `targeting` variable.

## License

Apache-2.0.
