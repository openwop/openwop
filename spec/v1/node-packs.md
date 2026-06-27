# OpenWOP Spec v1 — Node Packs and the Public Registry

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of the pack manifest format, distribution, signing, and registry HTTP API. Language-neutral stable surface for external review. The hosted reference registry is live at `https://packs.openwop.dev/`; local registry contents are summarized in `docs/PROTOCOL-STATUS.md`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Workflows in v1 are written against a fixed set of `core.*` node typeIds. Every implementation re-implements the same nodes (AI prompt calls, approval gates, HTTP fetches) because there's no shared distribution channel. Workflows that depend on a vendor-specific typeId (`vendor.acme.salesforce-upsert`) can't run against an implementation that doesn't ship that node.

openwop defines **node packs** as the unit of distribution. A pack is a self-describing archive containing:

1. A **manifest** declaring the node typeIds, schemas, and engine-version requirements.
2. A **runtime artifact** the engine loads at workflow-registration time (language-specific: a JS bundle, Python wheel, Go plugin, WASM module, or a remote MCP endpoint).
3. Optional **assets** (icons, prompt fragments, doc fragments).

An OpenWOP-compliant **registry** is an HTTP service that hosts published packs and exposes a discovery + fetch API. A hosted reference registry is planned at `https://packs.openwop.dev/`; deployers MAY operate private registries (the [npm enterprise](https://docs.npmjs.com/about-npm-enterprise) analog).

The pack/registry idiom parallels [npm](https://npmjs.com/) and [Helm chart repositories](https://helm.sh/docs/topics/chart_repository/) — chosen for ecosystem familiarity, not vendor lock-in.

---

## Pack identity

### Naming

Pack names use the reverse-DNS convention enforced by `typeId` patterns elsewhere in the spec (`workflow-definition.schema.json` §typeId):

```text
<scope>.<author>.<pack>
```

| Scope                  | Reservation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.*`               | Reserved for spec-canonical packs maintained by the openwop working group. Third parties MUST NOT publish under this scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `vendor.<org>.*`       | Vendor-published packs. The `<org>` segment is reserved on first-publish; subsequent publishes from a different account return `403 forbidden`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `community.<author>.*` | Hobbyist / individual packs. Lighter reservation; squatting is disputable but enforcement is best-effort.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `private.<host>.*`     | **Host-internal packs** running on a single deployment's private registry. The `<host>` segment is operator-chosen and MUST NOT collide with reserved values. The public registry at `packs.openwop.dev` MUST refuse `private.*` uploads with `400 invalid_pack_scope` — `private.*` is for self-hosted registries only. Mirrors the `local.*` "not for public registries" semantic, distinguished by intent: `local.*` is in-repo / dev-time; `private.<host>.*` is the host's curated production registry. See registry-operations.md §"Host-private marketplace relationship" for the deployment model. |
| `local.*`              | NOT published. Reserved for in-repo / unpublished private packs. Registries MUST refuse `local.*` uploads with `400 invalid_pack_scope`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Reserved Core OpenWOP node typeIds

Within the `core.*` scope, the following typeIds are reserved for workflow primitives that every OpenWOP-compliant server is expected to provide.

| TypeId                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.start`                   | Workflow entry point.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `core.end`                     | Workflow terminal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `core.conditional`             | Routing on edge conditions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `core.delay`                   | Wall-clock pause.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `core.loop`                    | Iteration construct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `core.parallel`                | Fan-out / parallel execution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `core.merge`                   | Fan-in / synchronization point.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `core.setVariable`             | Write to workflow variables.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `core.getVariable`             | Read from workflow variables.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `core.interrupt`               | HITL primitive — see `interrupt.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `core.identity`                | Echo-input primitive — passes a named input port to an output port unchanged. Used by conformance fixtures to verify input/output passthrough; servers SHOULD ship for v1 conformance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `core.subWorkflow`             | Synchronous sub-workflow invocation — parent waits for child terminal. Config shape, output shape, and `outputMapping` semantics are normative; see §"`core.subWorkflow` contract" below + `conformance/fixtures.md` §`conformance-subworkflow-parent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `core.channelWrite`            | Write a value to a named channel using a typed reducer (v1: `append` only) with optional `ttlMs` filtering. Closes C3 channel-TTL fold. See `channels-and-reducers.md` §append + §TTL and `conformance/fixtures.md` §`conformance-channel-ttl`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `core.orchestrator.supervisor` | Multi-Agent Shift Phase 5. Observes worker completions and emits an `OrchestratorDecision` (`schemas/orchestrator-decision.schema.json`) — discriminated union over `next-worker` / `ask-user` / `terminate`. Hosts advertising `capabilities.agents.orchestrator: true` MUST register this typeId. Pairs with `RunSnapshot.runOrchestrator` (the supervisor identity for the run's lifetime) and the `runOrchestrator.decided` event. Conservative-path: when the supervisor's `agent.decided.confidence` is below the resolved escalation threshold, the node MUST suspend via `node.suspended { reason: 'low-confidence' }` per the CP-1 invariant. **Conformance hooks** (RFC 0023 §C + RFC 0022 §"Unresolved questions" #6): hosts MAY honor three conformance-only config keys on this typeId: |

- `config.mockConfidence` (number 0..1) — overrides the live agent's `agent.decided.confidence`. Used by `conformance-orchestrator-low-confidence` (CP-1).
- `config.mockPendingDecision` (`OrchestratorDecision`) — overrides the live decision shape for a single tick. Used by `conformance-orchestrator-low-confidence`.
- `config.mockDispatchPlan` (`OrchestratorDecision[]`) — drives a deterministic sequence of decisions across ticks, indexed by the count of prior `runOrchestrator.decided` events on the run. Once the plan is exhausted, the host MUST emit `kind: 'terminate'`. Lets fixtures script multi-worker dispatch sequences without a live LLM. Used by the RFC 0022 dispatch-mapping fixtures (`conformance-dispatch-{input,output,cross-worker-handoff}-mapping`).

All three keys are conformance-only — hosts that honor them outside conformance test workflows MUST advertise `capabilities.conformance.mockAgent: true` (RFC 0023 §B.2) and MUST gate the keys behind a per-tenant role check. |
| `core.dispatch` | Multi-Agent Shift Phase 6. Consumes the latest `OrchestratorDecision` (typically wired from an upstream `core.orchestrator.supervisor` via DAG edge) and acts on it: `next-worker` dispatches each `nextWorkerIds[i]` as a child run (delegates to `core.subWorkflow` machinery); `ask-user` suspends via `core.conversationGate` (if `capabilities.conversationPrimitive: true`) or `clarification.requested` interrupt; `terminate` completes the run cleanly. Configuration shape: `schemas/dispatch-config.schema.json`. Conservative-path commitment (CP-2): MUST NOT mutate the run's DAG mid-run — each iteration runs against the static template DAG. Hosts advertising `capabilities.agents.dispatch: true` MUST register this typeId. See `conformance/src/scenarios/dispatchLoop.test.ts`. |
| `core.conversationGate` | Multi-Agent Shift Phase 4. Multi-turn conversation primitive — `open`/`exchange`/`close` lifecycle on a single typeId. `open` mints a `conversationId` and emits `conversation.opened`. `exchange` suspends with the prompt; resume value MUST validate against the per-turn schema declared in node config; emits `conversation.exchanged`. `close` ends the conversation, emitting `conversation.closed`. Conversation log is replay-deterministic via the `message` reducer (see `channels-and-reducers.md`). Hosts advertising `capabilities.conversationPrimitive: true` MUST register this typeId; pre-MAS hosts route multi-turn user interjections through `clarification.requested` instead. |
| `core.conformance.mock-agent` | **Conformance-only** (RFC 0023). Drives the five `agent.*` event types on cue from `config.{mockReasoning, mockToolCalls, mockHandoff, mockDecision, mockConfidence}`. Config shape: `schemas/core-conformance-mock-agent-config.schema.json` (`additionalProperties: false`). Emission contract (RFC 0023 §B): emit `agent.reasoned` → `agent.toolCalled`/`agent.toolReturned` pairs (in array order, paired by host-minted `callId`) → `agent.handoff` → `agent.decided`. When the emitted `agent.decided.confidence` falls below the resolved escalation threshold, the host MUST follow with `node.suspended { reason: 'low-confidence' }` per `interrupt.md` §`kind: "low-confidence"`. Hosts MUST refuse this typeId at workflow registration unless the workflow id matches the conformance fixture prefix (`conformance-*`) OR the host advertises `capabilities.conformance.mockAgent: true`. Production deployments SHOULD NOT register this typeId. Used by `conformance-agent-reasoning` and `conformance-agent-low-confidence`. |

The naming convention is `core.<conceptName>` — flat camelCase compound for multi-word names. Multi-segment dotted typeIds (e.g., `core.ai.callPrompt`) live in the **portable optional** node-pack tier (`openwop.*` / `vendor.*`), not in Core openwop. Implementations MUST register these typeIds before claiming v1 conformance.

A pack's contributed `nodes[].typeId` is **recommended** but **not required** to be prefixed by the pack `name` (`node-pack-manifest.schema.json` permits any reverse-DNS namespace) — so consumers MUST NOT discover a typeId's providing pack by string-prefixing. See [`registry-operations.md` §"Type-ID indexing and cross-namespace exports"](registry-operations.md#type-id-indexing-and-cross-namespace-exports) for the `publishedTypeIds[]` reverse-index that resolves cross-namespace exports.

The `core.conformance.*` prefix is reserved for conformance-only typeIds (typeIds that ship to satisfy the conformance suite, not for production workflows). Hosts MAY refuse `core.conformance.*` typeIds entirely; hosts that register them MUST gate per-typeId per the typeId's contract (e.g., `core.conformance.mock-agent` is gated on workflow id prefix `conformance-*` OR `capabilities.conformance.mockAgent: true`). Production deployments SHOULD omit the prefix from the typeId registry. See RFC 0023.

### Authorized emitters for `agent.*` events

RFC 0002 §B specifies the wire shape of the five `agent.*` events (`agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided`). The normative mapping from typeId → which events it MAY emit lives in **RFC 0023 §A** (Authorized-Emitters table). Summary: `core.orchestrator.supervisor` emits `agent.decided` (and the CP-1 follow-up `node.suspended`); `core.dispatch` emits `agent.handoff` on `next-worker` decisions when the worker's `nodes[].agent` differs; LLM-block typeIds (`openwop.llm.*` portable-optional) emit `agent.reasoned` + `agent.toolCalled` + `agent.toolReturned` + `agent.decided`; MCP tool-call typeIds (`core.mcp.toolCall` or `openwop.mcp.*`) emit `agent.toolCalled` + `agent.toolReturned`; the conformance-only `core.conformance.mock-agent` emits any subset on cue. **Passthrough primitives (`core.identity`, the published `core.openwop.flow.noop` pack) MUST NOT emit `agent.*` events.** Hosts that conflate passthrough with agent semantics are non-conformant.

**RFC 0024 streaming addendum.** Any typeId authorized to emit `agent.reasoned` MAY also emit `agent.reasoning.delta` events for the same reasoning block, incrementally, while the block is still open — gated on `capabilities.agents.reasoning.streaming: true`. The closing `agent.reasoned` remains required after the deltas; it carries the full authoritative reasoning. `agent.reasoning.delta` MUST NOT be emitted by typeIds that are not also authorized to emit `agent.reasoned` (passthrough primitives still excluded).

### `core.subWorkflow` contract

`core.subWorkflow` dispatches a child run of a different workflow document and waits for that child's terminal status before completing. The contract is normative for v1 conformance.

**Config shape:**

```json
{
  "workflowId": "<child-workflow-id>",
  "waitForCompletion": true,
  "onChildFailure": "fail-parent" | "absorb",
  "inputMapping": { "<childVar>": "<parentVar>" },
  "outputMapping": { "<parentVar>": "<childVar>" },
  "propagateCancellation": true
}
```

- `workflowId` (required, string): the child workflow document identifier. Hosts MUST refuse the parent run with `unknown_child_workflow` if no such workflow is loaded.
- `waitForCompletion` (optional, boolean, default `true`): whether the parent blocks on the child's terminal status. `false` is reserved for a future asynchronous variant; v1 hosts MAY refuse `false` with `validation_error`.
- `onChildFailure` (optional, closed enum, default `"fail-parent"`): `"fail-parent"` propagates the child's failure to the parent's `node.failed` event and subsequent `run.failed`; `"absorb"` records the child's failure but lets the parent continue.
- `inputMapping` (optional, object — RFC 0022 §B): a `childVar → parentVar` map applied at child-run create time. For each `(childKey, parentKey)` pair, the host MUST seed the child workflow's initial variable bag with `childKey ← parentVariables[parentKey]`. The seeding overrides any `variables[].defaultValue` declaration on the child workflow with a matching name. Unset parent variables MUST surface as `undefined` on the child variable (the host MUST NOT throw, MUST NOT coerce to `null`). The seeding fold is one-shot at run-create time; subsequent parent-variable mutations do NOT propagate to the child mid-run. Gated on `capabilities.subWorkflow.inputMapping: true`; hosts without that advertisement MUST refuse workflows that carry a non-empty `inputMapping` at registration with `validation_error` + `details.requiredCapability: "subWorkflow.inputMapping"`. Silent ignore is NOT conformant.
- `outputMapping` (optional, object): a `parentVar → childVar` map. After the child reaches `completed`, the host MUST copy each named child variable into the parent's variables under the mapped key. Missing child variables MUST surface as `undefined` (the host MUST NOT throw); the host MUST NOT overwrite parent variables for entries whose child source is `undefined`.
- `propagateCancellation` (optional, boolean, default `true`): when the parent enters `cancelling`, whether to cascade-cancel the in-flight child. See `interrupt-profiles.md` §"Parent-child cancellation."

**Output shape (normative).** On child terminal, the parent's `node.completed` event payload MUST carry `outputs.childRunId` (string) and `outputs.childStatus` (closed enum: `"completed" | "failed" | "cancelled"`):

```json
{
  "type": "node.completed",
  "nodeId": "<subwf-node-id>",
  "data": {
    "outputs": {
      "childRunId": "run-...",
      "childStatus": "completed"
    }
  }
}
```

Hosts that want to carry additional fields (e.g., aggregate `childOutcome` enum, retry counters) MAY add them under `data.outputs.*` but MUST NOT remove `childRunId` / `childStatus`.

**Parent linkage.** Every child run launched via `core.subWorkflow` MUST carry `RunSnapshot.parentRunId` (the parent's runId) and `RunSnapshot.parentNodeId` (the dispatching node's id). Both fields are required on the child's `GET /v1/runs/{runId}` response.

**Variable seeding.** A child run's variables MUST be initialized from the child workflow's `variables[].defaultValue` declarations at run-create time. Mid-run mutations to those defaults are out of scope (the next write wins per the channel reducer); the seeding rule covers the initial fold only. When `inputMapping` is set (per RFC 0022 §B) and the host advertises `capabilities.subWorkflow.inputMapping: true`, the seeding fold is two-pass: first `defaultValue` declarations, then `inputMapping` projections (which override matching keys). The two passes are non-conflicting because `defaultValue` is author-supplied at workflow registration while `inputMapping` is host-supplied at runtime.

**Conformance:** `conformance/src/scenarios/subworkflow.test.ts` and the `conformance-subworkflow-parent`/`conformance-subworkflow-child` fixtures exercise the contract end-to-end.

#### `outputAttestation` — verify-before-merge (RFC 0063, `Active`)

**Why this exists.** `outputMapping` merges a child's outputs into the parent the instant the child reaches `completed`, with no integrity check and no gate. For autonomous fan-out — a supervisor dispatching N workers whose artifacts are merged back — blind merge means one compromised or hallucinated child artifact silently enters the parent's state. `outputAttestation` adds opt-in _verification before merge_: a content checksum the parent can verify, and an optional approval gate that suspends before the merge.

**Capability flag:** `capabilities.agents.subRunAttestation: true` (RFC 0063). Hosts that omit / `false` this flag treat `outputAttestation` as inert — blind merge, exactly today's behavior — and MUST NOT refuse a workflow that carries the block (it is forward-compatible advisory config, unlike `inputMapping`).

**Config shape (additive, all fields optional):**

```json
{
  "outputMapping": { "<parentVar>": "<childVar>" },
  "outputAttestation": {
    "checksum": true,
    "algorithm": "sha256",
    "requireApproval": false,
    "principalScope": ["report:write"]
  }
}
```

- **§B — checksum (when `checksum: true`).** After the child reaches a terminal status and its outputs are harvested but **before** `outputMapping` is applied, the host MUST (1) compute a checksum over the child's harvested output object using RFC 8785 JCS canonicalization + SHA-256 — the same recipe pinned for replay cache keys in [`replay.md`](./replay.md) (RFC 0041) — so the digest is host-independent and a parent can verify a child that ran on a different host (RFC 0040); (2) surface it as the additive optional `attestation { checksum, algorithm }` object on the existing `core.workflowChain.event { phase: 'output.harvested' }` (RFC 0037 — no new event type; that phase _is_ the merge point) AND under the sub-workflow node's `node.completed` `data.outputs.attestation.checksum`; (3) apply `outputMapping` as today. The checksum is **advisory for verification** — the parent or a downstream node MAY compare it against an expected value and fail the parent on divergence; the host MUST NOT itself reject on a checksum mismatch (that is policy, expressed as a parent node).
- **§C — approval gate (when `requireApproval: true`).** After harvest and **before** `outputMapping`, the host MUST suspend the parent via an `approval` interrupt (RFC 0051; see [`interrupt.md`](./interrupt.md)) carrying the child's outputs as the artifact (`actions: ['accept', 'reject', 'edit', 'ask']`). The merge proceeds **only** on `accept` (merge the child outputs unchanged) or `edit-accept` (merge the approver's `editedArtifactData`). On `reject` the host MUST NOT merge and MUST surface per the node's `onChildFailure` policy (`fail-parent` or `absorb`). This MUST **fail closed**: if the run terminates or the interrupt expires without an `accept`/`edit-accept`, the outputs MUST NOT be merged. (Backed by the proposed protocol-tier SECURITY invariant `subrun-merge-approval-fail-closed`, which lands with its public conformance test at reference-host implementation, not at `Active`.) One `approval` interrupt per child for v1; batched fan-out approval is a later optional optimization.
- **§D — `principalScope` (optional).** When present, narrows the child run's effective scopes to the named RFC 0049 scopes — a child dispatched to "write a report" MAY be denied "delete data" even though the parent principal holds it. This references RFC 0049 scopes and defines no new ones; it reaffirms and tightens the existing tenant-inheritance isolation.

**Compatibility.** Additive — an absent `outputAttestation` is identical to today's blind merge; the `attestation` field is an additive optional property on the existing `output.harvested` phase (its `required` array is unchanged; consumers ignore it); the gate reuses RFC 0051's `approval` interrupt with no new kind. **Conformance:** `subrun-attestation-shape.test.ts` (always-on where `core.subWorkflow` is supported) + `subrun-checksum-stable.test.ts` / `subrun-approval-gate.test.ts` / `subrun-approval-fail-closed.test.ts` (gated on `agents.subRunAttestation` + the sub-run attestation seam in [`host-sample-test-seams.md`](./host-sample-test-seams.md) §"Open seams"; soft-skip until a host wires it).

### Versioning

Pack versions follow [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`). Workflow definitions pin pack versions via the same range syntax as npm (`^1.2.3`, `~1.2.0`, `>=1.0 <2.0.0`).

A registry MUST return the highest version satisfying the requested range. Prerelease versions are ONLY returned when the range is explicit (`^1.2.3-beta` matches `1.2.3-beta.1` but `^1.2.3` does NOT match prerelease versions per semver's "prerelease versions have lower precedence" rule).

### Dependency resolution + lockfile

Workspace operators MAY commit a `pack-lock.json` lockfile alongside their workflow definitions. The lockfile pins resolved versions of every pack a workspace depends on so that re-installation produces byte-identical artifacts.

**Why lockfiles.** Semver ranges are flexible by design — `^1.2.3` matches `1.2.3` today and `1.5.0` tomorrow. For audit-grade reproducibility (regulated deployments, supply-chain forensics, debug-bundle replay), workspaces need a way to pin the exact resolved version + tarball hash. Lockfiles encode that pin.

**Lockfile shape.** Defined in `schemas/pack-lockfile.schema.json`:

```json
{
  "lockfileVersion": 1,
  "generatedAt": "2026-05-12T18:00:00Z",
  "registry": "https://packs.openwop.dev",
  "packs": [
    {
      "name": "vendor.openwop.rust-hello",
      "version": "1.0.0",
      "resolved": "https://packs.openwop.dev/v1/packs/vendor.openwop.rust-hello/-/1.0.0.tgz",
      "integrity": "sha256-q3PFh1Yj+r...=",
      "signature": {
        "algorithm": "ed25519",
        "publicKey": "MCowBQYDK2VwAyEA...",
        "value": "wkjLZ8N1g...=="
      },
      "dependencies": {},
      "peerDependencies": { "host.aiEnvelope": "supported" }
    }
  ]
}
```

**Resolution rules (normative).** When a lockfile is present:

1. **Resolvers MUST honor the lockfile's exact versions.** A workspace with `pack-lock.json` ignores the manifest's range and installs the exact `version` from the lockfile entry. This is the "frozen-lockfile" mode in npm-family tooling.
2. **Resolvers MUST verify integrity.** The fetched tarball's SHA-256 MUST match `packs[].integrity`. Mismatch fails the install with `pack_integrity_mismatch`.
3. **Resolvers MUST verify signature when present.** When `packs[].signature` is recorded, the Ed25519 signature over the tarball MUST verify against `packs[].signature.publicKey`. Mismatch fails with `pack_signature_invalid`.
4. **Resolvers MUST verify host peerDependencies.** For each lockfile entry, the resolver consults the host's `/.well-known/openwop` (per `host-capabilities.md` §"Capability negotiation") and confirms every `peerDependencies` key is satisfied. Missing host capability fails with `pack_peer_dependency_missing` per existing rules.
5. **Resolvers MUST refuse partial lockfiles.** If a workspace references a pack not listed in the lockfile, the install fails with `pack_lockfile_incomplete`. Either regenerate the lockfile or remove the unreferenced pack.
6. **Mode without a lockfile.** When no `pack-lock.json` is present, the resolver runs normal semver resolution against the manifest ranges. This is the "free" mode; suitable for development.

**Lockfile regeneration.** Workspace tooling (a CLI installer, not part of the protocol) writes the lockfile after a successful resolution. The protocol does not specify CLI ergonomics — only the on-disk shape + the verification rules a resolver MUST follow when the file is present.

**Agent-pack peer-dependencies (RFC 0070).** A pack that ships `agents[]` (RFC 0003) declares which agent-runtime tier its agents need via `peerDependencies`. A pack whose agents need only single-agent or crew dispatch SHOULD declare `{ "agents.manifestRuntime": "supported" }` — the minimal floor (load the manifest into an `AgentRegistry`, dispatch on the existing `core.dispatch`/orchestrator loop, enforce `toolAllowlist` + BYOK redaction). A pack whose agents invoke swarm / consensus / skill primitives MUST declare `{ "host.agentRuntime": "supported" }` instead. Because a host advertising `host.agentRuntime` **implies** `agents.manifestRuntime` (RFC 0070 §B), a floor-tier dependency resolves on both minimal and swarm hosts; declaring the heavier key on a floor-only host needlessly narrows eligibility. **Graceful degradation (RFC 0072 §C — per-dependency, pack-author-declared).** Each `peerDependencies` entry is **required** by default: unmet ⇒ the host MUST refuse install with `pack_peer_dependency_missing` naming the unmet capability. A pack MAY mark an entry **optional** via `peerDependenciesMeta` (`{ "<cap>": { "optional": true } }`). When an `optional: true` dependency is unmet the host MUST install the agent with that tier inert **and** surface the degraded set (the unmet capability keys) on the agent's inventory entry (`degraded[]`, see below / RFC 0072 §A) so a client detects it. A host MUST NOT silently accept a manifest and never honor a declared tier (the RFC 0070 §D MUST-NOT carries forward). The default (no `peerDependenciesMeta` entry) is `required` — packs published before RFC 0072 validate unchanged.

**Agent inventory (RFC 0072 §A — normative).** A host advertising `capabilities.agents.manifestRuntime.supported: true` MUST serve a read-only inventory of its installed manifest agents at `GET /v1/agents` (`{ agents: AgentInventoryEntry[], total }`) and `GET /v1/agents/{agentId}` (one entry, or `404`); see `api/openapi.yaml` + `agent-inventory-response.schema.json`. The entry is a read projection of the `AgentManifest` and MUST NOT carry the system-prompt body, resolved handoff schemas, or credential material (SR-1). Dispatch is **not** a bespoke endpoint: a manifest agent is invoked as a run whose node pins it via `WorkflowNode.agent` (RFC 0002) + `POST /v1/runs`, inheriting replay/fork/idempotency/observability (RFC 0072 §B). A host that runs a function-calling loop during that dispatch (the model requesting the agent's `toolAllowlist` tools) advertises per-tool authorization / rate-limiting / content-free audit through the **top-level** `Capabilities.toolHooks` block (`host-capabilities.md` §host.toolHooks, RFC 0064), **not** a sub-flag of `agents`.

**Inventory scope (RFC 0074 — normative).** `GET /v1/agents` returns the manifest agents available to the **authenticated principal's tenant·workspace** (the RFC 0048 owner triple resolved from the request), advertised via `capabilities.agents.manifestRuntime.installScope`. On a single-tenant host (`installScope: 'host'`, the default) that is the whole host — identical to the RFC 0072 §A behavior above. On a multi-tenant host (`installScope: 'tenant'`) it is the set the principal's workspace has installed/approved (per this section's per-workspace resolution): an agent the principal's workspace has not approved MUST be absent from `GET /v1/agents` and MUST `404` on `GET /v1/agents/{agentId}` — indistinguishable from "not installed," so the surface never discloses another tenant's inventory. A `'tenant'`-scoped host MUST reject an unauthenticated/unscoped request per its standard auth contract and MUST NOT fall back to a host-global listing. A host MUST NOT advertise `installScope: 'tenant'` while serving a host-global list (truthful-advertisement, `capabilities.md`). `installScope` governs only the inventory surface — dispatch (RFC 0072 §B) and the floor safety guarantees (`toolAllowlist` / `systemPromptRef` / SR-1, RFC 0072 §D) are unchanged regardless of scope.

**Mixed-namespace lockfiles.** A workspace MAY depend on packs from multiple registries. Each `packs[]` entry's `resolved` URL identifies its registry. The top-level `registry` field is the default for entries that omit `resolved`. Resolvers MUST verify integrity per-entry regardless of registry — there's no cross-registry trust transfer.

**Failure modes (normative codes).** Error envelopes returned by the resolver MUST use these codes:

- `pack_integrity_mismatch` — fetched tarball SHA-256 ≠ lockfile `integrity`.
- `pack_signature_invalid` — Ed25519 signature verification failed.
- `pack_peer_dependency_missing` — host doesn't advertise a required peer capability.
- `pack_lockfile_incomplete` — workspace references a pack not in the lockfile.
- `pack_version_not_found` — lockfile pins a version the registry no longer serves (post-yank scenario). Operators recover by regenerating the lockfile or pinning to an alternative version.
- `pack_dependency_conflict` — two packs in the dependency graph pin incompatible versions of a third pack and the resolver cannot find a common version satisfying both ranges. Caller resolves by adjusting the conflicting packs' ranges OR by pinning an explicit override in the lockfile (per §"Transitive dependency resolution" below).
- `pack_dependency_cycle` — the dependency graph contains a cycle (`A → B → A` or longer). Pack dependencies MUST form a DAG.

### Transitive dependency resolution

Closes NP2. Packs MAY declare `dependencies` in their manifest — other packs whose nodes / agents the depending pack composes with. Transitive dependencies are resolved recursively:

```json
"dependencies": {
  "vendor.example.shared": "^1.2.0",
  "core.openwop.examples": "1.0.0"
}
```

Values are semver ranges per [semver.org](https://semver.org/) (`X.Y.Z` exact, `^X.Y.Z` compatible, `~X.Y.Z` patch-only). Resolvers MUST honor the canonical npm-family precedence: exact > tilde > caret > wildcard.

**Resolution algorithm (normative).** A resolver invoked against a workspace's top-level manifests:

1. **Collect direct dependencies.** Build the set of `(packName, range)` pairs from every workflow definition's `requires[]` and from each loaded pack's manifest-level `dependencies`.
2. **Recurse depth-first.** For each unresolved `(packName, range)`, fetch the pack's `index.json` from the registry, pick the highest version satisfying the range, then enqueue its own `dependencies` for resolution. Continue until the queue is empty.
3. **Detect conflicts.** If two paths through the graph produce different version selections for the same `packName`, the resolver MUST search for a single version that satisfies BOTH ranges. If no version satisfies both, fail with `pack_dependency_conflict` carrying `details: { packName, conflictingRanges: [{requestedBy, range}, ...] }`.
4. **Detect cycles.** A pack's `dependencies` graph MUST form a DAG. If the recursion re-enters a pack already on the active path, fail with `pack_dependency_cycle` carrying `details: { cycle: [<packName>, ...] }`.
5. **Pin in the lockfile.** Every resolved pack — direct AND transitive — gets a top-level entry in `pack-lock.json` `packs[]`. The `dependencies` field on each entry pins the EXACT version chosen for each of that pack's declared dependencies. Transitive packs appear ONCE in the top-level array regardless of how many parents request them.

**Override pinning.** When a workspace needs to force a specific transitive version (security patch, conflict resolution), the lockfile MAY carry a top-level `overrides` map keyed by `packName`. Resolvers MUST honor overrides ahead of normal range resolution; the override version MUST still satisfy at least one parent's declared range (otherwise the override is silently breaking the contract — fail with `pack_dependency_conflict`).

```json
{
  "lockfileVersion": 1,
  "registry": "https://packs.openwop.dev",
  "overrides": {
    "vendor.example.shared": "1.2.5"
  },
  "packs": [ /* ... */ ]
}
```

**Resolver determinism.** Two resolvers run against the same registry snapshot + same top-level manifests + same overrides MUST produce byte-identical lockfiles. Determinism is achieved by:

- Sorting `packs[]` lexicographically by `name` then `version`.
- Sorting each pack's `dependencies` map keys lexicographically.
- Stripping whitespace per a canonical JSON serialization (single-newline-terminated, 2-space indent in the published reference).

**Forward-compat note.** Future v1.x minors MAY add lockfile fields (e.g., `peerOverrides`, `optionalDependencies` resolution hints). Resolvers MUST ignore unknown top-level lockfile fields per `COMPATIBILITY.md` §2.1; existing fields keep their semantics.

---

## Manifest format

A pack's manifest is a JSON file named `pack.json` at the pack root. Schema: `schemas/node-pack-manifest.schema.json`.

> **Pack kinds.** Several pack kinds share the `pack.json` filename and are distinguished by an optional top-level `kind` field, each validating against its own manifest schema. Node packs (described in this document) use `kind: "node"` or omit the field entirely. **Workflow-chain packs** — registry-distributed pre-configured DAG fragments that the host editor expands inline at workflow-author time — use `kind: "workflow-chain"` and validate against [`workflow-chain-pack-manifest.schema.json`](../../schemas/workflow-chain-pack-manifest.schema.json); see [`workflow-chain-packs.md`](./workflow-chain-packs.md) (RFC 0013 Phase 1). **Prompt packs** use `kind: "prompt"` and validate against [`prompt-pack-manifest.schema.json`](../../schemas/prompt-pack-manifest.schema.json); see [`prompts.md`](./prompts.md) (RFC 0028). **Artifact-type packs** — typed definitions of the rich artifacts nodes produce (documents, slides, CAD drawings) — use `kind: "artifact-type"` and validate against [`artifact-type-pack-manifest.schema.json`](../../schemas/artifact-type-pack-manifest.schema.json); see [`artifact-type-packs.md`](./artifact-type-packs.md) (RFC 0071 Phase 1). **Chat card packs** — prompt templates bound to a typed output artifact — use `kind: "card"` and validate against [`chat-card-pack-manifest.schema.json`](../../schemas/chat-card-pack-manifest.schema.json); see [`chat-card-packs.md`](./chat-card-packs.md) (RFC 0071 Phase 2). **Connection packs** — portable provider definitions (OAuth endpoints, scope catalogs, reach metadata) the RFC 0045/0047 `provider` string resolves against — use `kind: "connection"` and validate against [`connection-pack-manifest.schema.json`](../../schemas/connection-pack-manifest.schema.json); see [`connection-packs.md`](./connection-packs.md) (RFC 0095). **Front-end plugin packs** — signed, SANDBOXED user-interface extensions (canvas editors, custom artifact viewers, settings panels) a host loads at runtime in a cross-origin isolated iframe and talks to over the closed `ui-plugin/1` host-RPC boundary — use `kind: "frontend-plugin"` and validate against [`frontend-plugin-manifest.schema.json`](../../schemas/frontend-plugin-manifest.schema.json); see [`frontend-plugin-packs.md`](./frontend-plugin-packs.md) (RFC 0117). A manifest MUST declare the content of exactly one kind — `nodes[]` (kind=node) XOR `chains[]` (kind=workflow-chain) XOR `prompts[]` (kind=prompt) XOR `artifactTypes[]` (kind=artifact-type) XOR `cards[]` (kind=card) XOR `provider` (kind=connection, a single object rather than a content array) XOR `uiPlugins[]` (kind=frontend-plugin); mixing is rejected with `pack_kind_invalid`. A `kind: "frontend-plugin"` manifest that carries a backend `runtime` member is likewise rejected with `pack_kind_invalid` (a plugin is sandboxed UI, not a node entry).

```json
{
  "name": "vendor.acme.salesforce-tools",
  "version": "1.4.2",
  "description": "Salesforce CRM nodes for OpenWOP workflows.",
  "author": "Acme Corp <devs@acme.example>",
  "license": "Apache-2.0",
  "homepage": "https://acme.example/openwop/salesforce",
  "repository": "https://github.com/acme/openwop-salesforce",
  "engines": {
    "openwop": ">=1.0 <2.0.0"
  },
  "nodes": [
    {
      "typeId": "vendor.acme.salesforce.upsert",
      "version": "1.4.2",
      "label": "Salesforce Upsert",
      "category": "integration",
      "role": "side-effect",
      "capabilities": ["side-effectful", "mcp-exportable"],
      "configSchemaRef": "schemas/upsert.config.json",
      "inputSchemaRef":  "schemas/upsert.input.json",
      "outputSchemaRef": "schemas/upsert.output.json",
      "requiresSecrets": [
        { "id": "salesforce-oauth", "kind": "oauth-token", "scope": "tenant" }
      ]
    },
    {
      "typeId": "vendor.acme.summarize",
      "version": "1.4.2",
      "label": "AI Summarize",
      "category": "chat",
      "role": "streaming-output",
      "capabilities": ["streamable", "side-effectful", "mcp-exportable"],
      "configSchemaRef": "schemas/summarize.config.json",
      "inputSchemaRef":  "schemas/summarize.input.json",
      "outputSchemaRef": "schemas/summarize.output.json",
      "requiresSecrets": [
        { "id": "anthropic", "kind": "ai-provider", "provider": "anthropic", "scope": "tenant" }
      ]
    }
  ],
  "runtime": {
    "language": "javascript",
    "entry": "dist/index.js",
    "format": "esm"
  },
  "signing": {
    "publicKeyRef": "keys/2026-04.pem",
    "signatureRef": "pack.json.sig"
  }
}
```

### Required fields

| Field             | Description                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`            | Pack name per §naming.                                                                                            |
| `version`         | Semver.                                                                                                           |
| `engines.openwop` | Semver range — which openwop protocol versions this pack works against.                                           |
| `nodes[]`         | Each declared node has `typeId`, `version` (per-node, may differ from pack version), `category`, `role`, schemas. |
| `runtime`         | Language + entry-point + format triple. See §runtime formats.                                                     |

### Optional fields

`description`, `author`, `license`, `homepage`, `repository`, `keywords[]`, `dependencies` (other packs), `peerDependencies` (engine-supplied capabilities the pack consumes — see `host-capabilities.md` for the per-surface contracts), `signing` (see §signing).

### Per-node `requiresSecrets[]`

Each `nodes[].requiresSecrets[]` entry declares a secret the node needs at execution time. Hosts that advertise `Capabilities.secrets.supported = true` resolve these via their secret-resolution adapter; hosts that don't advertise secrets MUST refuse to dispatch a node with non-empty `requiresSecrets` and return `credential_unavailable`.

```json
"requiresSecrets": [
  { "id": "anthropic", "kind": "ai-provider", "provider": "anthropic", "scope": "tenant" },
  { "id": "salesforce-oauth", "kind": "oauth-token", "scope": "tenant" }
]
```

| Field      | Type   | Required               | Notes                                                                                |
| ---------- | ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| `id`       | string | yes                    | Stable id the executor uses to look up the resolved secret.                          |
| `kind`     | enum   | yes                    | `ai-provider` / `api-key` / `oauth-token` / `custom`. Drives host resolution policy. |
| `provider` | string | iff `kind=ai-provider` | Provider id; MUST be in `Capabilities.aiProviders.supported`.                        |
| `scope`    | enum   | no (default `tenant`)  | `tenant` / `user` / `run`. MUST match a scope in `Capabilities.secrets.scopes`.      |

The host's `SecretResolver.resolveSecret(ctx)` returns an opaque `ResolvedSecret` reference that downstream provider adapters dereference internally. Raw key material NEVER appears in events, logs, traces, prompts, errors, exports, or screenshots — this is enforced by NFR-7 at the host layer.

**Engine semantics.** Before dispatching a node with `requiresSecrets`, the engine MUST:

1. Verify each entry's `kind` and `scope` against `Capabilities.secrets`. Mismatch → terminal `failed` with `error.code = credential_unavailable`.
2. If `kind = 'ai-provider'`, verify `provider` is in `Capabilities.aiProviders.supported` AND (for BYOK runs) that the run's `RunOptions.configurable.ai.credentialRef` references a stored credential of the right provider.
3. Call `SecretResolver.resolveSecret({ id, kind, provider, scope, runId, tenantId, userId })` and pass the opaque ref to the executor via the engine's existing context plumbing.

### Per-node `artifact`

A node MAY declare an optional `nodes[].artifact` block stating that the node produces a typed, durable artifact (a PRD, slide deck, CAD model). The block binds the node's output to an artifact type defined by an installed **artifact-type pack** (`artifact-type-packs.md`, RFC 0071).

```json
"artifact": {
  "typeId": "vendor.acme.cad.model",
  "syncOn": "completion",
  "supportsCheckpoint": true
}
```

| Field                | Type    | Required                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typeId`             | string  | no                        | Reverse-DNS `artifactTypeId` the node produces. When it matches an `artifactTypeId` of an installed artifact-type pack on a host advertising `host.artifactTypes`, the host MUST validate the produced artifact against that type's schema before emitting `artifact.created` (see `artifact-type-packs.md` §"Binding the existing artifact surfaces"). When it matches none, it is an unregistered type and MUST NOT be schema-validated. |
| `syncOn`             | enum    | no (default `completion`) | When the host registers the artifact as durable: `completion` / `approval` / `manual`.                                                                                                                                                                                                                                                                                                                                                     |
| `supportsCheckpoint` | boolean | no                        | `true` if the artifact participates in checkpoint/resume.                                                                                                                                                                                                                                                                                                                                                                                  |

`nodes[].artifact.typeId` is the pack-manifest counterpart of the per-instance `WorkflowNode.artifactType` field in `workflow-definition.schema.json`: the pack declares the _default_ artifact type a node produces; a workflow author MAY override per-instance. Hosts that do not advertise `host.artifactTypes` MAY ignore the block entirely — it carries no execution requirement beyond the validation the capability gates.

---

### Model-capability declarations on NodeModules

> Added by RFC 0031 (`Active` 2026-05-20). Parallel surface to `requiresSecrets[]` — declares MODEL capability requirements for envelope-emitting NodeModules. The host's dispatch contract is normated in `host-capabilities.md` §"Model-capability declarations"; this section documents the per-pack authoring surface.

A NodeModule whose execution involves emitting a structured envelope via an LLM call MAY declare two optional fields:

```jsonc
{
  "typeId": "core.ai.callPrompt",
  "version": "1.0.0",
  "category": "ai",
  "role": "callable",
  "requires": ["chat.sendPrompt"],
  "requiresSecrets": [ /* ... */ ],
  "requiredModelCapabilities": ["structured-output", "discriminator-enum"],
  "fallbackModel": { "provider": "anthropic", "model": "claude-opus-4-7" }
}
```

**`requiredModelCapabilities: string[]`** — capability identifiers the active model MUST advertise in `capabilities.modelCapabilities.advertised[]` for the node to dispatch. Spec-reserved: `structured-output`, `discriminator-enum`, `long-context`, `reasoning` (model-native thinking-tokens), `function-calling`. Host-private extensions: `x-host-<host>-<key>`. Empty array (or absent field) means no model-capability requirements.

**`fallbackModel: { provider, model }`** — substitute model coordinates the host MAY use if the active model lacks the declared capabilities. `provider` MUST be in `capabilities.aiProviders.supported[]` for substitution to fire. When absent, the host refuses to dispatch on any unmet capability (no fallback attempt). When the fallback ITSELF fails capability checks, recursive substitution is NOT permitted — the host emits `model.capability.insufficient` with `fallbackAttempted: true` and refuses (RFC 0031 §"Unresolved questions" #3).

**Conformance.** A NodeModule that declares `requiredModelCapabilities` but is loaded by a host that does NOT advertise `capabilities.modelCapabilities.supported: true` is treated as opaque metadata — the host dispatches normally without checking. Hosts that advertise `supported: true` MUST honor the dispatch flow normated in `host-capabilities.md` §"Model-capability declarations" + §"Dispatch flow (normative)" + emit the appropriate `model.capability.*` events per `run-event-payloads.schema.json` §`modelCapabilitySubstituted` / §`modelCapabilityInsufficient`.

**Engine semantics.** Before dispatching a node with `requiredModelCapabilities`, the engine MUST follow the four-step dispatch flow in `host-capabilities.md` §"Model-capability declarations." Failures terminate the run with `error.code = capability_not_provided` (existing error code; reused for model-capability gating per RFC 0031 §F).

### `x-openwop-form` UX hints on `configSchema` properties (RFC 0066, `Draft`)

A pack `configSchema` property MAY carry an `x-openwop-form` annotation hinting to **rendering consumers** (builder apps, low-code editors) that the field should bind to a specific picker UX — model picker, provider picker, credential picker, prompt picker — instead of the schema-default text/select rendering. Hosts MUST NOT read `x-openwop-form`; it has zero effect on host-side validation. The pack `configSchema` itself remains the authoritative validator for what the host accepts.

**Vocabulary** (per [RFC 0066](../../RFCS/0066-x-openwop-form-vendor-extension.md) §A):

| `kind`              | Wire-store shape                    | Renderer behavior                                                                                  |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `text`              | `string`                            | Plain `<input>`. Equivalent to no extension.                                                       |
| `textarea`          | `string`                            | Multi-line `<textarea>`.                                                                           |
| `string-list`       | `string[]`                          | One-per-line textarea round-tripping to `string[]`.                                                |
| `prompt-picker`     | `string` (`PromptRef` per RFC 0027) | Dropdown from the prompt library; honors `promptKind` filter.                                      |
| `provider-picker`   | `string`                            | Dropdown from `capabilities.aiProviders.supported`.                                                |
| `model-picker`      | `string`                            | Dropdown from `capabilities.aiProviders.supportedModels[provider]`; reads sibling via `dependsOn`. |
| `credential-picker` | `string` (`<provider>:<name>`)      | Dropdown filtered by `provider` literal OR by sibling provider via `dependsOn`.                    |

**Optional sub-fields.** `dependsOn` names a sibling property whose current value drives the picker's option set. `provider` (and the legacy alias `credentialProvider`) filters a `credential-picker` when no `dependsOn` is set. `promptKind` constrains a `prompt-picker` to one of `system` / `user` / `few-shot` / `schema-hint`.

**Renderers MUST**:

1. Treat unknown `kind` values as if `x-openwop-form` were absent (forward-compat with future vocabulary additions).
2. When the sibling field named by `dependsOn` changes value, CLEAR the dependent field so stale `{provider: anthropic, model: gpt-5}` configurations don't survive a swap.
3. Treat a `dependsOn` to a non-existent or non-sibling property as if `x-openwop-form` were absent (graceful fallback, not a hard error).

**Renderers MUST NOT** use `x-openwop-form` to bypass `configSchema` validation. The picker constrains _what the user can pick_; the schema constrains _what the host will accept_. Both apply.

**Example** (`core.ai.chatCompletion` config annotated for picker UX):

```jsonc
{
  "properties": {
    "provider": { "type": "string", "x-openwop-form": { "kind": "provider-picker" } },
    "model":    { "type": "string", "x-openwop-form": { "kind": "model-picker",   "dependsOn": "provider" } },
    "credentialRef": { "type": "string", "x-openwop-form": { "kind": "credential-picker", "dependsOn": "provider" } }
  }
}
```

Pack-author opt-in costs nothing for consumers that don't implement RFC 0066: the `x-*` prefix is the standard JSON Schema vendor-extension convention, accepted by every conformant validator and ignored by every renderer that doesn't recognize the key.

---

## Connectors (RFC 0045)

A pack MAY declare itself a **connector** — a named integration exposing typed **actions** (and reusing the existing trigger model) — via an optional top-level `connector` block (`Connector` in `node-pack-manifest.schema.json`). This is the n8n/Make-style _trigger + action + auth + pagination_ bundle, expressed manifest-first rather than as a code SDK. Packs without a `connector` block remain plain node packs; the block is purely additive.

```jsonc
{
  "name": "vendor.acme.salesforce",
  "nodes": [ /* the action + trigger NodeModules */ ],
  "connector": {
    "id": "salesforce",
    "displayName": "Salesforce",
    "auth": { "type": "oauth2", "provider": "salesforce", "scopes": ["api", "refresh_token"] },
    "actions": [
      { "typeId": "vendor.acme.salesforce.upsert", "displayName": "Upsert Record", "idempotent": true, "rateLimit": { "requests": 100, "perSeconds": 60 } },
      { "typeId": "vendor.acme.salesforce.query", "displayName": "SOQL Query", "paginated": true }
    ],
    "triggers": ["vendor.acme.salesforce.onRecordChange"]
  }
}
```

**Action contract (normative).**

1. An **action** is a normal side-effectful node already defined in the pack's `nodes[]`; the connector block adds metadata, it does not introduce a new execution kind. Every `connector.actions[].typeId` MUST resolve to a real `nodes[].typeId` in the same manifest — a manifest whose action references an unknown typeId is invalid and MUST be rejected with `connector_action_unresolved`. The same resolution requirement applies to every entry in `connector.triggers[]`.
2. `idempotent: true` is a hint the host scheduler MAY use to retry the action on transient failure without an idempotency key; `idempotent: false` (or absent) means the host MUST NOT auto-retry without one (composes with `idempotency.md`).
3. `rateLimit` is advertised metadata the host scheduler SHOULD honor when dispatching the action; it does not change the node's wire shape.
4. **Triggers** reuse the existing trigger model unchanged; the connector block only references their typeIds.

**Auth.** `connector.auth` is a `ConnectorAuth`: either an RFC 0047 OAuth2 declaration (`{ type: 'oauth2', provider, scopes[] }`, routed through `host.oauth`) or an RFC 0046 stored-credential reference (`{ type: 'credential', key, scope? }`, resolved by `host.credentials`). A connector declaring `auth: { type: 'oauth2' }` transitively requires `capabilities.oauth.supported`; one declaring `auth: { type: 'credential' }` requires `capabilities.credentials.supported`. Hosts lacking the required capability refuse to register the pack.

**Discovery.** Connectors surface in the `registry/` index and on `packs.openwop.dev` as a distinct artifact facet, so the (future App-layer) connector marketplace has data to render. This is data-only — no new endpoint; the existing registry pack index gains a `connector` facet.

---

## Runtime formats

The `runtime.language` field declares how the engine loads the pack:

| `language`       | `entry` is                                                     | Server requirement                                              |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `javascript`     | Path to a JS module (CommonJS or ESM)                          | Engine running in Node 20+ or a JS-compatible WASM host         |
| `python`         | Path to a Python module / wheel                                | Python 3.10+ runtime adjacent to the engine                     |
| `go`             | Path to a Go plugin (`.so`) or compiled binary                 | Go 1.22+ runtime; plugin support varies by platform             |
| `wasm`           | Path to a `.wasm` core module with a defined ABI               | Any host with a WASM runtime + the RFC 0008 ABI v1 shim         |
| `wasm-component` | Path to a WASM Component Model module (WIT-defined interfaces) | Host with a Component-Model-aware runtime (Wasmtime ≥ 14, etc.) |
| `remote`         | URL to an HTTP endpoint conforming to the MCP tool surface     | Engine acts as MCP client; pack runs anywhere reachable         |

A registry MAY refuse uploads of any `language` it doesn't support. An engine implementation MAY refuse to load packs whose `language` it can't execute, returning `400 unsupported_runtime` at workflow-register time.

For cross-language interop (a JavaScript engine loading a Python pack), the `remote` runtime is the recommended bridge — the engine speaks MCP to the pack process running in its native runtime.

### WASM runtime

`language: wasm` packs are normatively specified by [RFC 0008 — WASM ABI v1](../../RFCS/0008-wasm-abi.md). Hosts loading WASM packs MUST advertise `capabilities.nodePackRuntimes.wasm.{supported, abiVersions, maxMemoryBytes}` per `capabilities.schema.json` and MUST reject packs whose declared `openwop_abi_version()` is not in the advertised `abiVersions[]` (per RFC 0008 §H). The reference loader at `examples/hosts/in-memory/src/wasm-loader.ts` ships zero-dep (uses Node's native `WebAssembly` runtime + a hand-rolled host-import bridge); it is the canonical baseline implementers compare against. Six conformance scenarios cover the surface end-to-end:

| Scenario                                  | Surface                                                                 | RFC 0008 §reference              |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `wasm-pack-load.test.ts`                  | Module instantiation + manifest cross-check                             | §B (exports), §H (ABI handshake) |
| `wasm-pack-invoke-completed.test.ts`      | `openwop_node_invoke` → `outcome: 'completed'` round-trip               | §D (response envelope)           |
| `wasm-pack-invoke-suspended.test.ts`      | `openwop_node_invoke` → `outcome: 'suspended'` interrupt path           | §D, §F (status codes)            |
| `wasm-pack-replay-determinism.test.ts`    | Replay-mode invocation reproduces output bytes-for-bytes                | §I (determinism)                 |
| `wasm-pack-memory-cap.test.ts`            | Misbehaving-pack memory-cap breach → `cap.breached` + terminal `failed` | §K (resource limits)             |
| `wasm-pack-abi-version-rejection.test.ts` | Pack declaring ABI 999 omitted from `loadedPacks[]`                     | §H (ABI version handshake)       |

The two deliberately-misbehaving packs at `examples/packs/rust-misbehaving-memory/` (memory-cap) and `examples/packs/rust-misbehaving-abi/` (ABI 999) drive the positive paths for the last two scenarios. Production hosts MAY use Wasmtime / Wasmer / wasmtime-py / wasmer-go runtimes; the ABI contract is runtime-agnostic.

For the Component Model variant (`language: wasm-component`), per-pack interfaces are defined in WIT rather than the hand-rolled imports/exports from RFC 0008 §C. Hosts advertise via `capabilities.nodePackRuntimes.wasmComponent.supported`; the surface is reserved for an additive sub-RFC.

### Runtime platform requirements (RFC 0076)

A pack MAY declare the **abstract platform primitives its runtime code exercises** via the OPTIONAL `runtime.requires[]` array (`node-pack-manifest.schema.json` `$defs/Runtime.requires`), so a sandbox-based host can gate at **install time** rather than discovering the need by a failed trial-load. This is distinct from `peerDependencies` (host agent-runtime capability _tiers_, RFC 0072 §C) and from `NodeModule.requires` / `capabilities.runtimeCapabilities` (host-advertised _facilities_ checked per-node at dispatch, `capabilities.md`): `runtime.requires` is the _sandbox-primitive_ axis, evaluated once at load.

The vocabulary is **runtime-agnostic** (not language builtin names — `node:dns/promises` does not translate to the Python / Go / wasm runtimes) and **closed**:

| Token                  | Primitive                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `net.dns`              | Resolves hostnames (e.g. SSRF pre-flight).                                                                                                                                          |
| `net.outbound`         | Opens outbound network connections / fetch.                                                                                                                                         |
| `crypto`               | Primitives beyond the standard hashing the host already provides.                                                                                                                   |
| `subprocess`           | Spawns a child process (composes with the RFC 0069 exec-class contract).                                                                                                            |
| `fs.read` / `fs.write` | Reads / writes the local filesystem.                                                                                                                                                |
| `env.read`             | Reads the process environment (may expose deployment secrets if unscrubbed).                                                                                                        |
| `clock`                | Reads wall-clock time as a **behavioral** input — gated for replay determinism (a pack that branches on the clock is non-deterministic on replay, `replay.md`), not access control. |

**Normative behavior.**

- A host that gates platform access MUST evaluate `runtime.requires[]` at install time and MUST refuse install with `pack_runtime_requirement_unmet` (see `registry-operations.md` §"Runtime-requirement install gate") naming any primitive it will not grant — it MUST NOT silently install and fail at first invocation. A non-gating host MAY ignore the field for enforcement but SHOULD project it onto the pack's inventory entry for operator visibility.
- Absent or `[]` ⇒ no elevated platform needs; the two are equivalent. `runtime.requires` declares intent for gating, not an authorization grant — a host MUST still enforce its sandbox at runtime (an undeclared primitive is still denied).
- **Vocabulary versioning.** Extensions are additive (minor version). When a later revision introduces a finer-grained primitive (`net.outbound.http` vs `net.outbound.raw`), a host MUST treat the coarser parent (`net.outbound`) as at-least-as-broad. A host validating against schema v*N* MUST refuse a token introduced after v*N* with `invalid_manifest` — an old host MUST NOT grant a primitive it has not yet specified (the install-time safety contract).

Full rationale, the `ctx.http.safeFetch` companion (a separate track), and the RFC 0069 composition rules are in [RFC 0076](../../RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md).

---

## Distribution

### Pack archive

A pack is distributed as a `.tgz` (gzipped tarball) with the following layout:

```text
pack.json
README.md                  (recommended — surfaces in registry UI)
schemas/                   (JSON Schemas referenced from pack.json `*SchemaRef`)
dist/                      (runtime artifact; path matches `runtime.entry`)
keys/<key-id>.pem          (signing public key, when present)
pack.json.sig              (detached signature over pack.json)
```

The tarball MUST NOT include build artifacts beyond `dist/`, lockfiles, `.git`, `node_modules`, or any other path matched by an opt-out `.openwopignore` (mirrors npm's `.npmignore`).

### Content addressing

Each published pack MUST have a content-addressable identifier — a SHA-256 hash of the tarball — exposed by the registry as `tarballSha256`. Workflow definitions MAY pin this hash for supply-chain integrity:

```json
{
  "engines": { "openwop": "^1.0" },
  "packs": {
    "vendor.acme.salesforce-tools": {
      "version": "1.4.2",
      "integrity": "sha256-Z1OcMeAwT/zYMyN9z/eFoy0e0xUDCcG2rh7Yd6hmvqM="
    }
  }
}
```

Engines MUST verify the hash before loading a pack; mismatch results in `400 pack_integrity_failure`.

### Signing

Packs MAY be signed with [Sigstore](https://www.sigstore.dev/) or a manual public-key signature.

For manual signatures, `pack.json.sig` is an Ed25519 signature over `pack.json` using the key at `keys/<key-id>.pem` (declared in `signing.publicKeyRef`). The registry MAY enforce signature presence on `vendor.<org>.*` namespaces; signature verification is the engine's responsibility at load time.

For Sigstore signatures, `pack.json.sigstore` is a Sigstore bundle. Verification follows [Sigstore client spec](https://docs.sigstore.dev/cosign/verifying/verify/).

A registry MUST surface the verification status in its discovery API so consumers can decide policy (deny on unsigned, prefer Sigstore over manual, etc.).

---

## Registry HTTP API

An OpenWOP-compliant registry MUST expose the following endpoints. All paths are relative to a registry base URL (e.g., `https://packs.openwop.dev/v1/`).

### `GET /v1/packs/{name}`

Discovery — returns metadata about a pack including all published versions, latest version, and download URLs.

```json
{
  "name": "vendor.acme.salesforce-tools",
  "description": "Salesforce CRM nodes for OpenWOP workflows.",
  "versions": {
    "1.4.2": {
      "tarballUrl": "https://packs.openwop.dev/v1/packs/vendor.acme.salesforce-tools/-/1.4.2.tgz",
      "tarballSha256": "sha256-...",
      "manifestUrl": "https://packs.openwop.dev/v1/packs/vendor.acme.salesforce-tools/-/1.4.2.json",
      "publishedAt": "2026-04-26T12:34:56Z",
      "signed": true,
      "signingMethod": "sigstore"
    }
  },
  "dist-tags": { "latest": "1.4.2" }
}
```

**Discovery-driven URL templates.** Registries SHOULD surface their actual URL templates via `.well-known/openwop-registry` `endpoints` (see `registry-operations.md`). Filesystem-backed registries (Firebase Hosting, S3+CDN, etc.) MAY serve pack metadata at `/v1/packs/{name}/index.json` instead of the bare `/v1/packs/{name}` URL because CDN URL-rewrite engines (notably Firebase Hosting's `path-to-regexp` matcher) do not reliably match path segments containing dots, which are common in reverse-DNS pack names. Clients SHOULD consult the discovery document's `endpoints` block and substitute `{name}` / `{version}` into the declared templates rather than hardcoding `/v1/packs/{name}`. Both forms MUST return identical content.

### Schema `$id` resolution

Pack schemas in `schemas/*.json` MAY declare a JSON Schema `$id` URL of the form `https://<registry>/{name}/{version}/<schema-file>.json`. Registries that wish to make these URLs resolvable SHOULD serve each schema at the path declared by its `$id`.

**Source-of-truth contract:** when a registry surfaces a schema at its `$id` URL, that surface MUST be a derived view of the schema as it appears inside the pack's **signed tarball**. The tarball is the canonical source; the mirrored URL is a courtesy for tools that auto-resolve `$id`. Consumers wanting cryptographic integrity of a schema MUST extract it from the tarball after verifying the tarball signature against the registry's signing keychain — the mirrored URL is NOT independently signed.

**Mirror lifecycle.** Schemas at `$id` URLs MUST be served only for packs that are present in the registry (have a published version with a tarball). Schemas for unpublished or yanked packs MUST NOT be exposed at `$id` URLs, even if the schema file exists in the pack's source repository; the mirror tracks registry state, not source-tree state.

**Implementer note.** A registry that derives the mirror from each tarball at publish time (extracting `schemas/*.json` into `/{name}/{version}/<schema>.json`) needs no special synchronization — the mirror cannot drift from the tarball because the tarball is its source. The reference registry's `build-index` script demonstrates this pattern.

### `GET /v1/packs/{name}/-/{version}.tgz`

Fetch the pack tarball. Response MUST include `Content-Type: application/tar+gzip`, `Content-Length`, and `ETag: "sha256-..."` matching the manifest's `tarballSha256`.

### `GET /v1/packs/{name}/-/{version}.json`

Fetch the pack manifest WITHOUT the runtime payload. Useful for introspection without triggering a full download.

### `GET /v1/packs/{name}/-/{version}.sig`

Fetch the detached Ed25519 signature blob over `pack.json` for this version. Pairs with the keychain endpoint (see `registry-operations.md` §"Signing keychain") to enable end-to-end signature verification: clients fetch the keychain, fetch the `.sig`, fetch the `.tgz`, then verify the signature against the keychain entries.

The endpoint MAY 302-redirect to a storage-backend signed URL rather than streaming the bytes directly — clients SHOULD follow redirects.

**Errors:**

- `404 signature_not_available` — version is missing, yanked, unsigned at publish time, OR the registry's storage backend is unwired. The four cases are intentionally indistinguishable: yanked tarballs MUST NOT serve their signatures (consumers shouldn't be verifying against known-bad packs); unsigned tarballs simply have no `.sig` blob to return; missing tarballs and storage outages are infrastructural states the consumer can't act on differently.
- `400 invalid_pack_name` / `400 invalid_version` — URL params don't match the spec's reverse-DNS / semver patterns.

### `PUT /v1/packs/{name}/-/{version}.tgz`

Publish a new version. Body is the gzipped tarball as `application/gzip` (or `application/x-gzip` / `application/octet-stream`). Auth via API key + `packs:publish` scope. Returns `201 Created` on first publish, `200 OK` on idempotent re-publish (identical content), or `409 Conflict` if `(name, version)` already exists with different content.

Headers:

- `Authorization: Bearer <api-key>`
- `X-Pack-Signing-Method: sigstore | manual | none`
- `X-Pack-Sha256: sha256-<base64>` (caller-asserted; server verifies)

Manifest extraction: the registry MUST extract `pack.json` from the tarball root and validate that `manifest.name` / `manifest.version` match the URL parameters before accepting the publish. The signature blob (if present in the tarball alongside `pack.json` per the `signing.signatureRef` path) is persisted as a sibling of the tarball and served via `GET /v1/packs/{name}/-/{version}.sig`.

**Errors:**

URL / scope:

- `400 invalid_pack_scope` — name doesn't match `core.*` / `vendor.*` / `community.*` / `private.*`. Public registries (`packs.openwop.dev`) MUST additionally refuse `private.*` and `local.*` per §Naming.
- `400 invalid_pack_name` — URL pack-name doesn't match the reverse-DNS pattern at all (e.g., single segment, uppercase scope).
- `400 invalid_version` — URL version doesn't match semver.

Body shape:

- `400 invalid_body` — body is not a Buffer / not octet-stream-shaped (caller sent JSON instead of tarball bytes).
- `400 invalid_body` — empty body.

Tarball extraction (`tarball_<code>` prefix groups these together for client-side switching):

- `400 tarball_gunzip_failed` — body isn't a valid gzip stream.
- `400 tarball_too_large` — decompressed bytes exceed the registry's cap (recommended default: 50 MB).
- `400 tarball_manifest_missing` — no `pack.json` at the tarball root.
- `400 tarball_manifest_too_large` — `pack.json` exceeds the registry's per-file cap (recommended default: 256 KB).
- `400 tarball_manifest_not_json` — `pack.json` isn't valid JSON.
- `400 tarball_entry_missing` — `manifest.runtime.entry` declares a path that isn't in the tarball.
- `400 tarball_entry_too_large` — entry source exceeds the registry's per-file cap (recommended default: 5 MB).
- `400 tarball_path_traversal` — a tarball entry's name contains `..` or otherwise attempts to escape the pack root.
- `400 tarball_tar_parse_failed` — tar parser couldn't read the stream past the gzip layer.

Manifest contents:

- `400 invalid_manifest` — `pack.json` parsed but failed schema validation (missing required fields, wrong shape). Detail message includes the failing path.
- `400 manifest_mismatch` — `manifest.name` and/or `manifest.version` differ from the URL params. Registries MAY emit this aggregate form or the granular pair (`manifest_name_mismatch` / `manifest_version_mismatch`); clients MUST handle either form.
- `400 pack_integrity_failure` — server-computed SHA-256 doesn't match `X-Pack-Sha256` (when the header is supplied).
- `400 unsupported_runtime` — `runtime.language` value not accepted by this registry.

Authorization + conflict:

- `403 forbidden` — caller lacks the namespace claim or `packs:publish` scope.
- `409 conflict` — version already published with different content (semver pinning is immutable per npm convention). Registries MAY emit a more descriptive `version_conflict` body code; either form is spec-allowed.

Idempotent re-publish: callers that PUT the SAME content (sha256-equal) for an existing `(name, version)` get `200 OK` with the existing record, NOT a conflict. This lets retries and tooling-driven re-uploads succeed cleanly.

### `DELETE /v1/packs/{name}/-/{version}`

Unpublish — registries SHOULD refuse this for versions older than 72 hours (npm's left-pad lesson). Auth via API key + `packs:publish` scope.

**Errors:**

- `400 unpublish_window_expired` — version is older than the registry's unpublish window (default 72h). Use the yank flow instead (`POST /v1/packs/{name}/-/{version}/yank`) for security incidents.
- `403 forbidden` — caller lacks `packs:publish` scope.
- `404 not_found` — version doesn't exist.

### `GET /v1/packs/-/search?q=<term>`

Full-text search across name + description + keywords. Returns paginated results.

### Test-mode registry namespace

Per [RFC 0025](../../RFCS/0025-test-mode-registry-namespace.md), hosts MAY expose an optional `/v1/packs-test/*` mirror surface that mirrors the production `PUT` / `GET` / `DELETE` / `.sig` endpoints against an **isolated** catalog. This lets the conformance suite exercise the 19-code publish error catalog above without `packs:publish` scope on the real registry.

**Capability gate.** A host advertises the mirror via `capabilities.packs.testMode.supported: true` (see `capabilities.schema.json` §`packs.testMode`). When absent or `false`, the 26 conformance scenarios in `pack-registry-publish.test.ts` soft-skip; when `true`, every scenario asserts against the test namespace instead of the production one.

**Mirrored endpoints.** The following paths MUST behave identically to their `/v1/packs/*` counterparts — same request envelopes, response shapes, status codes, and error code vocabulary:

| Test endpoint                               | Mirror of                              |
| ------------------------------------------- | -------------------------------------- |
| `PUT /v1/packs-test/{name}/-/{version}.tgz` | `PUT /v1/packs/{name}/-/{version}.tgz` |
| `GET /v1/packs-test/{name}/-/{version}.tgz` | `GET /v1/packs/{name}/-/{version}.tgz` |
| `DELETE /v1/packs-test/{name}/-/{version}`  | `DELETE /v1/packs/{name}/-/{version}`  |
| `GET /v1/packs-test/{name}/-/{version}.sig` | `GET /v1/packs/{name}/-/{version}.sig` |

All 19 publish error codes documented in `PUT /v1/packs/{name}/-/{version}.tgz` above (`invalid_pack_scope`, `invalid_pack_name`, `invalid_version`, `invalid_body`, the eight `tarball_*` codes, `invalid_manifest`, `manifest_mismatch` (or granular pair), `pack_integrity_failure`, `unsupported_runtime`, `forbidden`, `conflict`, `unpublish_window_expired`) MUST be surfaced verbatim. Scenarios authored against the test namespace prove the production-namespace contract.

**Isolation guarantees (RFC 0025 §C).** A host advertising `packs.testMode.supported: true` MUST:

1. Persist every test-namespace pack to a catalog distinct from the production catalog. A pack PUT'd to the test namespace MUST NOT appear in the corresponding production-namespace listing.
2. Refuse test-namespace traffic when the implementation's test-mode env-gate is unset (the env-gate name is implementation-defined; conformance only verifies the runtime behavior). The host boot log SHOULD warn when the surface is exposed.
3. NOT serve the test-namespace catalog from any production discovery endpoint (`GET /v1/packs`, `GET /v1/packs/{name}`, `GET /v1/packs/-/search`). Test-catalog packs MUST NOT appear in production registry listings.
4. Honor `catalogResetEndpoint` when advertised — calling it MUST clear the entire test catalog (the conformance suite's teardown hook).

**Scope acceptance.** `packs.testMode.scopes` declares which namespace scopes the test catalog accepts. Public test catalogs SHOULD refuse `private` and `local` (matching the production rule for `packs.openwop.dev`); private dev catalogs MAY accept all five. Hosts MAY omit `scopes` to default to the same acceptance set as the production namespace they mirror.

**Implementer note (non-normative).** A minimal implementation uses an in-memory `Map<(name, version), { tarball, sha256, signature? }>` env-gated on a single boolean. The validation pipeline runs checks in order (URL → body → tarball-extraction → manifest → integrity → auth/conflict); first-failing-check wins, matching the production publish handler's check order.

### Optional registry endpoints

Two additional `GET` surfaces are defined for hosts that expose a public pack-discovery layer:

| Endpoint               | Purpose                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/packs`        | Top-level listing of every pack the host serves. Response shape mirrors `GET /v1/packs/-/catalog` (an array of `{name, latest, description, ...}` summaries).                             |
| `GET /v1/packs/export` | Exported `AgentManifest` projection of the host's installed agents (per pack). Response: `{manifests: [{agentId, modelClass, sourceManifestId?, ...}]}` per `agent-manifest.schema.json`. |

Both endpoints are **OPTIONAL**. Hosts where the pack catalog is server-internal infrastructure (no public discovery surface) MAY decline to implement them.

#### Non-support signaling

Hosts that don't expose either endpoint MUST signal the choice with `404 Not Found` and a structured error body:

```json
{ "error": "not_implemented", "message": "..." }
```

`501 Not Implemented` is also accepted for the same purpose.

The two-status acceptance lets hosts pick between (a) routing the path to a generic 404 handler and (b) implementing an explicit "this endpoint exists in the spec but is not surfaced here" stub. Either is conformant.

The conformance suite's `agentPackInstall` and `agentPackExport` scenarios consume this signal to scope themselves: a 404/501 on the listing/export probe is treated as a spec-allowed skip, not a failure. Hosts that DO implement the endpoint MUST return 200 with the documented response shape.

---

## Trust model

A pack's trustworthiness is the consumer's call. The spec defines the wire shapes; deployment policy decides what to actually load.

An engine implementation SHOULD support a layered policy:

1. **Allowlist mode** — only load packs from a configured list (no registry calls).
2. **Pinned mode** — load any pack whose `(name, version, integrity)` matches an entry in the workflow definition's `packs` map.
3. **Verified mode** — load packs whose signing verification succeeds; refuse unsigned.
4. **Open mode** — load any pack the workflow references (development / sandbox only).

A registry SHOULD record provenance: who published which version when, and from what build environment. Consumers can audit before adopting a vendor's pack.

---

## Engine integration

An OpenWOP-compliant engine MUST:

1. Resolve all packs declared in a workflow's `packs` map at workflow-register time, before executing any nodes.
2. Verify integrity (`tarballSha256`) and signature (when `signing` is present).
3. Surface load failures as `400 pack_load_failure` on the workflow-register response — not as a node-runtime failure.

A workflow that references a typeId not provided by any registered pack MUST be rejected at workflow-register time, NOT at run time. Catching this at register is the difference between "this workflow is broken" (engineer can fix) and "this run is broken" (user sees runtime failure).

---

## Deployment channels

> Additive v1.x extension (RFC 0082). Applies only to hosts advertising `capabilities.agents.deployment.supported: true`.

The registry publishes **discrete semver tags** — which version of a pack (and its `agents[]`) _exists_. A **deployment channel** (`stable` / `canary` / the reserved `latest`) is a distinct, host-runtime concern — which version _serves_. The two MUST NOT be conflated: a published version may be `staged`, `paused`, or `rolled-back` and therefore not serve, and "latest published" is not "current production". A channel is a named pointer, resolved per-run and pinned as a recorded fact (`version-negotiation.md` §"Channel resolution + replay"), into the host's per-(agentId, version) deployment records. The deployment lifecycle, the channel→version resolution, the canary split, and the promotion contract are normative in [`agent-deployment.md`](./agent-deployment.md); the registry surface here is unchanged.

---

## Open spec gaps

| #       | Gap                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| ~~NP1~~ | ~~WASM ABI for `language: wasm` packs~~ — closed by [RFC 0008 — WASM ABI v1](../../RFCS/0008-wasm-abi.md) (`Accepted`). See §"WASM runtime" above.                                                                                                                                                                                                                                                                   | closed    |
| ~~NP2~~ | ~~Pack-level `dependencies` resolution (transitive packs) — currently underspecified.~~ — closed 2026-05-15 (PACK-3) by §"Transitive dependency resolution" above (5-step normative algorithm + override-pinning + resolver-determinism rules + new `pack_dependency_conflict` and `pack_dependency_cycle` error codes; `pack-lockfile.schema.json` extended with `overrides` map).                                  | ✅ closed |
| ~~NP3~~ | ~~Mirror / federation between registries (npm-style upstream-fallback).~~ — closed 2026-05-15 (PACK-4) by `registry-operations.md` §"Registry mirror + federation" (workspace `fallbackRegistries[]` ordering, per-registry trust roots, no-transitive-trust rule, offline-mode behavior, 2 new error codes `pack_registry_unreachable` + `pack_namespace_unauthorized`, `capabilities.packRegistry` advertisement). | ✅ closed |
| ~~NP4~~ | ~~Pack deprecation flow~~ — closed by `registry-operations.md` §"Deprecation flow" (2026-04-29).                                                                                                                                                                                                                                                                                                                     | ✅ closed |
| ~~NP5~~ | ~~Signing key rotation~~ — closed by `registry-operations.md` §"Signing-key rotation flow" (2026-04-29).                                                                                                                                                                                                                                                                                                             | ✅ closed |

## References

- `auth.md` — the `packs:publish` scope used by the publish endpoint.
- `rest-endpoints.md` — error envelope shape.
- `version-negotiation.md` — `engines.openwop` semver range semantics.
- `schemas/node-pack-manifest.schema.json` — canonical manifest JSON Schema.
- npm registry API: <https://docs.npmjs.com/cli/v10/configuring-npm/package-json> (idiom source — not a normative dependency).
- Sigstore: <https://www.sigstore.dev/> (signing reference).
- Reference registry: planned at `https://packs.openwop.dev/`.
