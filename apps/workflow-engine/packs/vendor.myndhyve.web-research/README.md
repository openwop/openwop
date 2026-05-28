# `vendor.myndhyve.web-research`

MyndHyve web-research pack. Search → fetch → research → synthesize pipeline.

| Pack | `vendor.myndhyve.web-research` |
| peerDependencies | `host.webResearch: supported`, `host.aiEnvelope: supported` |
| License | Apache-2.0 |

## Nodes (typeId-preserve)

| typeId | role | what it does |
|---|---|---|
| `core.webResearch.webSearch` | side-effect | Search via host's adapter (Google CSE / Bing / Brave / Perplexity / Kagi); returns top N results |
| `core.webResearch.fetchUrls` | side-effect | Bulk URL fetch with research-specific policy (robots.txt, body caps, readability extraction). Distinct from `core.openwop.http.fetch` (single raw request). |
| `core.webResearch.researchWeb` | side-effect | End-to-end: query → search → fetch top N → extract → citations |
| `core.webResearch.synthesize` | side-effect | AI synthesis: citations → typed envelope (`research.summary`, `competitor.profile`, etc.) |

All four side-effectful + cacheable. Engine Layer-2 cache covers replay cost-once.

## Pipeline example

```yaml
nodes:
  - id: research
    typeId: core.webResearch.researchWeb
    inputs: { query: "surf shop business model" }
  - id: synth
    typeId: core.webResearch.synthesize
    config:
      envelopeType: "research.summary"
      systemPrompt: "Summarize the cited content for a competitor brief."
    inputs:
      citations: "{{ research.outputs.citations }}"
edges:
  - { from: research, to: synth }
```

## Host contract

```typescript
ctx.webResearch.search({ query, maxResults, engine?, language?, region?, safeSearch?, siteFilter? })
  → Promise<{ results: Array<{ url, title, snippet?, rank? }>, engine, totalResults? }>

ctx.webResearch.fetchBatch({ urls, concurrency?, perRequestTimeoutMs?, respectRobotsTxt?, maxBodyBytes?, extractReadable? })
  → Promise<{ pages: Array<{ url, status, contentType?, title?, extractedText?, rawBody?, truncated?, fetchedAt?, error? }> }>

ctx.webResearch.research({ query, maxResults, ...filters })
  → Promise<{ citations: Array<{ url, title, snippet?, content, rank?, fetchedAt? }>, engine?, totalResults? }>

// synthesize uses ctx.aiEnvelope.generate from the vendor.myndhyve.ai contract
```

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve)
- `vendor.myndhyve.ai` — synthesize shares the envelope-generation primitive
