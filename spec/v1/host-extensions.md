# openwop Spec v1 — Host Extensions

> **Status: Stable · v1.1 (2026-05-05).** Distinguishes the protocol's normative core from host-specific extensions. This document is the canonical reference cited from any spec doc that mentions a vendor-prefixed namespace (e.g., `openwop.*`). Graduated DRAFT → FINAL via RFC 0006. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## Why this exists

A host implementing openwop often needs to expose product-specific concepts that aren't part of the protocol — workspaces, projects, canvases, custom node types, vendor analytics. The spec mentions some of these in passing (e.g., `openwop.canvasTypeId` in the `metadata` field of `POST /v1/runs`).

External implementers reading the spec need to know **which fields are normative** (every conforming host MUST honor them) **vs which are host-specific** (a host MAY add them; clients MUST tolerate their absence).

This document is the answer.

---

## The rule

Any field, event type, span name, or capability that doesn't match one of the canonical prefixes below is a **host extension**. Hosts MAY add them. Clients MUST tolerate them being missing or unrecognized.

> The formal namespace-reservation, trust-tier, and name-reservation policy these prefixes draw from is **[RFC 0043 — Registry and extension-policy](../../RFCS/0043-registry-and-extension-policy.md)** (§A namespaces, §C name reservation); this section is the wire-level summary. See [`docs/governance/registry-policy.md`](../../docs/governance/registry-policy.md) for the one-stop index.

### Canonical prefixes (protocol-owned)

| Prefix | Owner | Examples |
|---|---|---|
| `openwop.*` | Protocol | `openwop.run_id`, `openwop.node.<typeId>`, `openwop.event.append` |
| `core.*` | Protocol | `core.noop`, `core.delay`, `core.ai.callPrompt` (in node-pack scope) |
| `community.*` | Public registry | `community.john.image-tools` (per `node-packs.md` §Naming) |
| `vendor.<org>.*` | Public registry, org-authorized | `vendor.acme.search-tools` |
| `private.<host>.*` | Host-internal pack registry | `private.openwop.canvas-tools` (per `openwop/openwop@0f2f7ff`) |
| `local.*` | In-repo / dev-time / unpublished packs | `local.dev-test` |

### Vendor-prefixed namespaces (host extensions)

A host MAY use any vendor-prefixed namespace for fields not covered above. Recommended convention: use the vendor's reverse-DNS or short identifier as the prefix.

| Prefix | Used by | Notes |
|---|---|---|
| `openwop.*` | The reference host shipped with this repo | Workspace, project, canvas, persona, brand, etc. — example of how a host carves out a vendor namespace. |
| `<your-vendor>.*` | Your host | Anything openwop doesn't define |

A client receiving an unknown vendor-prefixed field MUST treat it as opaque. Hosts MUST NOT depend on clients understanding their extension namespace.

---

## What stays in the protocol

openwop normatively owns:

| Concept | Spec doc |
|---|---|
| Workflow definitions | `rest-endpoints.md`, `schemas/workflow-definition.schema.json` |
| Run lifecycle (create / get / cancel / fork / interrupt) | `rest-endpoints.md` |
| Run events (closed event-name vocabulary) | `observability.md` §"Canonical run lifecycle event names" |
| Stream modes (SSE + polling) | `stream-modes.md` |
| Interrupts (HITL approval + clarification) | `interrupt.md` |
| Idempotency (Layer 1 + Layer 2) | `idempotency.md` |
| Version negotiation | `version-negotiation.md` |
| Capability discovery | `capabilities.md` |
| Node-pack manifest shape | `node-packs.md` |
| Compatibility profiles (derived from capabilities) | `profiles.md` |
| Scale profiles | `scale-profiles.md` |
| Conformance contracts | the `@openwop/openwop-conformance` suite |

Anything else is a host concern.

---

## What hosts own

A host owns:

