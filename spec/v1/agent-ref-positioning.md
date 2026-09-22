# OpenWOP Spec v1 — `AgentRef` Positioning

> **Status: Stable · v1.1 · non-normative.** Compares the RFC 0002 `AgentRef` shape with three adjacent agent-identity ecosystems — W3C DIDs, A2A `AgentCard`, and AGNTCY agent identity — so composition choices are concrete. Positioning, not requirements.

---

## Why this exists

RFC 0002 introduces `AgentRef` as the wire shape for "which agent took which turn inside a run." Three external ecosystems also propose agent-identity shapes:

- **W3C Decentralized Identifiers (DIDs)** — a general identity primitive for any digital subject, including non-human actors.
- **A2A `AgentCard`** — Google-led inter-agent protocol's discovery + capability descriptor.
- **AGNTCY (Cisco Agent Gateway) agent identity** — emerging proposal for cross-organization agent routing.

Implementers asking "is `AgentRef` the same thing?" deserve a clear answer. The TL;DR: **`AgentRef` is the per-event provenance record inside a run; the others are discovery, capability, or transport-binding shapes that compose with it.** They don't compete; they don't substitute. This document explains where each shape applies and how they translate.

---

## Shape comparison at a glance

| Concern                    | `AgentRef` (openwop RFC 0002)                                            | W3C DID                                  | A2A `AgentCard`                                | AGNTCY agent identity                 |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| **Layer**                  | Per-event provenance inside a run                                        | General identifier for any subject       | Inter-agent discovery + capability descriptor  | Cross-org routing + auth              |
| **Scope**                  | Single openwop run                                                       | Cross-system, cross-domain               | Cross-organization (between A2A peers)         | Cross-organization (gateway-mediated) |
| **Canonical id field**     | `agentId` (opaque, host-resolvable)                                      | `id` (DID URI: `did:method:specific-id`) | `name`/`id` (per-peer convention)              | Gateway-issued identifier             |
| **Capability claims**      | Out of scope (host-side `agent-manifest.schema.json`)                    | Out of scope (DIDs are identifiers only) | `skills`, `inputModes`, `outputModes` baked in | Gateway-mediated                      |
| **Resolution**             | Host `AgentRegistry` lookup                                              | DID resolver (per method)                | HTTP GET of agent card URL                     | Gateway routing tables                |
| **Mutability**             | Stable per run (`runOrchestrator.agentId` is set-once per RFC 0006 CO-2) | Resolvable to mutable DID Document       | Card may evolve; consumers re-fetch            | Gateway-issued, lifecycle managed     |
| **Cryptographic identity** | None (host-side trust)                                                   | Verification methods + proofs            | Optional `securitySchemes`                     | Gateway-bound credentials             |
| **Wire footprint**         | 4 optional fields (~50–200 bytes)                                        | URI + DID Document (variable)            | JSON object (~1–10 KB)                         | Gateway-defined                       |

The shapes target genuinely different concerns. `AgentRef` is small and per-event for a reason: it appears thousands of times in a single run's event log.

---

## Composition rules

### `AgentRef` + W3C DID

When an `AgentRef` resolves to an agent whose canonical identity is a DID:

- The host's `AgentRegistry` MAY map `AgentRef.agentId` → DID (one-way; clients still see only the opaque `agentId`).
- The DID is the cross-system anchor; `AgentRef.agentId` is the per-host shortcut.
- For audit and inter-org provenance, hosts SHOULD record the DID alongside the run's event log (typically via `agent-manifest.schema.json` metadata fields under a vendor prefix, e.g., `vendor.openwop.did`).

**Why not put the DID directly on `AgentRef`?** Two reasons:

1. **Wire footprint.** DIDs are URIs with method-specific suffixes; embedding them on every event payload bloats the log without per-event value.
2. **Resolvability assumptions.** Many openwop deployments (single-org, single-host) have no DID resolver. Forcing DIDs into the protocol creates a hard dependency for everyone to pay for a few users' benefit.

### `AgentRef` + A2A `AgentCard`

When an OpenWOP host invokes a remote A2A peer:

