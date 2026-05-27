# RFC 0072: Agent Inventory + Dispatch Normative Surface (amends RFC 0070)

| Field | Value |
|---|---|
| **RFC** | 0072 |
| **Title** | Agent Inventory + Dispatch Normative Surface |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-26 |
| **Updated** | 2026-05-26 |
| **Affects** | `schemas/agent-inventory-response.schema.json` (new), `schemas/node-pack-manifest.schema.json`, `api/openapi.yaml`, `spec/v1/node-packs.md`, `spec/v1/host-capabilities.md`, `conformance/src/scenarios/agent-manifest-runtime.test.ts`, `CHANGELOG.md`, `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0070 made pack-declared manifest agents runnable behind `capabilities.agents.manifestRuntime`, but their **inventory and dispatch were sample-extension only** (`/v1/host/sample/agents`), so a non-steward host could not be exercised black-box and "portable agent" silently degraded to "portable manifest, host-specific runtime." This RFC resolves RFC 0070's three Unresolved questions: (§A) it promotes a **read-only agent inventory** (`GET /v1/agents`, `GET /v1/agents/{agentId}`) to a **normative, capability-gated** surface; (§B) it pins the **normative dispatch path to the existing run surface** (`WorkflowNode.agent` + `POST /v1/runs`) rather than a bespoke endpoint, so dispatch inherits replay/fork/observability; (§C) it replaces RFC 0070 §D's host-global degrade-vs-refuse choice with a **pack-author-declared, per-dependency** marker (`peerDependenciesMeta.optional`); and (§D) it records that the floor's **safety guarantees stay mandatory** (not sub-flags).

## Motivation

"The portable agent protocol for any app" is only credible if **any client can point at any conformant host and enumerate the agents it can run** — and if that surface is the same everywhere, conformance can *prove* it. RFC 0070 left that surface in the sample-extension namespace, which (1) no non-steward host exposes, so the conformance scenario soft-skips against them, and (2) means each host surfaces agents differently. That undercuts both universality and the `Active → Accepted` path (which needs a non-steward host exercised black-box). RFC 0070 also deferred two design calls — the degradation default and flag granularity — that this RFC settles on the universal-adoptability criterion (see `docs/OPENWOP-AGENT-RUNTIME-ANALYSIS.md` §F and the architect review).

## Proposal

### §A Normative agent inventory (resolves RFC 0070 §Unresolved #3)

A host that advertises `capabilities.agents.manifestRuntime.supported: true` **MUST** serve:

- `GET /v1/agents` → `{ "agents": AgentInventoryEntry[], "total": integer }`
- `GET /v1/agents/{agentId}` → an `AgentInventoryEntry`, or `404` with the canonical error envelope when no such agent is installed.

A host that does **not** advertise `agents.manifestRuntime` **MUST NOT** be required to serve these (they `404`/`501` and conformance soft-skips). `AgentInventoryEntry` (new `agent-inventory-response.schema.json`) is a read projection of the installed `AgentManifest` — it carries `agentId`, `persona`, `label`, `modelClass`, `packName`, `packVersion`, `toolAllowlist`, `hasHandoffSchemas`, and optional `memoryShape` / `confidenceThreshold` / `degraded[]` (the tiers inert on this host per §C). It MUST NOT carry the system-prompt body, resolved handoff schemas, or any credential material (SR-1).

This is the portable discovery surface; the sample-extension `/v1/host/sample/agents` remains a non-normative convenience alias.

### §B Dispatch is a run (resolves RFC 0070 §Unresolved #3, dispatch half)

A manifest agent is **dispatched as a run**: a workflow node pins the agent via `WorkflowNode.agent` (the `AgentRef` from RFC 0002), and the run is created with `POST /v1/runs`. There is deliberately **no bespoke `:dispatch` endpoint** — reusing the run surface means agent dispatch inherits replay (`replay.md`), `POST /v1/runs/{runId}:fork`, idempotency (`idempotency.md`), cancellation, and `openwop.*` observability for free; a side-channel execution endpoint would need its own determinism story. Hosts **MAY** accept an optional `agentId` on the `POST /v1/runs` body as a convenience that the host expands into a single-agent run; this is an ergonomic shortcut, **not** a required surface, and MUST behave identically to the equivalent `WorkflowNode.agent` run.

Full black-box *dispatch* conformance — driving `POST /v1/runs` against a pinned manifest agent and asserting the attributed `agent.*` events — requires the host's executor to run a manifest agent as a workflow node. That executor integration is the sequenced tier from RFC 0070 (crews/orchestrator); this RFC makes the **inventory** black-box-provable now and states the dispatch contract normatively.

### §C Per-dependency graceful degradation (resolves RFC 0070 §Unresolved #1)

RFC 0070 §D posed a host-global default (degrade vs refuse). That is the wrong grain — only the **pack author** knows whether an agent is correct when a tier is unmet. This RFC moves the decision into the manifest, reusing the npm idiom `node-packs.md` already anticipates (§"Forward-compat note"):

```diff
   "peerDependencies": { "type": "object", "additionalProperties": { "type": "string" } },