- **Authentication.** openwop defines the bearer-token error envelope; how the token is provisioned, rotated, scoped, etc., is a host concern.
- **Authorization.** openwop doesn't define RBAC. Hosts wire their own per-resource permissions.
- **Tenant / workspace / project scoping.** openwop receives `metadata` with whatever scoping fields the host needs; the protocol only requires that runs are isolated per the host's documented scoping rules.
- **Storage adapters.** The host's choice of database, key-value store, blob storage, vector index. openwop defines the `RunEventLogIO` and `SuspendIO` interfaces (see `storage-adapters.md`); how a host implements them is local.
- **Secret resolution.** Hosts that advertise `capabilities.secrets.supported: true` MUST follow the credential-reference contract; how secrets are stored (KMS, Vault, env vars) is a host choice.
- **Billing / quotas.** openwop doesn't bill. Hosts apply their own billing per workspace/tenant.
- **Audit / observability sinks.** Hosts wire their own log shipping, metrics export, OTel collectors.
- **Product-specific UI.** openwop doesn't ship UI. Hosts build whatever UI fits their product.
- **Domain extensions.** Workspace, project, canvas, persona, brand, knowledge base, agent personas — these are vendor-specific domain concepts (the namespaces in the example tables above carry one such vocabulary). Other hosts may have entirely different domain models.
- **`exec`-class arbitrary command execution.** Running a caller- or model-supplied command/shell/script/binary is a host concern, never a protocol concern — it lives only in a named host-extension scope per §"`exec`-class tools" below, with host-owned sandboxing, allowlisting, approval-gating, and audit.

A host's domain extensions live in that host's own repo, not in this spec corpus.

---

## How extensions appear on the wire

### Run metadata

`POST /v1/runs` accepts a `metadata` object. openwop doesn't constrain its shape beyond "MUST be a JSON object." Hosts use it for vendor-prefixed fields:

```json
{
  "workflowId": "conformance-noop",
  "metadata": {
    "openwop.canvasTypeId": "campaign-studio",
    "openwop.canvasId": "doc_abc123",
    "openwop.projectId": "proj_xyz"
  }
}
```

An OpenWOP-conforming host MUST NOT reject the request because it doesn't recognize the `openwop.*` fields. A host MAY ignore them entirely. The host that owns the namespace honors the fields it understands; other hosts pass them through opaquely.

### Discovery payload extensions

`/.well-known/openwop` returns an object. Hosts MAY add vendor-prefixed top-level fields:

```json
{
  "protocolVersion": "1.0",
  "supportedEnvelopes": [...],
  "openwop": {
    "workspaceId": "ws_default",
    "billingTier": "production"
  }
}
```

Per `capabilities.schema.json`, `additionalProperties: true` makes this additive. Clients MUST ignore unrecognized top-level fields.

### Run snapshot extensions

`GET /v1/runs/{runId}` returns a `RunSnapshot`. The schema's `additionalProperties: true` allows host fields. Conventional pattern:

```json
{
  "runId": "run-...",
  "workflowId": "...",
  "status": "completed",
  "openwop": {
    "workspaceRole": "editor",
    "auditUrl": "..."
  }
}
```

### Event payloads

Run events have a `data` field that's free-form. Hosts MAY include vendor-prefixed sub-fields. Clients MUST ignore unrecognized event types entirely (per `observability.md` §"Forward-compat").

### Span attributes

Span attributes outside the `openwop.*` namespace are host extensions. The OTel allowlist enforced by the host's redaction harness covers `openwop.*` plus any vendor-prefixed attributes the host has explicitly allowlisted.

---

## What hosts MUST NOT do

- **MUST NOT redefine `openwop.*` semantics.** A host that emits `openwop.run.completed` with a non-canonical payload shape is non-conformant. Hosts wanting different semantics use a vendor-prefixed event type.
- **MUST NOT add fields under `core.*` or other registry-reserved scopes.** These are protocol-managed namespaces.
- **MUST NOT make the protocol's normative requirements optional via extension.** A host that advertises `openwop-secrets` but doesn't honor `credentialRef` redaction is non-conformant regardless of any extension fields.
- **MUST NOT depend on clients honoring host-extension fields.** Host extensions are opaque to clients by default.

---

## `exec`-class tools (arbitrary command execution) — RFC 0069 (`Draft`)

An **`exec`-class tool** is any capability that runs a caller- or model-supplied command, shell string, script, or binary on the host or in an environment the host controls (e.g., a "run this shell command", "execute this Python", or "spawn this process" tool).

**`exec`-class execution MUST NOT be a protocol-tier capability.** Specifically, a conforming host MUST NOT:

- define an `exec`-class tool under a protocol-owned namespace (`core.*` or `openwop.*`) — neither as a node typeId, an envelope type, nor a built-in tool;
- advertise an `exec`-class capability under a protocol-owned `capabilities.*` flag;
- redefine an existing protocol-tier capability (`host.fs`, `host.mcp`, a node pack, a connector) to perform arbitrary command execution.