- The remote peer is identified by its `AgentCard` (URL + capabilities).
- The local representation inside the run is an `AgentRef` with `agentId` like `host:a2a:<peerHostname>:<remoteAgentName>` (per RFC 0002 §A1's `host:` namespace).
- The A2A composition layer (per `a2a-integration.md`) records the source `AgentCard` URL in the run's metadata.

**Direction of mapping:** `AgentCard` is the discovery shape; `AgentRef` is the in-run reference. One A2A `AgentCard` may surface as multiple `AgentRef`s across different runs.

**State projection:** A2A `Task.status` projects to openwop's run state per the `a2a-integration.md` table. Agents on both sides are referenced by the local shape (`AgentRef` in openwop's event log; `AgentCard` URL in A2A's task envelope).

### `AgentRef` + AGNTCY

AGNTCY's agent-identity proposals (as of 2026-05) center on gateway-mediated routing: agents register with a gateway, receive a gateway-issued identifier, and route inter-org traffic through the gateway's policy layer.

The composition picture mirrors A2A:

- The gateway-issued identifier is the cross-org anchor.
- The OpenWOP host maps each remote agent to an `AgentRef` with `agentId` like `host:agntcy:<gatewayId>:<remoteAgentId>`.
- Policy enforcement (rate limits, auth) is done at the gateway; openwop's tool-allowlist mechanism (`agent-manifest.schema.json` `toolAllowlist`) remains the in-run permission gate.

AGNTCY's spec is still evolving; OpenWOP hosts that integrate SHOULD treat the gateway-issued identifier as opaque and record it as metadata, not as the primary `agentId`.

---

## Why `AgentRef` is small

The four-field `AgentRef` (`agentId`, `agentSharing`, `memoryRef`, `modelClass`) is deliberately minimal. Three forces pushed toward this shape:

1. **Per-event footprint.** Every `agent.toolCalled` and `agent.toolReturned` carries an `AgentRef`. A single run with 50 reasoning steps emits 100+ agent events. Bytes compound.
2. **Replay determinism.** `AgentRef` must be reproducible at replay time from the cached event payload. Larger shapes (full capability listings, certificate chains) drift across replays.
3. **No coupling to identity ceremony.** Hosts that don't care about DIDs, A2A, or AGNTCY can populate `AgentRef` with simple opaque IDs and not pay for ecosystems they don't use.

When richer identity is needed, the _adjacent_ shape (DID Document, `AgentCard`, gateway record) carries it. `AgentRef` points at one of those when present; it doesn't try to be one.

---

## Translation table

For implementers building bridges:

| Source                    | `AgentRef.agentId` recipe                        | Where the source lives in metadata              |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| Manifest agent (RFC 0003) | `<tier>.<org>.<pack>.<agent>` directly           | Pack manifest; no extra metadata needed         |
| Host-local agent          | `host:<id>` per RFC 0002 §A1                     | Host's `AgentRegistry`                          |
| W3C DID                   | Stable hash of DID (e.g., `host:did:<did-hash>`) | Run metadata under `vendor.openwop.did`         |
| A2A peer                  | `host:a2a:<peerHostname>:<remoteAgentName>`      | Run metadata: `vendor.openwop.a2a.agentCardUrl` |
| AGNTCY gateway-routed     | `host:agntcy:<gatewayId>:<remoteAgentId>`        | Run metadata: `vendor.openwop.agntcy.gatewayId` |

The `host:` namespace from RFC 0002 §A1 is the catch-all for non-manifest agents. The `agentId` stays opaque; resolution detail lives in metadata.

---

## "Skill" means three different things

> **Informative.** This section adds no requirement. It separates three uses of the word "skill" that meet at OpenWOP's A2A and MCP edges.

| Term | Where it comes from | What it is | OpenWOP counterpart |
| --- | --- | --- | --- |
| **A2A `AgentSkill`** | An entry in an A2A `AgentCard`'s `skills[]` | A capability the agent offers to A2A callers: `id`, `name`, `description`, `tags`, plus optional examples, input/output modes and security requirements | An OpenWOP **Workflow**. When a host exposes itself as an A2A agent, `AgentSkill.id` maps to `Workflow.id` and invoking the skill starts a run ([`a2a-integration.md`](./a2a-integration.md) §1–§2). |
| **Agent Skills / `SKILL.md`** | The Agent Skills packaging format, also surfaced through MCP's skills extension | An instruction bundle: a directory holding a `SKILL.md` file (instructions plus metadata) and supporting files, loaded into a model's context on demand | None defined by the protocol. A host can choose to package such a bundle as an agent manifest, but no conversion is specified, and none is required for conformance. |
| **`role: "skill"` agent manifest** | RFC 0131 (`agent-manifest.schema.json`) | A composable, task-scoped sub-agent that an assistant or roster agent calls through `handoff`. The Skill profile requires `handoff` and restricts `memoryShape` to scratchpad-only, which keeps dispatch stateless and replay-clean | Itself. See [`node-packs.md`](./node-packs.md) §"Agent-manifest `role` + the Skill profile (RFC 0131)". |

The three are not interchangeable. An A2A `AgentSkill` that a host advertises is backed by a Workflow, not by a `role: "skill"` manifest, though a Workflow can itself dispatch one. A `SKILL.md` bundle is prompt material, not a wire shape OpenWOP validates. Read an unqualified "skill" in OpenWOP prose as the RFC 0131 manifest role unless the text names A2A or Agent Skills.

---

## What's out of scope

This addendum does NOT:

- Define a normative DID method for openwop. Hosts that use DIDs SHOULD use existing standardized methods (`did:web`, `did:key`, etc.).
- Define cross-org auth handshakes. Those are A2A's, AGNTCY's, or the host's responsibility.
- Mandate any one shape. Hosts MAY ignore DIDs, A2A, and AGNTCY entirely and remain v1-conformant.

---

## References

- [RFC 0002 — Agent Identity and Reasoning Events](../../RFCS/0002-agent-identity-and-reasoning-events.md)
- [RFC 0003 — Agent Packs](../../RFCS/0003-agent-packs.md) (manifest namespace)
- [W3C Decentralized Identifiers (DIDs) v1.0](https://www.w3.org/TR/did-core/) — informative
- A2A `AgentCard` (see `a2a-integration.md`)
- AGNTCY working notes (informative, evolving)
- `spec/v1/a2a-integration.md` — full A2A composition spec
- `spec/v1/host-extensions.md` — `vendor.*` namespace conventions
