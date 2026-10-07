# OpenWOP Pack Catalog

> **Status: current (v2).** A guide to what is published at [`packs.openwop.dev`](https://packs.openwop.dev), grouped by namespace. The registry is the authority: its v2 index, [`/v2/index.json`](https://packs.openwop.dev/v2/index.json), lists every pack with its kind, latest version and description, and each pack's own `index.json` lists its versions. Clients resolve registry paths through `endpoints` in [`/.well-known/openwop-registry.json`](https://packs.openwop.dev/.well-known/openwop-registry.json), not by building them ([`spec/v2/core/packs.md`](../spec/v2/core/packs.md) §"The registry tree"). The registry's source, signing keys and publishing gate live in [openwop/openwop-registry](https://github.com/openwop/openwop-registry).

**Catalog status:** 156 packs published, counted from the v2 index on 2026-10-06. This page does not list versions; read them from the registry.

To publish a pack, see [`PACK-AUTHOR-QUICKSTART.md`](PACK-AUTHOR-QUICKSTART.md). To claim a vendor namespace, see [`runbooks/VENDOR-ONBOARDING.md`](runbooks/VENDOR-ONBOARDING.md).

## By kind

| Kind | Packs | Normative rules |
| --- | --- | --- |
| `node` | 85 | [`packs.md`](../spec/v2/core/packs.md), [`node-pack-runtimes.md`](../spec/v2/core/node-pack-runtimes.md) |
| `workflow-chain` | 55 | [`workflow-chain-packs.md`](../spec/v2/core/workflow-chain-packs.md) |
| `connection` | 12 | [`connection-packs.md`](../spec/v2/core/connection-packs.md) |
| `artifact-type` | 1 | [`artifact-type-packs.md`](../spec/v2/core/artifact-type-packs.md) |
| `form-content` | 1 | [`form-content-packs.md`](../spec/v2/core/form-content-packs.md) |
| `card` | 1 | [`packs.md`](../spec/v2/core/packs.md) §"The manifest schema family" (`chat-card-pack-manifest`) |
| `prompt` | 1 | [`packs.md`](../spec/v2/core/packs.md) §"The manifest schema family" (`prompt-pack-manifest`) |

## Framework primitives (`core.openwop.*`)

Spec-canonical node packs that most workflows build on. Several are capability-gated: they declare a capability family in `peerDependencies` and run only on a host that advertises it ([`capabilities.md`](../spec/v2/core/capabilities.md)).

| Pack | Purpose |
| --- | --- |
| [`core.openwop.ai`](https://packs.openwop.dev/v2/packs/core.openwop.ai/index.json) | AI calls: chat completion, structured output, tool calling, embeddings, and multi-modal nodes. |
| [`core.openwop.triggers`](https://packs.openwop.dev/v2/packs/core.openwop.triggers/index.json) | Trigger shapes: webhook, schedule, event, form, manual, error, sub-workflow and more. |
| [`core.openwop.flow`](https://packs.openwop.dev/v2/packs/core.openwop.flow/index.json) | Flow control: if/switch/router, merge, iterate, aggregate, batch, wait, error handlers. |
| [`core.openwop.data`](https://packs.openwop.dev/v2/packs/core.openwop.data/index.json) | Data utilities: string, array, object, JSON, CSV, date-time, number. |
| [`core.openwop.http`](https://packs.openwop.dev/v2/packs/core.openwop.http/index.json) | HTTP and API calls: fetch, OpenAPI, GraphQL, gRPC, SSE, WebSocket, pagination, retry. |
| [`core.openwop.integration`](https://packs.openwop.dev/v2/packs/core.openwop.integration/index.json) | Messaging integrations: email, chat, SMS, voice, push notifications. |
| [`core.openwop.mcp`](https://packs.openwop.dev/v2/packs/core.openwop.mcp/index.json) | Model Context Protocol client and server nodes. |
| [`core.openwop.a2a`](https://packs.openwop.dev/v2/packs/core.openwop.a2a/index.json) | Agent-to-agent (A2A) client and server nodes. |
| [`core.openwop.agents`](https://packs.openwop.dev/v2/packs/core.openwop.agents/index.json) | Agent composition: a root agent node plus tool, memory and output-parser sub-nodes. |
| [`core.openwop.rag`](https://packs.openwop.dev/v2/packs/core.openwop.rag/index.json) | Retrieval-augmented generation: loaders, splitters, vector ops, retrievers. |
| [`core.openwop.web-search`](https://packs.openwop.dev/v2/packs/core.openwop.web-search/index.json) | A capability-gated web-search node routed through the host's `webSearch` family. |
| [`core.openwop.crypto`](https://packs.openwop.dev/v2/packs/core.openwop.crypto/index.json) | Crypto primitives: hash, HMAC, AEAD, signatures, JWT, TOTP, X.509. |
| [`core.openwop.storage`](https://packs.openwop.dev/v2/packs/core.openwop.storage/index.json) | State primitives: key-value, table, cache, blob, queue (capability-gated). |
| [`core.openwop.files`](https://packs.openwop.dev/v2/packs/core.openwop.files/index.json) | File, image, PDF and archive primitives (capability-gated). |
| [`core.openwop.db`](https://packs.openwop.dev/v2/packs/core.openwop.db/index.json) | SQL, NoSQL, search and vector primitives (capability-gated). |
| [`core.openwop.messaging`](https://packs.openwop.dev/v2/packs/core.openwop.messaging/index.json) | Queue and stream publish/consume (capability-gated). |
| [`core.openwop.hitl`](https://packs.openwop.dev/v2/packs/core.openwop.hitl/index.json) | Human-in-the-loop: form request, approval request, ask user. |
| [`core.openwop.obs`](https://packs.openwop.dev/v2/packs/core.openwop.obs/index.json) | Observability emitters: log, metric, trace span, alert. |
| [`core.openwop.skills-bridge`](https://packs.openwop.dev/v2/packs/core.openwop.skills-bridge/index.json) | Converts Agent Skills (`SKILL.md`) into OpenWOP agent manifests. |
| [`core.openwop.artifact-types`](https://packs.openwop.dev/v2/packs/core.openwop.artifact-types/index.json) | Example `artifact-type` pack. |
| [`core.openwop.forms.starters`](https://packs.openwop.dev/v2/packs/core.openwop.forms.starters/index.json) | Starter form templates (`form-content` pack). |
| [`core.openwop.examples`](https://packs.openwop.dev/v2/packs/core.openwop.examples/index.json) | Example workflows composing several packs. |
| [`core.openwop.agent-examples`](https://packs.openwop.dev/v2/packs/core.openwop.agent-examples/index.json) | Reference agent pack exercising every agent-manifest shape. |

## Agent packs (`core.openwop.agents.*`)

24 agent packs built on `core.openwop.agents`: single-purpose agents, multi-agent crews and patterns. They are `api-designer`, `audit-summarizer`, `classifier`, `code-reviewer`, `deep-research`, `devops-crew`, `doc-writer`, `document-author`, `expense-categorizer`, `frontend-designer`, `git-author`, `invoice-extractor`, `long-doc-summarizer`, `policy-reviewer`, `react`, `research-crew`, `sales-coach`, `sdr`, `structured-extractor`, `supervisor`, `support-crew`, `support-resolver`, `support-triage`, `test-author`.

## Workflow-chain packs (`core.openwop.workflows.*`)

50 packs of reusable workflow chains ([RFC 0013](../RFCS/0013-workflow-chain-packs.md)). They are `approvals`, `campaign-brief`, `campaign-channels`, `campaign-journeys`, `campaign-orchestration`, `campaign-sync`, `commerce`, `content`, `creative-briefs-reel`, `crm-ops`, `csm-ops`, `customer-onboarding`, `data-ops`, `destination-sync`, `devops`, `exec-ops`, `feedback-triage`, `finance`, `funnels`, `inbox`, `incident-postmortem`, `insights-suite`, `it-support`, `kicktodo-accountability`, `kicktodo-challenge-factory`, `kicktodo-integrations`, `kicktodo-loops`, `kicktodo-plan-generation`, `kicktodo-replan`, `kicktodo-research`, `knowledge`, `lighthouse`, `market-intel`, `marketing`, `mcp-tool-projections`, `meeting-ops`, `notebooks`, `people-hr`, `podcasts`, `production-plan`, `release-comms`, `research`, `sales-outreach`, `seo-content-ops`, `slides-design`, `starters`, `support`, `walkthroughs`, `weekly-digest`, `workflow-author`.

## Connection packs (`core.openwop.connections.*`)

12 declarative OAuth provider definitions ([RFC 0095](../RFCS/0095-connection-packs-portable-provider-definitions.md)); none carries credential material. Most need the host operator to register an OAuth client before the provider activates. They are `github`, `google-ads`, `google-workspace`, `jira`, `linkedin-ads`, `meta-ads`, `microsoft365`, `netsuite`, `notion`, `salesforce`, `tiktok-ads`, `workday`.

## Vendor and community packs

| Namespace | Packs | What they are |
| --- | --- | --- |
| `vendor.myndhyve.*` | 39 | MyndHyve's node packs: ads studio and ad-platform publishing, market intelligence, landing pages, app builder, campaign sequences, brand, canvas, entities, knowledge and web research. Many need host-specific extension families ([`spec/v2/ext/`](../spec/v2/ext/)). |
| `vendor.openwop-app.*` | 3 | Workflow chains used by the [openwop-app](https://github.com/openwop/openwop-app) reference app. |
| `vendor.openwop.*` | 4 | Reference samples for the `card`, `prompt` and `workflow-chain` kinds, plus the App Builder chains. |
| `community.*` | 1 | `community.openwop-team.demo`, the community-tier demo pack. |

## Use cases

| Use case | Packs | Example workflow |
| --- | --- | --- |
| Voice-of-customer research to ad copy | `vendor.myndhyve.market-intel-*` → `vendor.myndhyve.ads-copy-generate` | [`market-intel-pipeline/`](https://github.com/openwop/openwop-examples/tree/main/examples/market-intel-pipeline) |
| Publish a paid-ads creative to Meta, Google or TikTok | `vendor.myndhyve.ads-*` ending in `ads-publish-meta`, `-google` or `-tiktok` | [`ads-publish-pipeline/`](https://github.com/openwop/openwop-examples/tree/main/examples/ads-publish-pipeline) |
| RAG-grounded chat | `vendor.myndhyve.knowledge-tools` → `core.openwop.ai` | [`rag-grounded-chat/`](https://github.com/openwop/openwop-examples/tree/main/examples/rag-grounded-chat) |

## See also

- [`spec/v2/core/packs.md`](../spec/v2/core/packs.md) — manifests, the registry tree, peer-dependency identifiers, signing, version manifests
- [`spec/v2/core/capabilities.md`](../spec/v2/core/capabilities.md) — the capability families a pack can require
- [`PACK-AUTHOR-QUICKSTART.md`](PACK-AUTHOR-QUICKSTART.md) — author and publish a pack
- [`runbooks/PACK-LIFECYCLE.md`](runbooks/PACK-LIFECYCLE.md) — deprecate, yank, new versions
- [`governance/registry-policy.md`](governance/registry-policy.md) — namespaces, trust tiers, submission policy