+  "peerDependenciesMeta": {
+    "type": "object",
+    "description": "Per-peer-dependency metadata. Keys mirror peerDependencies keys.",
+    "additionalProperties": {
+      "type": "object", "additionalProperties": false,
+      "properties": { "optional": { "type": "boolean", "default": false } }
+    }
+  }
```

- A bare `peerDependencies` entry is **required**: unmet ⇒ the host **MUST** refuse install with `pack_peer_dependency_missing` (today's semantics — least surprise, safe default).
- An entry marked `peerDependenciesMeta[cap].optional: true` is **degrade-if-unmet**: the host **MUST** install the agent with that tier inert **and MUST surface the degraded set** (the inventory entry's `degraded[]` per §A, listing the unmet capability keys). It **MUST NOT** silently accept the manifest and never honor the tier (the RFC 0070 §D MUST-NOT carries forward).
- Default (no `peerDependenciesMeta` entry) is **required** — backward-compatible with every pack published before this RFC.

### §D Floor safety guarantees are mandatory, not sub-flags (resolves RFC 0070 §Unresolved #2)

`toolAllowlist` enforcement (RFC 0002 §A14), `systemPromptRef` resolution (RFC 0003 §C), and BYOK/SR-1 redaction **MUST** be honored whenever a host advertises `agents.manifestRuntime.supported: true` — they define what the floor *means* and are **not** independently advertised sub-flags. Sub-flagging a safety guarantee would let a host claim the floor while running a signed agent with an unbounded tool surface, fragmenting the floor's uniform meaning across hosts. Only genuine *behavioral variations* are sub-flags; `handoffValidation` (RFC 0070 §A) is the canonical example (a host without a JSON-Schema validator can still serve the floor with opaque payloads). No schema change — this is a normative clarification.

### §E Positive / negative examples

Positive — a host advertising the floor serves the inventory:

```jsonc
GET /v1/agents → { "agents": [ { "agentId": "core.openwop.agents.code-reviewer.default",
  "persona": "Code Reviewer", "modelClass": "coding", "packName": "core.openwop.agents.code-reviewer",
  "packVersion": "1.0.0", "toolAllowlist": ["openwop:fs.read"], "hasHandoffSchemas": true } ], "total": 1 }
