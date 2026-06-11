# RFC 0070: Agent Manifest Runtime Capability (`agents.manifestRuntime`)

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**           | 0070                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Title**         | Agent Manifest Runtime Capability (`agents.manifestRuntime`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Created**       | 2026-05-26                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Updated**       | 2026-05-27 (**Active → Accepted**: the non-steward **MyndHyve workflow-runtime** serves `agents.manifestRuntime: { supported: true, handoffValidation: true }` end-to-end in production — Cloud Run revision `workflow-runtime-00394-jun` at 100% traffic — with the inventory seam returning the installed agent and the dispatch seam completing with `toolSurface` filtered to the allowlist (`['read_file']`, §A14) and emitting attributed `agent.reasoned` + `agent.decided`; existing `dispatch`/`orchestrator` flags + the parallel RFC 0071 `host.artifactTypes` carried forward (no rollback). **Caveat:** the published conformance scenario soft-skips against MyndHyve due to a pre-existing discovery-layout divergence (the suite + reference host read `discoveryDoc.capabilities.agents.*`; MyndHyve serves `agents` at the document root per `capabilities.schema.json`'s root placement) — a maintainer-level reconciliation tracked separately, not specific to RFC 0070. Earlier 2026-05-26: Draft → Active when the wire surface landed (#268) + steward comment-window waiver.) |
| **Affects**       | `schemas/capabilities.schema.json`, `spec/v1/host-capabilities.md`, `spec/v1/node-packs.md`, `conformance/src/scenarios/agent-manifest-runtime.test.ts`, `CHANGELOG.md`, `INTEROP-MATRIX.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Summary

RFC 0003 already specifies how an agent is packaged (`agents[]` in `pack.json`), installed (`installNodes → installAgents` append-only on an `AgentRegistry`, §ImplNotes), and resolved (`systemPromptRef`/`handoff.*SchemaRef` at install, §C/§D) — but there is **no capability flag** by which a host advertises that it actually implements that runtime, and **no light dependency** a pack can declare against it. The only existing flag is the heavyweight `host.agentRuntime` (six methods: spawn/delegate/consensus/messageSend/skillInvoke/swarmExecute), which 21 of 24 `core.openwop.agents.*` packs over-declare a peer-dependency on even though a single-agent code-reviewer needs none of `swarmExecute`/`consensus`. This RFC adds the minimal additive flag **`capabilities.agents.manifestRuntime`** — "this host loads pack `agents[]` into an `AgentRegistry` (RFC 0003) and dispatches them on the existing `core.dispatch` / orchestrator loop (RFC 0007/0037/0061)" — establishes `host.agentRuntime ⇒ manifestRuntime`, and specifies a graceful-degradation ladder so a manifest agent runs at the floor on any host that advertises the floor.

## Motivation

OpenWOP ships ~31 fully-populated, schema-valid agent manifests across ~24 `packs/core.openwop.agents.*` packs (RFC 0003 + `agent-manifest.schema.json`). They are signable, publishable, and listable — but **inert**: no capability advertises "I can instantiate a manifest agent," so a pack cannot express that dependency, conformance cannot gate on it, and a host operator cannot tell from `/.well-known/openwop` whether their host will run a given agent pack. The problem is concretely visible:

- **Over-broad coupling.** 21/24 core agent packs declare `peerDependencies: { "host.agentRuntime": "supported" }`. `host.agentRuntime` is the swarm/consensus superset attributed to vendor orchestration (`host-capabilities.md §host.agentRuntime`). A tool-using single agent or a small crew does not need swarm primitives, yet today it can only depend on the heavyweight surface — so a minimal host that _could_ run the agent cannot advertise eligibility for it.
- **"For any app" needs a low floor.** A CRM, an IDE, or a CI runner should be able to host agents by implementing a small, cheap tier — load a manifest, dispatch it on the existing loop, enforce `toolAllowlist` + BYOK, emit `agent.*` events — with memory / crews / cross-host / swarm as honest, optional tiers layered above. There is no flag for that floor today.
- **Cross-reference drift.** `host-capabilities.md §host.agentRuntime` cites "RFC 0008 AgentManifest"; RFC 0008 is the WASM ABI — `AgentManifest` is RFC 0003 and `AgentRef` is RFC 0002. The agent-runtime capability surface should name the right RFCs.

The spec is the right place to solve this because capability advertisement and `peerDependencies` resolution are wire contract (`capabilities.md`, `node-packs.md`); the loader/registry/dispatch wiring is implementation-only against the already-Accepted RFC 0003.

## Proposal

### §A New capability flag `capabilities.agents.manifestRuntime`

Add an optional object to the existing `agents` capability block (which is already `additionalProperties: true`):

```diff
       "dispatch": { "type": "boolean", "description": "Phase 6 ..." },
+      "manifestRuntime": {
+        "type": "object",
+        "description": "Agent-manifest runtime floor (RFC 0070). When `supported: true` the host implements RFC 0003 `installAgents` — it loads each installed pack's `agents[]` into an in-process AgentRegistry, resolves `systemPromptRef` + `handoff.*SchemaRef` from the tarball at install (RFC 0003 §C/§D), and can DISPATCH a manifest agent on the existing `core.dispatch`/orchestrator loop (RFC 0007/0037/0061). This is the minimal tier that makes a published agent pack runnable; it does NOT imply swarm/consensus (`host.agentRuntime`), long-term memory (`agents.memoryBackends`), or crews beyond what `agents.dispatch` advertises. Hosts that omit this block do not instantiate manifest agents (today's default).",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": {
+            "type": "boolean",
+            "description": "REQUIRED when the block is present. When `true`, the host loads + dispatches pack-declared manifest agents. A host advertising `supported: true` MUST enforce each dispatched agent's `toolAllowlist` (RFC 0002 §A14) and MUST NOT leak BYOK plaintext into `agent.*` events or handoff payloads (SR-1)."
+          },
+          "handoffValidation": {
+            "type": "boolean",
+            "default": false,
+            "description": "When `true`, the host validates inbound task payloads against `handoff.taskSchemaRef` before dispatch and outbound results against `handoff.returnSchemaRef` before persistence (RFC 0003 §D). When `false`/absent, manifests carrying `handoff` schemas are dispatched with opaque payloads."
+          }
+        }
+      },
```

### §B `host.agentRuntime` implies `manifestRuntime`

A host that advertises `host.agentRuntime: supported` (the six-method swarm superset) **MUST** be treated by clients and registries as also satisfying `agents.manifestRuntime` — the superset includes manifest instantiation (`spawn({ manifestId })`). This implication is what makes §C backward-safe: packs may be repointed to the lighter dependency without losing eligibility on hosts that only advertise the heavy flag.

### §C Peer-dependency reconciliation (`node-packs.md`)

A pack whose agents need only single-agent or crew dispatch (no `consensus`/`swarmExecute`/`skillInvoke`) **SHOULD** declare:

```json
"peerDependencies": { "agents.manifestRuntime": "supported" }
```

A pack whose agents invoke swarm/consensus/skill primitives **MUST** continue to declare `peerDependencies: { "host.agentRuntime": "supported" }`. Because of §B, repointing the former class from `host.agentRuntime` to `agents.manifestRuntime` is non-breaking: a host advertising `host.agentRuntime` still resolves the lighter dependency. Migrating the 21 currently-over-declared core packs is implementation work (per-pack version bump) tracked as a cross-cut, not part of this RFC's wire surface.

### §D Graceful-degradation ladder

"Universal for any app" requires that the floor run on a host that lacks the richer tiers. Normatively:

- A host advertising `agents.manifestRuntime.supported: true` **MUST** install and dispatch a manifest agent whose declared peer-dependencies are satisfied by the floor alone.
- For a manifest agent that additionally requires an **unmet** tier (e.g. `memoryShape.longTerm: true` on a host without `agents.memoryBackends: ["long-term"]`, or `host.agentRuntime` swarm primitives), the host **MUST** take exactly one of:
  1. **Install degraded** — install the agent with the unmet tier inert (e.g. `longTerm` writes are dropped or downgraded to `scratchpad`), and advertise the degradation honestly so a client can detect it; **or**
  2. **Refuse** — reject install with `unsupported_capability` and `details.requiredCapability` naming the unmet tier (the existing refusal pattern from `capabilities.agents.modelClasses` / `dispatchMapping`).

A host **MUST NOT** silently honor an unmet tier (e.g. accept `longTerm: true` but never persist) without advertising the degradation. Which path a host takes is host policy; the host advertises it.

### §E Cross-reference fix (`host-capabilities.md §host.agentRuntime`)

Correct the RFC citations on the existing `host.agentRuntime` section: `AgentManifest` is **RFC 0003** (not RFC 0008, which is the WASM ABI); `AgentRef` is **RFC 0002**. Add one sentence positioning `agents.manifestRuntime` as the floor and `host.agentRuntime` as the optional swarm/consensus superset that implies it (§B).

### §F Positive / negative examples

Positive — a minimal host advertises the floor:

```json
{ "agents": { "supported": true, "dispatch": true, "manifestRuntime": { "supported": true, "handoffValidation": true } } }
```

Negative — block present without the required `supported` field (fails schema, `additionalProperties: false` + `required`):

```json
{ "agents": { "manifestRuntime": { "handoffValidation": true } } }
```

## Compatibility

**Additive.**

- `manifestRuntime` is a new optional object inside the `agents` block, which is already `additionalProperties: true` — no existing field changes type or optionality; pre-RFC capability docs validate unchanged.
- No existing required field, event type, endpoint, error code, or `MUST` is changed or relaxed.
- The §B implication only _widens_ what an existing `host.agentRuntime` advertisement satisfies; no pack that installs today stops installing.
- §C is a SHOULD for new packs; existing packs are untouched until separately migrated (and remain installable via §B regardless).
- Backward-compat clause: a client that does not understand `manifestRuntime` ignores it and sees the host exactly as before; a host that does not emit it is treated as "no manifest-agent instantiation," which is today's behavior.

## Conformance

- **Existing** scenarios that cover adjacent surface: `agent-pack-install.test.ts`, `agentPackHandoffSchemaValidation.test.ts` (RFC 0003 §D), `agent-pack-prompt-traversal.test.ts` (RFC 0003 §C), the dispatch/orchestrator suite (RFC 0007/0037).
- **New** scenario `agent-manifest-runtime.test.ts`, gated on `capabilities.agents.manifestRuntime.supported`: install a signed agent pack → resolve a manifest agent from the registry → dispatch it → assert the observable `agent.*` event sequence, `toolAllowlist`-filtered tool surface, and (when `handoffValidation: true`) task/return validation. Soft-skips honestly when the host does not advertise the flag.
- The scenario runs only when the capability is advertised, per `conformance/coverage.md` §"Capability-gated scenarios."

## Alternatives considered

1. **Schematize + implement the full `host.agentRuntime` (six methods) as the runtime.** Rejected as the floor: it forces a host to implement `swarmExecute`/`consensus` to run a single code-reviewer, and keeps the 21 packs coupled to a heavyweight surface. `host.agentRuntime` remains valuable as the optional superset (§B) for vendor swarm packs — this RFC complements it, it does not replace it.
2. **No new flag — treat manifest loading as pure reference-host implementation of RFC 0003.** Rejected: without an advertised flag, a pack cannot express the floor dependency distinctly from swarm, conformance cannot gate the runtime, and a host operator cannot tell from discovery whether an agent pack will run. RFC 0003 specifies the _mechanism_; advertisement/gating is wire contract that needs a flag.
3. **Do nothing.** The 31 manifests stay inert; OpenWOP keeps a signed, portable agent artifact that nothing can instantiate — the worst outcome for "the portable agent protocol."

## Unresolved questions

1. **Degradation default.** Should the spec recommend "install degraded + advertise" or "refuse with `unsupported_capability`" as the SHOULD-default when a tier is unmet (§D), or leave it fully host-policy?
2. **Flag granularity.** Is `manifestRuntime: { supported, handoffValidation }` the right grain, or should `toolAllowlist` enforcement and `systemPromptRef` resolution also be individually advertised sub-flags rather than mandated-when-supported?
3. **Normative listing endpoint.** Should `GET /v1/agents` (registry-backed agent inventory) be promoted from the current sample-extension `/v1/host/sample/agents` to a normative endpoint in this RFC, or in a follow-on additive RFC once the floor is proven on ≥2 hosts?

## Implementation notes (non-normative)

- `AgentRegistry` mirrors `getNodeRegistry()` (`src/executor/agentRegistry.ts`); a lazy resolver mirrors `nodePackResolver.ts`; the loader extends `tarballLoader.ts` to parse `manifest.agents[]`; `registryInstaller.ts` adds `prompts` to its extraction allowlist so `systemPromptRef` files land. Dispatch wires the resolved agent (system prompt + `toolAllowlist` filter + handoff validation + confidence threshold) into the existing `core.dispatch`/orchestrator path. None of this is new wire — it is RFC 0003 §ImplNotes (`installAgents`) finally implemented, advertised behind this flag.
- **Cross-cut (CC):** migrating the 21 core packs' `peerDependencies` from `host.agentRuntime` to `agents.manifestRuntime` (per §C) is a separate, version-bumping change coordinated with the impl plan; it is backward-safe via §B and is NOT required to land this RFC.
- Implementing the floor on one reference host closes RFC 0003's long-open acceptance criterion "Reference host installs and resolves at least one agent pack."

## Acceptance criteria

- [ ] Spec text merged (this file + §E cross-ref fix in `host-capabilities.md` + §C/§D prose in `node-packs.md`).
- [ ] `agents.manifestRuntime` added to `capabilities.schema.json`.
- [ ] `agent-manifest-runtime.test.ts` conformance scenario, capability-gated.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] One reference host advertises `agents.manifestRuntime` and loads + dispatches at least one manifest agent end-to-end (also closes RFC 0003's reference-host criterion).

## References

- RFC 0002 (Agent Identity + `AgentRef` + §A14 toolAllowlist + §F confidence), RFC 0003 (Agent Packs — install + `systemPromptRef`/handoff resolution + `installAgents`/`AgentRegistry`), RFC 0007 (Dispatch), RFC 0037/0039/0061 (multi-agent execution + loop lifecycle).
- `spec/v1/host-capabilities.md §host.agentRuntime`, `spec/v1/node-packs.md`, `spec/v1/capabilities.md`.
- `docs/OPENWOP-AGENT-RUNTIME-ANALYSIS.md`, `docs/OPENWOP-AGENT-RUNTIME-HANDOFF.md`.