A host that needs `exec`-class execution MUST expose it **only** under a named host-extension scope using the canonical vendor prefix (`x-host-<vendor>-exec`, or a `vendor.<org>.*` / `private.<host>.*` node-pack namespace per §"Canonical prefixes"). The host owns the safety controls end-to-end and SHOULD document, at minimum:

- **Sandboxing** — exec MUST run isolated from the host process and other tenants ([`RFCS/0035`](../../RFCS/0035-sandbox-execution-contract.md) §A sandbox invariants are the recommended baseline; `node-pack-sandbox-no-process` already forbids protocol-tier sandboxed code from spawning processes, so any exec surface is by definition outside that sandbox and needs its own isolation).
- **Command allowlisting / no shell interpolation** — the command set MUST be constrained; untrusted (LLM- or input-derived) content MUST NOT be interpolated into a shell string (the `prompt-injection-input-marker` / `node-pack-output-untrusted` discipline applied to the exec boundary).
- **Human approval gating** — destructive or unbounded exec SHOULD require an [RFC 0051](../../RFCS/0051-approval-deployment-gate-primitive.md) `approval` interrupt before execution.
- **Audit** — every exec invocation SHOULD emit a host-internal audit record; the protocol does not normate its shape.

Clients MUST treat any `x-host-<vendor>-exec` surface as opaque (per §"How extensions appear on the wire") and MUST NOT assume an exec extension is portable across hosts. A host MUST NOT depend on a client understanding its exec namespace.

**Rationale.** `exec` is the highest-severity surface in a workflow runtime: a single prompt-injection or input-validation lapse becomes remote code execution, and a shared exec surface is a cross-tenant blast radius. The protocol stays exec-free so that no conforming host inherits that surface by default; hosts that accept the risk own it explicitly, in their own namespace, with their own controls. See [`SECURITY/threat-model-prompt-injection.md`](../../SECURITY/threat-model-prompt-injection.md) §"`exec` tools" and the `exec-must-not-be-protocol-tier` invariant in [`SECURITY/invariants.yaml`](../../SECURITY/invariants.yaml).

---

## Extension lifecycle

A host extension MAY be:

1. **Promoted to the protocol** via an RFC per `RFCS/0001-rfc-process.md`, if multiple hosts converge on the same extension shape and an external implementer would benefit from a normative definition.
2. **Deprecated** in favor of a different extension or a protocol field. Hosts SHOULD document deprecation per `COMPATIBILITY.md` §7.
3. **Replaced** by a different vendor-prefixed namespace. The host updates its docs; clients pin to the new prefix.

Extension promotion is rare. Most host extensions stay host-specific forever; that's fine.

---

## `host.*` capability surfaces

The `host.*` namespace is reserved for **capability surfaces** that node packs consume via their manifest's `peerDependencies` (per `node-packs.md` §"Manifest format"). The per-surface normative contracts live in:

- **`spec/v1/host-capabilities.md`** — canonical reference for every `host.<name>` capability: methods, signatures, required vs optional, failure modes.

A host advertising `host.<name>: supported` in `/.well-known/openwop` MUST honor that contract. A pack declaring `peerDependencies: { "host.<name>": "supported" }` consumes it. The pack registry validates the relationship at workflow-register time.

The 14 surfaces specified in v1: `host.aiEnvelope`, `host.promptLibrary`, `host.canvas`, `host.chat`, `host.brand`, `host.kanban`, `host.webResearch`, `host.agentRuntime`, `host.coordination`, `host.dataIntegration`, `host.launchStudio`, `host.entities`, `host.messaging`, `host.mcp`.

---

## See also

- `spec/v1/host-capabilities.md` — per-surface contracts for `host.*` capabilities
- `spec/v1/capabilities.md` §"Network-handshake shape" — required and optional v1 fields are protocol-managed; fields outside that table are host extensions.
- `spec/v1/positioning.md` — what's in the protocol vs what's in adjacent ecosystems.
- `spec/v1/node-packs.md` §"Naming" — pack-name scope conventions.
- `RFCS/0001-rfc-process.md` — RFC mechanism for promoting an extension to the protocol.
- `COMPATIBILITY.md` — additive-change discipline that gates extension stability.