```

Negative — an optional unmet tier with no surfaced degradation (violates §C):

```jsonc
// pack: peerDependencies { "agents.memoryBackends": "supported" }, peerDependenciesMeta { "agents.memoryBackends": { "optional": true } }
// host lacks long-term memory; installs the agent but the inventory entry omits `degraded` → NON-CONFORMANT
```

## Compatibility

**Additive.**

- `agent-inventory-response.schema.json` is new; `peerDependenciesMeta` and `degraded[]` are new optional fields; the `GET /v1/agents` endpoints are new and gated on the existing `agents.manifestRuntime` flag; the optional `agentId` on `POST /v1/runs` is a new optional request field.
- No existing required field, optional-field type, event shape, endpoint contract, `MUST`, or error code changes. Hosts that don't advertise `agents.manifestRuntime` are unaffected; packs published before this RFC validate unchanged (default `required` matches prior semantics).
- Replay/fork safety holds **by construction**: dispatch reuses the run surface (§B), introducing no new event-log shape.

## Conformance

- **Retargeted:** the inventory leg of `agent-manifest-runtime.test.ts` drives the normative `GET /v1/agents` (+ `/{agentId}`), gated on `agents.manifestRuntime.supported`; soft-skips when unadvertised. Suite `@openwop/openwop-conformance` 1.9.0 → 1.10.0.
- **`peerDependenciesMeta`:** a loader/host scenario asserts required-unmet ⇒ refuse and optional-unmet ⇒ install-degraded-with-`degraded[]`.
- **Dispatch black-box** stays deferred to the executor-integration tier (RFC 0070 crews/orchestrator); the sample-seam dispatch assertion continues to cover the reference host meanwhile.

## Alternatives considered

1. **A bespoke `POST /v1/agents/{id}:dispatch` endpoint.** Rejected: it fragments the "everything is a run" model and would need its own replay/fork/idempotency story; `WorkflowNode.agent` + `POST /v1/runs` already dispatch agents normatively.
2. **A host-global degrade-vs-refuse default.** Rejected: wrong grain — global degrade risks silent incorrectness, global refuse kills reach; only the pack author knows. §C moves it per-dependency.
3. **Sub-flagging `toolAllowlist`/`systemPromptRef`/SR-1.** Rejected: they're safety invariants, not features; advertising them optional fragments the floor's meaning (§D).
4. **Do nothing (keep sample-extension only).** Rejected: leaves the inventory unportable + the `Active → Accepted` path unprovable black-box.

## Unresolved questions

1. Should the optional `agentId` on `POST /v1/runs` be promoted MAY → SHOULD once a second host implements the single-agent expansion?
2. `degraded[]` surfacing: on the per-install response, the inventory entry, or both? (This RFC puts it on the inventory entry.)

## Implementation notes (non-normative)

- The reference `workflow-engine` host serves `GET /v1/agents{,/{agentId}}` from the AgentRegistry built in RFC 0070 (`routes/agents.ts`); the loader (`agentLoader.ts`) reads `peerDependenciesMeta` and sets the entry's `degraded[]`. The `examples/hosts/in-memory` reference host gaining the same surface (+ the executor dispatch integration for full black-box dispatch conformance) is the sequenced follow-on.
- CC: SDKs gain `agents.list` / `agents.get` — note in the impl plan.

## Acceptance criteria

- [ ] Spec text merged (this file + §C in `node-packs.md` + §A normative-inventory note in `host-capabilities.md`/`capabilities.md`).
- [ ] `agent-inventory-response.schema.json` + `peerDependenciesMeta` in `node-pack-manifest.schema.json`.
- [ ] `GET /v1/agents{,/{agentId}}` in `api/openapi.yaml` (gated) + `OpenwopClient.agents.{list,get}`.
- [ ] ≥1 capability-gated conformance scenario over the normative inventory.
- [ ] CHANGELOG entry; reference host serves the inventory.

## References

- RFC 0070 (agent-manifest runtime — `Active`), RFC 0002 (`AgentRef` / `WorkflowNode.agent`), RFC 0003 (agent packs / `peerDependencies`).
- `docs/OPENWOP-AGENT-RUNTIME-ANALYSIS.md`, `spec/v1/node-packs.md`, `spec/v1/replay.md`, `spec/v1/idempotency.md`.
