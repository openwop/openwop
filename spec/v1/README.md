# OpenWOP v1 specification

> **Status: Stable · maintained compatibility major.** New implementations
> should target v2; this tree remains normative for v1 clients and dual-stack
> hosts during the migration window.

OpenWOP v1 is the maintained compatibility major. Target
[v2](../v2/README.md) for new work; implement v1 when supporting an existing
v1 client or a dual-stack host during the migration window.

This directory contains explanatory and normative prose. When prose and a
machine-readable contract disagree, use the following precedence:

1. [`api/openapi.yaml`](../../api/openapi.yaml) and
   [`api/asyncapi.yaml`](../../api/asyncapi.yaml) for HTTP and event surfaces.
2. [`schemas/`](../../schemas/) for payload validation.
3. The normative requirements in these documents.
4. RFC history and examples, which provide rationale but do not override the
   published wire contract.

Normative keywords (`MUST`, `MUST NOT`, `SHOULD`, and `MAY`) follow RFC 2119.
Open issues are tracked centrally in [`gaps.json`](./gaps.json); migration and
removal status are tracked in [`migrations.json`](./migrations.json) and
[`deprecations.json`](./deprecations.json).

## Start here

| Goal | Read |
| --- | --- |
| Discover a host and negotiate compatibility | [`capabilities.md`](./capabilities.md), [`version-negotiation.md`](./version-negotiation.md), [`profiles.md`](./profiles.md) |
| Create and observe a run | [`rest-endpoints.md`](./rest-endpoints.md), [`run-options.md`](./run-options.md), [`stream-modes.md`](./stream-modes.md) |
| Suspend for human input | [`interrupt.md`](./interrupt.md), [`interrupt-profiles.md`](./interrupt-profiles.md) |
| Implement durable execution | [`storage-adapters.md`](./storage-adapters.md), [`idempotency.md`](./idempotency.md), [`replay.md`](./replay.md) |
| Implement agents | [`multi-agent-execution.md`](./multi-agent-execution.md), [`ai-envelope.md`](./ai-envelope.md), [`agent-memory.md`](./agent-memory.md) |
| Publish reusable components | [`node-packs.md`](./node-packs.md), [`workflow-chain-packs.md`](./workflow-chain-packs.md), [`registry-operations.md`](./registry-operations.md) |
| Secure a host | [`auth.md`](./auth.md), [`auth-profiles.md`](./auth-profiles.md), [`host-extensions.md`](./host-extensions.md) |

## Document map

### Wire and execution

- [`rest-endpoints.md`](./rest-endpoints.md) — REST operation catalog.
- [`capabilities.md`](./capabilities.md) and
  [`capabilities-change-detection.md`](./capabilities-change-detection.md) —
  discovery, feature advertisement, and cache validation.
- [`version-negotiation.md`](./version-negotiation.md) — protocol, engine, and
  event-schema versioning.
- [`channels-and-reducers.md`](./channels-and-reducers.md) — typed shared state.
- [`run-options.md`](./run-options.md) — per-run configuration overlay.
- [`stream-modes.md`](./stream-modes.md) — SSE projections and resumption.
- [`interrupt.md`](./interrupt.md) and
  [`interrupt-profiles.md`](./interrupt-profiles.md) — suspend/resume and
  approval profiles.
- [`idempotency.md`](./idempotency.md), [`replay.md`](./replay.md), and
  [`compensation.md`](./compensation.md) — retry safety, forks, and failure
  recovery.
- [`storage-adapters.md`](./storage-adapters.md) — event-log and suspension
  persistence contracts.

### Agents, prompts, and tools

- [`ai-envelope.md`](./ai-envelope.md) and
  [`structured-output-subset.md`](./structured-output-subset.md) — typed model
  output and the informative provider-compatibility subset.
- [`multi-agent-execution.md`](./multi-agent-execution.md) — execution and
  handoff model.
- [`agent-memory.md`](./agent-memory.md),
  [`agent-workspace.md`](./agent-workspace.md), and
  [`agent-runtime.md`](./agent-runtime.md) — memory, files, and standing goals.
- [`agent-deployment.md`](./agent-deployment.md),
  [`agent-evaluation.md`](./agent-evaluation.md),
  [`agent-roster.md`](./agent-roster.md), and
  [`agent-org-chart.md`](./agent-org-chart.md) — lifecycle and inventory.
- [`agent-ref-positioning.md`](./agent-ref-positioning.md) and
  [`agent-platform-profile.md`](./agent-platform-profile.md) — identity mapping
  and the aggregate platform profile.
- [`prompts.md`](./prompts.md) and [`tool-catalog.md`](./tool-catalog.md) — prompt
  distribution and portable tool discovery.

### Packs and registries

- [`node-packs.md`](./node-packs.md),
  [`workflow-chain-packs.md`](./workflow-chain-packs.md), and
  [`registry-operations.md`](./registry-operations.md) — executable packs,
  reusable workflow fragments, and registry lifecycle.
- [`connection-packs.md`](./connection-packs.md),
  [`artifact-type-packs.md`](./artifact-type-packs.md),
  [`chat-card-packs.md`](./chat-card-packs.md), and
  [`form-content-packs.md`](./form-content-packs.md) — specialized pack types.
- [`frontend-plugin-packs.md`](./frontend-plugin-packs.md) — sandboxed UI
  extensions.

### Host services and integrations

- [`host-capabilities.md`](./host-capabilities.md) and
  [`host-extensions.md`](./host-extensions.md) — pack-facing host services and
  extension namespaces.
- [`mcp-integration.md`](./mcp-integration.md) and
  [`a2a-integration.md`](./a2a-integration.md) — MCP and A2A composition.
- [`webhooks.md`](./webhooks.md), [`trigger-bridge.md`](./trigger-bridge.md),
  [`grpc-transport.md`](./grpc-transport.md), and
  [`cloudevents-mapping.md`](./cloudevents-mapping.md) — delivery and transport
  profiles.
- [`self-hosted-runner.md`](./self-hosted-runner.md) — outbound-connected local
  execution.

### Operations, security, and supporting profiles

- [`auth.md`](./auth.md), [`auth-profiles.md`](./auth-profiles.md), and
  [`compliance.md`](./compliance.md) — identity, authorization, and an
  informative compliance mapping.
- [`observability.md`](./observability.md) and
  [`debug-bundle.md`](./debug-bundle.md) — telemetry and diagnostics.
- [`production-profile.md`](./production-profile.md),
  [`scale-profiles.md`](./scale-profiles.md),
  [`core-standard-profile.md`](./core-standard-profile.md), and
  [`conformance-certification.md`](./conformance-certification.md) — operational
  and evidence profiles.
- [`budget-policy.md`](./budget-policy.md) — quota and cost controls.
- [`i18n.md`](./i18n.md) and
  [`localized-content.md`](./localized-content.md) — language negotiation and
  authored localized content.
- [`portability.md`](./portability.md) — export/import extension.
- [`host-sample-test-seams.md`](./host-sample-test-seams.md) — optional
  conformance observation seams; not application endpoints.
- [`positioning.md`](./positioning.md) — non-normative comparison with adjacent
  standards.
