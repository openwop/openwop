# OpenWOP — Open Workflow Orchestration Protocol

**OpenWOP is an open, wire-level protocol for multi-agent workflow orchestration.** It defines how AI agents, deterministic tools, sub-workflows and human reviewers take turns inside one durable, suspendable, replayable run, and how independent hosts (workflow engines, SDKs, debuggers, agent runtimes) interoperate over the same contract.

## Start here

> **New to OpenWOP?** Watch the [one-and-a-half-minute film](https://www.youtube.com/watch?v=d5wD-NrhW3M), then pick one:
>
> - **Try it, no sign-up:** [app.openwop.dev](https://app.openwop.dev/), the reference app ([privacy](https://app.openwop.dev/privacy)).
> - **Run it on your own computer:** the [quickstart](https://openwop.dev/quickstart/) starts a small practice host in a few minutes.
> - **Build a host:** start with [`docs/IMPLEMENT-CORE.md`](./docs/IMPLEMENT-CORE.md), not with the whole corpus. We are looking for the first independent implementation; [open an issue](https://github.com/openwop/openwop/issues/new) if you are trying one.
> - **See every repository:** the SDKs, CLI, examples, packs and white-label app are listed at [github.com/openwop](https://github.com/openwop).

More: [every film](https://openwop.dev/videos/) · [the paper](https://doi.org/10.5281/zenodo.20576239) (Zenodo, CC BY 4.0; evidence in [`openwop/openwop-paper`](https://github.com/openwop/openwop-paper)) · [openwop.dev](https://openwop.dev/)

## Status

**The protocol is at major 2.** [`spec/v2/core/`](./spec/v2/core/) is the normative tree: thirty `Stable` documents under a kernel word budget, with optional extensions in [`spec/v2/ext/`](./spec/v2/ext/) and one declaration file, [`spec/v2/declaration.json`](./spec/v2/declaration.json). The corpus version is in [`spec/v2/release.json`](./spec/v2/release.json).

**v1 has reached end of support** ([RFC 0234](./RFCS/0234-maintainer-set-v1-end-of-support.md)). The v1 tree is frozen at [`spec/v1/`](./spec/v1/README.md) for clients that still speak it; new work targets v2. Migration: [`docs/migration/v1-to-v2.md`](./docs/migration/v1-to-v2.md).

> **RFC status (237 RFCs excluding template):** RFCs that are `Accepted` (232), that are `Active` (3 — RFC 0121, RFC 0222, RFC 0228), and that are `Draft` (1 — RFC 0038 Parked). Per-RFC detail: [`docs/PROTOCOL-STATUS.md`](./docs/PROTOCOL-STATUS.md).

What the protocol does not yet prove is listed in [`docs/KNOWN-LIMITS.md`](./docs/KNOWN-LIMITS.md).

## Install

> **Published artifacts.** Protocol contract, 2.x line: [`@openwop/openwop-conformance`](https://www.npmjs.com/package/@openwop/openwop-conformance) (npm, **v2.45.30**) with its exact-pinned contract peer [`@openwop/spec-artifacts`](https://www.npmjs.com/package/@openwop/spec-artifacts) (**v2.45.30**), both published from this repo on the corpus tag. Client SDKs, 2.x line: [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) (npm, **v2.5.0**) · [`openwop-client`](https://pypi.org/project/openwop-client/) (PyPI, **v2.5.0**) · `github.com/openwop/openwop-sdks/go/v2` (Go modules; tag `go/v2.5.0`). The three SDKs ship from [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks) at feature parity, and the conformance suite versions independently (currently **v2.45.30**). The 1.x SDK line ([`github.com/openwop/openwop-sdks/go`](https://pkg.go.dev/github.com/openwop/openwop-sdks/go) (Go modules, **v1.7.0**), `@openwop/openwop@1`, `openwop-client<2`) remains installable for v1 clients.

Measure a host with the suite:

```bash
npm install --legacy-peer-deps @openwop/openwop-conformance @openwop/spec-artifacts
OPENWOP_BASE_URL=https://your-host.example npx openwop-conformance --target-major 2
```

## What OpenWOP gives you

| Concern | Guarantee | Spec |
| --- | --- | --- |
| **Durable suspend and resume** | A human-gated or long-running step does not pin a process; the run persists and resumes against the same state. | [`interrupt.md`](./spec/v2/core/interrupt.md), [`persistence.md`](./spec/v2/core/persistence.md) |
| **Replay and fork** | Any point in a run's event log can be forked into a new run, in `replay` or `branch` mode. | [`replay.md`](./spec/v2/core/replay.md) |
| **Versioning** | Hosts and clients negotiate the protocol version, and a deploy never breaks an in-flight run. | [`versioning.md`](./spec/v2/core/versioning.md) |
| **Events and streaming** | One closed event envelope, delivered by SSE (with stream modes), long-poll and webhooks. | [`events.md`](./spec/v2/core/events.md), [`webhooks.md`](./spec/v2/core/webhooks.md) |
| **Human in the loop** | One `interrupt` shape for approval, clarification, refinement and cancellation. | [`interrupt.md`](./spec/v2/core/interrupt.md) |
| **Idempotency** | HTTP `Idempotency-Key` for retries and an engine invocation id for replays. | [`idempotency.md`](./spec/v2/core/idempotency.md) |
| **Identity and secrets** | Tenant-bound ids, auth lanes, and per-tenant credentials that never enter a workflow definition. | [`identity.md`](./spec/v2/core/identity.md), [`oauth.md`](./spec/v2/core/oauth.md) |
| **Multi-agent execution** | Orchestrators, workers, sub-workflows and agent identity, with reasoning events. | [`execution.md`](./spec/v2/core/execution.md) |
| **Packs** | Signed, versioned bundles of nodes, agents, workflow chains, forms and connections. | [`packs.md`](./spec/v2/core/packs.md) |
| **Interop** | OpenWOP runs the workflow; MCP exposes tools to it, and A2A carries messages between agents on different hosts. | [`interop.md`](./spec/v2/core/interop.md) |
| **Capabilities** | One discovery document says what a host offers; presence is the claim. | [`capabilities.md`](./spec/v2/core/capabilities.md) |

OpenWOP does not standardize the model call, the orchestration topology inside a node graph, the tool-exposure protocol (that is MCP) or cross-process agent messaging (that is A2A).

## Security and conformance

> **SECURITY surface:** 224 invariants in [`SECURITY/invariants.yaml`](./SECURITY/invariants.yaml) — 187 protocol-tier (verified at the spec gate; every one has at least one public test in [`conformance/src/scenarios/`](./conformance/src/scenarios/)), 35 reference-impl-tier (verified by reference impls' CI), 2 advisory.

The [conformance suite](./conformance/) decides compliance mechanically and signs a certification bundle per host. Each host's measured results are in [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md). To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

## Document index

The v2 core corpus. Each document is the normative home of the capability families it names; [`spec/v2/README.md`](./spec/v2/README.md) explains the layout.

| Document | Covers |
| --- | --- |
| [`overview.md`](./spec/v2/core/overview.md) | Axioms, reading order, retiring a surface, v1 end of support |
| [`versioning.md`](./spec/v2/core/versioning.md) | Major negotiation, `OpenWOP-Version`, release identity |
| [`capabilities.md`](./spec/v2/core/capabilities.md) | The discovery document and the capability record |
| [`identity.md`](./spec/v2/core/identity.md) | Subjects, auth lanes, id grammars, resume tokens |
| [`runs.md`](./spec/v2/core/runs.md) | Create, read, list, cancel and fork runs; run limits and residency |
| [`events.md`](./spec/v2/core/events.md) | The event envelope, SSE, poll, envelopes, host events |
| [`errors.md`](./spec/v2/core/errors.md) | The error envelope and code registry |
| [`headers.md`](./spec/v2/core/headers.md) | `OpenWOP-*` headers |
| [`interrupt.md`](./spec/v2/core/interrupt.md) | Interrupt kinds, resume values, re-entry |
| [`idempotency.md`](./spec/v2/core/idempotency.md) | Request idempotency and effect identity |
| [`replay.md`](./spec/v2/core/replay.md) | Replay and fork, side-effect suppression, declared nondeterminism |
| [`persistence.md`](./spec/v2/core/persistence.md) | The event log, eras and the v1 reader rule |
| [`conversation.md`](./spec/v2/core/conversation.md) | Multi-party conversation, channel presence |
| [`execution.md`](./spec/v2/core/execution.md) | Multi-agent execution, sub-workflows, self-hosted runners |
| [`security-defaults.md`](./spec/v2/core/security-defaults.md) | Sandbox, compensation, purpose labels, audit-log integrity |
| [`webhooks.md`](./spec/v2/core/webhooks.md) | Subscriptions, signed delivery, durability, triggers |
| [`interop.md`](./spec/v2/core/interop.md) | A2A and MCP |
| [`host-services.md`](./spec/v2/core/host-services.md) | AI providers, prompts, MCP client, workspace and other host services |
| [`storage.md`](./spec/v2/core/storage.md) | Storage families: files, key-value, tables, SQL, vectors, search, blobs, cache |
| [`oauth.md`](./spec/v2/core/oauth.md) | OAuth connector flows and credentials |
| [`tool-catalog.md`](./spec/v2/core/tool-catalog.md) | The tool catalog |
| [`i18n.md`](./spec/v2/core/i18n.md) | Locale negotiation and localized content |
| [`portability.md`](./spec/v2/core/portability.md) | Export and import of a host's estate |
| [`packs.md`](./spec/v2/core/packs.md) | Pack identity, signing, engines, UI plugins |
| [`node-pack-runtimes.md`](./spec/v2/core/node-pack-runtimes.md) | WASM and remote node-pack runtimes |
| [`connection-packs.md`](./spec/v2/core/connection-packs.md) | Connection packs |
| [`form-content-packs.md`](./spec/v2/core/form-content-packs.md) | Form content packs |
| [`workflow-chain-packs.md`](./spec/v2/core/workflow-chain-packs.md) | Workflow chain packs |
| [`artifact-type-packs.md`](./spec/v2/core/artifact-type-packs.md) | Artifact-type packs |
| [`conformance.md`](./spec/v2/core/conformance.md) | Requirement ids, witness classes, certification bundles, the seams profile |

**Total**: 30 docs.

Machine-readable artifacts: [`schemas/v2/`](./schemas/v2/), [`api/v2/openapi.yaml`](./api/v2/openapi.yaml), [`api/v2/asyncapi.yaml`](./api/v2/asyncapi.yaml) and [`api/seams-v2.yaml`](./api/seams-v2.yaml).

## Quickstart

- **[`QUICKSTART-10MIN.md`](./QUICKSTART-10MIN.md):** boot the v2 reference host and run a workflow over curl, an SDK and SSE.
- **[`QUICKSTART.md`](./QUICKSTART.md):** the full v2 walkthrough against any host: discovery, auth, runs, streaming, webhooks, fork and replay, packs, conformance.
- **Guides:** [`docs/IMPLEMENTER-PATH.md`](./docs/IMPLEMENTER-PATH.md) (from zero to a published certification), [`docs/PRODUCTION-RUNBOOK.md`](./docs/PRODUCTION-RUNBOOK.md), [`docs/SECURITY-OPERATOR-GUIDE.md`](./docs/SECURITY-OPERATOR-GUIDE.md), [`docs/PACK-AUTHOR-QUICKSTART.md`](./docs/PACK-AUTHOR-QUICKSTART.md).

## Repositories

This repository holds the protocol contract: the spec, schemas, OpenAPI and AsyncAPI documents, RFCs, SECURITY invariants and the conformance suite. Everything built on it lives in sibling repositories:

- [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks): the TypeScript, Python and Go client SDKs.
- [`openwop/openwop-examples`](https://github.com/openwop/openwop-examples): reference hosts (including the v2 reference host) and runnable samples.
- [`openwop/openwop-app`](https://github.com/openwop/openwop-app): the reference workflow-engine app behind app.openwop.dev.
- [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry): the pack catalog served at [packs.openwop.dev](https://packs.openwop.dev).
- [`openwop/openwop-cli`](https://github.com/openwop/openwop-cli): the `@openwop/cli` command line.
- [`openwop/openwop-site`](https://github.com/openwop/openwop-site): [openwop.dev](https://openwop.dev).

## Contributing and governance

- **Changes to the protocol** go through an RFC: [`RFCS/README.md`](./RFCS/README.md).
- **How to contribute** (DCO sign-off, the `npm run openwop:check` gate): [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- **Compatibility rules** (additive, safety fix, breaking): [`COMPATIBILITY.md`](./COMPATIBILITY.md).
- **Governance and maintainers:** [`GOVERNANCE.md`](./GOVERNANCE.md), [`MAINTAINERS.md`](./MAINTAINERS.md).
- **Releases:** [`CHANGELOG.md`](./CHANGELOG.md), [`PUBLISHING.md`](./PUBLISHING.md).
- **Roadmap:** [`ROADMAP.md`](./ROADMAP.md).

Report a spec problem as a GitHub issue labelled `openwop-spec`, naming the document, the section and the requirement.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
