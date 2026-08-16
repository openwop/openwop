# OpenWOP Spec v1 — A2A Integration

> **Status: Stable · v1.2 (2026-08-16 — RFC 0152 A2A 1.0 versioned composition landed as §"A2A 1.0 versioned composition"; the pre-existing body is the `a2a-0.3-legacy` profile).** Worked example of how OpenWOP and the Agent2Agent Protocol (A2A) compose. The composition pattern is non-normative; the state-projection rules in §"State projection" are normative for any host that opts into A2A composition (14 RFC 2119 keywords). Pinned to A2A v1 as published at `https://a2a-protocol.org/latest/specification/`. Graduated DRAFT → FINAL via RFC 0006. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## TL;DR

**openwop is not in the agent-to-agent message-exchange business.** A2A is. The two protocols compose along orthogonal axes:

- **A2A** standardizes how independent agents discover each other (Agent Cards), exchange Messages and Tasks, and deliver streamed/pushed updates between hosts.
- **openwop** standardizes what happens _inside_ an agent — how a multi-step workflow is declared, run, suspended at HITL gates, replayed, and observed.

An OpenWOP-compliant host can expose itself as an A2A agent with each Workflow advertised as an A2A `AgentSkill`. Each OpenWOP run becomes an A2A `Task`. The two are **deliberately not** redundant: A2A's Task is intentionally an opaque box from the caller's perspective; OpenWOP gives that box internal structure for the host that runs it.

```text
[A2A client] ── sends Message ──> [OpenWOP host (A2A agent)]
                                    │  AgentSkill = openwop Workflow
                                    │  Message creates a Task
                                    ▼
                                  [openwop run] ── normal lifecycle ──>
                                    │  events → A2A status updates
                                    │  interrupts → Task state INPUT_REQUIRED / AUTH_REQUIRED
                                    │  artifacts → A2A Artifacts
                                    │  terminal → Task COMPLETED/FAILED/CANCELED
                                    ▼
                                  [Task complete]
                                    │
                                  ◄───── result ────────
```

---

## Why this composition

A2A and openwop solve adjacent problems with no functional overlap:

| Layer                                       | Owner   | Concerns                                                                                         |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| Inter-agent discovery + message exchange    | A2A     | AgentCard, signed identity, Skill catalog, transport binding (REST/JSON-RPC/gRPC), push delivery |
| Workflow execution + state inside one agent | openwop | Run lifecycle, event log, interrupts, replay, observability, conformance                         |

A2A's spec deliberately treats the agent's internal execution as opaque — that's the whole point of the abstraction. openwop fills that opacity for hosts that want their internals to be portable, conformance-tested, and replay-debuggable.

You don't have to use both. A2A-only agents work fine without openwop. openwop-only hosts work fine without A2A. The composition is for hosts that want **both** inter-agent interop **and** internal-workflow portability.

---

## State projection: OpenWOP run.status ↔ A2A TaskState

An OpenWOP host that exposes itself via A2A projects each run's `run.status` to A2A's `TaskState`. The mapping is not 1:1 — three drift points are documented below.

openwop `run.status` enum (per `schemas/run-snapshot.schema.json`):
`pending | running | paused | waiting-approval | waiting-input | completed | failed | cancelled`

A2A `TaskState` enum (per `a2a.proto` lines 187–208, 9 values incl. `UNSPECIFIED`):
`UNSPECIFIED | SUBMITTED | WORKING | INPUT_REQUIRED | AUTH_REQUIRED | COMPLETED | FAILED | CANCELED | REJECTED`

> **Spelling drift to remember:** openwop uses British `cancelled` (two `l`s). A2A uses American `CANCELED`/`canceled` (one `l`). Hosts that project both ways MUST handle both spellings; this is a wire-format reality, not a bug to fix.

### OpenWOP → A2A (forward projection)

| openwop `run.status` | A2A `TaskState`  | Notes                                                                                                                                                                                                                                                             |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`            | `SUBMITTED`      | Clean. Run accepted but not yet executing.                                                                                                                                                                                                                        |
| `running`            | `WORKING`        | Clean.                                                                                                                                                                                                                                                            |
| `paused`             | `WORKING` ⚠      | **Drift point #1.** A2A has no manual-pause concept. OpenWOP hosts SHOULD project `paused` as `WORKING` and surface the pause condition via a Task message or `metadata` field. Hosts MAY use a vendor extension to carry `paused` literally.                     |
| `waiting-approval`   | `INPUT_REQUIRED` | Approval-gate suspension. OpenWOP hosts SHOULD set `Task.metadata` with the approval shape (5-action vocabulary per `interrupt.md`) so A2A clients can render the right UI.                                                                                       |
| `waiting-input`      | `INPUT_REQUIRED` | Clarification suspension. Same projection as `waiting-approval`. **Drift point #2 (lossy):** A2A clients receive the same `INPUT_REQUIRED` for both approval and clarification interrupts — the distinction MUST come from `Task.metadata` or a vendor extension. |
| `completed`          | `COMPLETED`      | Clean.                                                                                                                                                                                                                                                            |
| `failed`             | `FAILED`         | Clean.                                                                                                                                                                                                                                                            |
| `cancelled`          | `CANCELED`       | Clean modulo spelling.                                                                                                                                                                                                                                            |

### A2A → OpenWOP (reverse projection — when OpenWOP host _consumes_ an A2A agent)

An OpenWOP host that calls out to an external A2A agent inside a workflow node (`a2a.invoke` or similar host-extension node) projects A2A Task states back into openwop run state for the caller's run. This is the harder direction:

| A2A `TaskState`  | openwop `run.status` projection | Notes                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNSPECIFIED`    | `pending`                       | Best-effort. SHOULD log a warning — the called agent isn't supplying a defined state.                                                                                                                                                 |
| `SUBMITTED`      | `pending`                       | Clean.                                                                                                                                                                                                                                |
| `WORKING`        | `running`                       | Clean.                                                                                                                                                                                                                                |
| `INPUT_REQUIRED` | `waiting-input`                 | The called A2A agent is asking the _caller_ for input. OpenWOP host SHOULD lift this into the calling run as a `clarification` interrupt with payload from the A2A `Task.message`.                                                    |
| `AUTH_REQUIRED`  | — ⚠                             | **Drift point #3.** openwop v1 has no `auth-required` interrupt kind. Hosts SHOULD project as `waiting-input` with `metadata.subkind: 'auth'` until a future v1.x adds a normative `auth` interrupt. Filed as candidate v1.x work.    |
| `COMPLETED`      | `completed`                     | Clean.                                                                                                                                                                                                                                |
| `FAILED`         | `failed`                        | Clean.                                                                                                                                                                                                                                |
| `CANCELED`       | `cancelled`                     | Clean modulo spelling.                                                                                                                                                                                                                |
| `REJECTED`       | `failed` ⚠                      | **Drift point #4 (lossy).** A2A `REJECTED` means the agent declined to execute the request (e.g., capability mismatch, policy denial). openwop has no `rejected` terminal — projects to `failed` with `reason: 'rejected_by_remote'`. |

---

## Concrete example: OpenWOP host as A2A agent

An OpenWOP host advertises itself via an Agent Card. Each registered Workflow becomes a Skill. Incoming A2A Messages create or extend Tasks; under the hood, each Task is backed by an OpenWOP run.

### 1. AgentCard advertisement

The OpenWOP host serves an Agent Card at the well-known A2A path. Each `AgentSkill` corresponds to an OpenWOP `WorkflowDefinition` that the host hosts:

```jsonc
{
  "name": "Example openwop-backed agent",
  "description": "A workflow orchestrator exposed as an A2A agent.",
  "version": "1.4.2",
  "supported_interfaces": [{
    "url": "https://example.com/a2a/v1",
    "protocol_binding": "JSONRPC",
    "protocol_version": "1"
  }],
  "capabilities": {
    "streaming": true,
    "push_notifications": true
  },
  "default_input_modes": ["text"],
  "default_output_modes": ["text", "json"],
  "skills": [
    {
      "id": "campaign-brief",
      "name": "Generate marketing campaign brief",
      "description": "Multi-phase brief generation with HITL approval at phases 4 and 8.",
      "tags": ["marketing", "approval-gated"],
      "examples": ["Create a brief for a B2B SaaS launch targeting CFOs."]
    }
  ],
  "security_schemes": { /* per A2A SecurityScheme oneof */ },
  "signatures": [{ /* RFC 7515 JWS — signs the AgentCard */ }]
}
```

The A2A client uses the AgentCard to discover `campaign-brief` and any other workflows the host exposes. The mapping is `AgentSkill.id` ↔ openwop `Workflow.id`. A host MAY filter which workflows it advertises (e.g., only those marked `public: true`).

### 2. Skill invocation = OpenWOP run start

The A2A client sends a Message naming the skill:

```jsonc
{
  "message_id": "msg_001",
  "role": "USER",
  "parts": [{ "text": "Brief for Acme launch, Q3 2026, B2B SaaS, CFO buyer." }],
  "context_id": "ctx_abc"
}
```

The OpenWOP host's A2A handler calls `POST /v1/runs` against its own openwop API surface (or skips the HTTP hop and invokes the engine directly — implementation detail):

```jsonc
{
  "workflowId": "campaign-brief",
  "inputs": { "prompt": "Brief for Acme launch, Q3 2026, B2B SaaS, CFO buyer." },
  "tags": ["a2a:msg_001", "a2a:ctx_abc"]
}
```

The returned `runId` becomes the A2A `Task.id`. The openwop run's lifecycle drives the A2A Task's state.

### 3. Status updates flow A2A-direction

As the openwop run emits events, the A2A handler projects them to A2A status updates. SSE / push delivery follows A2A's transport rules; the `TaskStatusUpdateEvent` body is composed from the openwop run snapshot:

| openwop event                        | A2A delivery                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `run.started`                        | `TaskStatusUpdateEvent { status: WORKING }`                                                                         |
| `node.completed` (artifact produced) | `TaskArtifactUpdateEvent { artifact: <projected from openwop artifact> }`                                           |
| `approval.requested`                 | `TaskStatusUpdateEvent { status: INPUT_REQUIRED, metadata: { openwop.interrupt: { kind: 'approval', ... } } }`      |
| `clarification.requested`            | `TaskStatusUpdateEvent { status: INPUT_REQUIRED, metadata: { openwop.interrupt: { kind: 'clarification', ... } } }` |
| `run.completed`                      | `TaskStatusUpdateEvent { status: COMPLETED }` + final artifact list                                                 |
| `run.failed`                         | `TaskStatusUpdateEvent { status: FAILED, metadata: { openwop.error: { code, message } } }`                          |
| `run.cancelled`                      | `TaskStatusUpdateEvent { status: CANCELED }`                                                                        |

The `metadata.openwop.*` namespace is a host extension under A2A — A2A clients that don't understand openwop's interrupt vocabulary can still render `INPUT_REQUIRED`; clients that _do_ understand it get the richer payload.

### 4. Resume = A2A Message reply

When the run hits `waiting-approval`, the A2A Task is in `INPUT_REQUIRED`. The A2A client resumes by sending a Message back into the same Task:

```jsonc
{
  "message_id": "msg_002",
  "task_id": "<runId>",
  "role": "USER",
  "parts": [{ "data": { "approve": true, "feedback": "looks good" } }]
}
```

The OpenWOP host translates this to the engine's resume call (per `interrupt.md` — 5-action approval vocabulary). The run continues; the next status update flows back to the A2A client.

---

## Trust boundary

When an OpenWOP host invokes an external A2A agent inside a workflow node, the same trust posture applies as MCP tool calls (per `mcp-integration.md` §"Trust boundary"):

- A2A agent responses MUST be wrapped in `<UNTRUSTED agent="...">` markers if fed back into LLM nodes (`prompt-injection-mcp-marker` invariant generalizes to A2A — same threat model).
- A2A Task results MUST NOT directly advance HITL approval gates (`prompt-injection-mcp-no-approval` invariant generalizes — an external agent cannot vote on the calling host's approvals).
- A2A AgentCard signatures (RFC 7515 JWS) SHOULD be verified before invoking; unsigned cards are MAY accept but SHOULD log a warning.

In the reverse direction (OpenWOP host as A2A agent), the host's existing scope/auth/redaction harness applies to all incoming A2A Messages exactly as it does to incoming openwop REST requests — there is no separate A2A-specific trust posture. The A2A `SecurityScheme` advertised in the AgentCard maps to the OpenWOP host's existing API key / OAuth / mTLS configuration.

---

## Purpose-propagation labels (RFC 0128)

> **Status: additive (2026-07-06, [RFC 0128](../../RFCS/0128-purpose-propagation-permitted-use-labels.md) `Active`).**

A sender MAY attach a **`metadata.openwop.permittedPurposes`** label (`string[]` of opaque
purpose strings) to an A2A Message whose parts carry subject data — the A2A leg of the RFC 0128
cross-host permitted-use contract (the trigger leg rides `TriggerEvent.permittedPurposes`,
`trigger-event.schema.json`). Semantics:

- **Absent ⇒ unlabelled** (no constraint asserted). **`[]` ⇒ no onward use permitted** — these
  are NOT the same.
- A host advertising `capabilities.purposePropagation` **MUST** re-emit the label on any onward
  OpenWOP-envelope hop of the same data (a further A2A forward, a trigger/sync event to an
  OpenWOP peer), **MAY** narrow it, **MUST NOT** widen it; a derived output combining labelled
  inputs **MUST NOT** carry a purpose absent from any contributing labelled input. It **MUST NOT**
  forward `[]`-labelled data onward at all. Full rules: RFC 0128 §3.
- The label carries purpose *categories* only — never subject identifiers or consent records; the
  strings are opaque and map to the receiving host's local purpose vocabulary.
- The capability advertises label **propagation** only. Whether the receiver's own internal use
  honors the label is declared intent under its local governance (RFC 0128 §4) — deliberately not
  a wire promise. A host that does not advertise the capability treats the label as unknown
  metadata (additive; no breakage).

This is the first field in the `metadata.openwop.*` namespace with a **normative** shape — see
the amended note below.

## What OpenWOP does NOT specify about A2A

- **A2A wire format details.** A2A is canonically defined at `https://a2a-protocol.org/latest/specification/` and `https://github.com/a2aproject/A2A`; openwop doesn't re-specify it.
- **The `metadata.openwop.*` extension shape** — with one exception: `metadata.openwop.permittedPurposes` is normative per RFC 0128 (§"Purpose-propagation labels" above). The rest of the namespace stays host-implementation choice; a future spec annex MAY codify further fields if multiple hosts converge on a pattern.
- **Push notification HMAC details.** A2A v1 spec §4.3.3 (prose-only) defines the push delivery contract; openwop defers to it. openwop's own webhook spec (`webhooks.md`) is independent.
- **AgentCard signing.** openwop MAY require signed cards in `a2a.invoke` node config (host-specific); it doesn't mandate the signing algorithm.
- **Error taxonomy mapping — inside the A2A layer.** A2A `VersionNotSupportedError` and similar protocol-level errors stay inside the A2A layer and don't surface as openwop `RunEvent` errors. **Narrowed by RFC 0152 §B/§D.7:** when such a failure crosses an OpenWOP *boundary* it is projected through the canonical error envelope (`interop_version_unsupported` and the D.7 table) — the layer keeps its taxonomy, the boundary keeps its envelope. openwop errors stay inside the run; they project to A2A `FAILED` with `metadata.openwop.error`.
- **AUTH_REQUIRED interrupt.** openwop v1 has no native `auth-required` interrupt kind. Hosts that consume A2A agents in `AUTH_REQUIRED` state SHOULD project to `waiting-input` with `metadata.subkind: 'auth'` until a future v1.x adds it.

---

## Conformance + interop

An OpenWOP host that supports A2A composition advertises the capability via `/.well-known/openwop`. A2A-bridge scenarios are NOT included in the v1.0 conformance baseline — adding them is filed as a candidate v1.x work item. The current shape probe (analogous to `mcp-discoverability.test.ts`) would assert that any advertised A2A capability follows a published shape (`{supported: boolean, agentCardUrl: string}` is one candidate).

`a2a-task-roundtrip.test.ts` lands in the suite with three subtests:

- **AgentCard + task lifecycle** — fetches `/.well-known/agent-card.json` (A2A 0.3 well-known path), asserts `protocolVersion` + `skills[]` shape, then sends `message/send` over JSON-RPC (endpoint discovered via `card.additionalInterfaces` or `card.url`) and polls `tasks/get` through SUBMITTED → WORKING → COMPLETED. Accepts both Task and Message envelopes from `message/send` per A2A 0.3 spec. Runs against either the in-process synthetic peer or a real reference peer (see env-var modes below).
- **Drift point #3** — fake-peer-only: forces the peer to `AUTH_REQUIRED`, asserts the host projects this to `waiting-input` per §"State projection (reverse)".
- **Drift point #4** — fake-peer-only: forces the peer to `REJECTED`, asserts the host projects this to terminal `failed` with `reason: 'rejected_by_remote'`.

Two modes, controlled by env vars:

- **Synthetic peer** (`OPENWOP_A2A_FAKE_PEER=true`): boots an in-process minimal A2A peer (the `a2a-fake-peer.ts` library at `conformance/src/lib/`). Exposes a state-forcing API so the drift-point subtests can deterministically reproduce AUTH_REQUIRED + REJECTED.
- **Real reference peer** (`OPENWOP_A2A_REAL_PEER_URL=<base-url>`): points the AgentCard + task-lifecycle probe at a real A2A reference peer. Assertions stay shape-only — a real peer's task transitions on its own schedule, not on a state-forcing API. Drift-point subtests soft-skip in this mode.

The real-impl path is the **Phase 3 T3.4 interop-evidence** for `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`. To collect it: run a reference A2A peer (e.g., a `@a2a-js/sdk` server) on a local port, set `OPENWOP_A2A_REAL_PEER_URL=http://localhost:<port>`, run the scenario. The test logs the skill name + response envelope kind (`task` or `message`) so the interop evidence is visible in the CI output. First real-impl interop evidence landed 2026-05-12 against `@a2a-js/sdk@0.3.13` — see `INTEROP-MATRIX.md` §"Composition partners".

> **Wire-shape spelling drift to remember:** the openwop spec references the A2A `TaskState` enum in the UPPERCASE form from `a2a.proto` (`SUBMITTED`, `WORKING`, `INPUT_REQUIRED`, `AUTH_REQUIRED`, `COMPLETED`, `CANCELED`, `FAILED`, `REJECTED`). The A2A 0.3 JSON-RPC wire form uses the lowercase + hyphenated variants (`submitted`, `working`, `input-required`, `auth-required`, `completed`, `canceled`, `failed`, `rejected`). Hosts and probes that speak JSON-RPC MUST emit + accept the lowercase-hyphen form on the wire; documentation and gRPC transports keep the UPPERCASE form.

---

## Operational mapping table (STD-3 deeper coverage, 2026-05-15)

The earlier sections cover happy-path projection. Production deployments hit edge cases the roundtrip smoke doesn't exercise. The table below documents the recommended projection for each.

| Operational concern                                    | A2A side                                                              | OpenWOP side                                                                                                          | Recommended mapping                                                                                                                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Failure on the OpenWOP side mid-run**                | Task transitions to `failed`.                                         | Run reaches terminal `failed`; `RunSnapshot.error` carries the canonical `RunErrorCode`.                              | The A2A bridge MUST surface `Task.error.message` derived from `RunSnapshot.error.message`. Carry the typed `code` in `Task.metadata.openwop.errorCode` for clients that recognize it.                                                   |
| **OpenWOP HITL interrupt opens**                       | Task transitions to `input-required`.                                 | Run status flips to `waiting-approval` / `waiting-input` / `waiting-clarification`.                                   | Project the interrupt's signed token into `Task.metadata.openwop.interruptToken`. The A2A client invokes `POST /v1/interrupts/{token}` directly OR via an `a2a:Message` whose `metadata.openwop.action` carries the resolution payload. |
| **OpenWOP cancellation** (`POST /v1/runs/{id}/cancel`) | The A2A bridge MUST issue an A2A cancel toward the peer.              | Run reaches `cancelled` with `reason: 'cross_protocol_cancel'`.                                                       | Cancellation flows bidirectionally; whichever side initiates wins. Document the precedence in your A2A bridge's deployment notes if both sides can initiate.                                                                            |
| **A2A peer goes unreachable during run**               | A2A transport error (timeout / 5xx).                                  | Bridge node SHOULD retry per its retry policy; on exhaustion, emit `node.failed` with `code: 'external_call_failed'`. | Don't transition the run to `failed` solely on transport unreachability — let `core.dispatch` retry semantics apply per RFC 0007.                                                                                                       |
| **Concurrent runs against the same A2A peer**          | A2A peer MAY serialize OR parallelize per its own AgentCard.          | OpenWOP run lifecycle is independent per `runId`.                                                                     | Each OpenWOP run gets its own A2A Task; correlation via `Task.metadata.openwop.runId`. The A2A bridge node MUST NOT assume serialization.                                                                                               |
| **Identity propagation under multi-hop**               | A2A doesn't normate identity propagation beyond AgentCard.            | OpenWOP propagates `RunSnapshot.runOrchestrator.agentId` for replay determinism.                                      | When OpenWOP dispatches to A2A, the bridge SHOULD include the calling AgentRef in `Message.metadata.openwop.callerAgentId` so downstream peers can attribute. NEVER include BYOK credential material.                                   |
| **Time-skew between A2A and OpenWOP clocks**           | A2A `Task.createdAt` is the peer's clock.                             | OpenWOP `Run.createdAt` is the OpenWOP host's clock.                                                                  | Bridge nodes SHOULD record both timestamps; observers MUST NOT assume monotonicity across the boundary.                                                                                                                                 |
| **Backpressure on the A2A peer**                       | A2A 503 / `unavailable` state.                                        | OpenWOP run hits transport-layer `unavailable`.                                                                       | The bridge node SHOULD project peer-backpressure to a transient `external_call_failed`; `core.dispatch` retry semantics apply. Don't bubble backpressure as run-level `failed`.                                                         |
| **Trust-boundary on A2A messages**                     | A2A messages from peers are external.                                 | OpenWOP's `mcpClient.trustBoundary: 'untrusted'` discipline applies analogously.                                      | Any A2A message content reaching OpenWOP run state MUST be tagged `contentTrust: 'untrusted'` before downstream LLM nodes consume it, matching `threat-model-prompt-injection.md` §"UNTRUSTED" semantics.                               |
| **Replay determinism across the boundary**             | A2A peers MAY emit different responses on replay (the peer's choice). | OpenWOP replay caches per RFC 0006 §C apply.                                                                          | The bridge node MUST cache the A2A peer's response in the OpenWOP event-log payload; replay-time A2A calls MUST be replaced by the cached response, not re-issued.                                                                      |

These mappings stay non-normative for v1.x — A2A's spec is itself evolving. Hosts that codify deviations from this table SHOULD document them in their own integration notes.

## Async / durable Tasks (RFC 0100)

> **Status: additive, normative for any host that advertises `capabilities.a2a.durableTasks` (2026-06-14, [RFC 0100](../../RFCS/0100-async-durable-a2a-tasks.md) `Active`).** The synchronous `message/send` → poll `tasks/get` round-trip above is unchanged. This section closes the two Future-work items below — the `a2a` capability slot and the `metadata.openwop.*` interrupt-kind shape — and makes the §"State projection" mapping durable + resumable so a host can run a cross-host handoff asynchronously. The run-status → TaskState mapping is **persisted, not changed**.

### The `a2a` capability slot

Discovery gains a `capabilities.a2a` block: `{ supported, agentCardUrl, streaming?, pushNotifications?, durableTasks? }`. `supported: true` with `durableTasks` absent/`false` ⇒ the host exposes A2A but only the **synchronous** round-trip already specified (today's behavior — no regression). `durableTasks: true` is the opt-in for the contracts below.

### The durable Task projection record (`A2ATaskState`)

When `durableTasks: true`, the host MUST persist an **`A2ATaskState`** (`a2a-task-state.schema.json`) per backing run, durable for the run's whole lifecycle (surviving caller disconnect, host restart within retention, and HITL pauses). It is the persisted form of the §"State projection (forward)" mapping — `taskId` MUST equal the backing `runId`; `state` MUST be the A2A 0.3 lowercase-hyphen wire form per the spelling-drift note; `interruptKind` (present iff `state == 'input-required'`) durably disambiguates drift point #2 and is carried in `Task.metadata.openwop.interrupt.kind` (the codified `metadata.openwop.*` shape). The record MUST carry no run inputs/outputs/artifacts/credential material — artifacts project to A2A `Artifact`s over the A2A transport (§3), not into this record.

### `tasks/get` after disconnect + `tasks/resubscribe`

When `durableTasks: true`:

- **`tasks/get` MUST return live state after disconnect.** After `message/send` returns (or its stream drops), the caller MAY `tasks/get { id: taskId }` at any later time within the run's retention window; the host MUST return the current `A2ATaskState`-projected Task (the live `run.status`-derived `state`, including a paused-at-HITL `input-required`). The host MUST NOT require the caller to hold the original connection.
- **`tasks/resubscribe` MUST re-attach the update stream without re-sending.** When `streaming: true`, a caller that dropped the `message/stream` SSE MAY `tasks/resubscribe { id: taskId }` to re-attach to the `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent` stream (§3) from the current state forward. The host MUST NOT re-execute the run or re-accept the originating message on resubscribe; resubscribe is read-only re-attachment. Multiple observers MAY resubscribe concurrently (read-only, mirroring openwop's own SSE multi-observer model).
- **Resume across the boundary is unchanged.** An A2A Message reply into an `input-required` Task resolves the HITL interrupt exactly as §4 already specifies (the 5-action approval vocabulary). This section makes the *waiting* durable + re-attachable; it does not change resume.

### Push-notification config

When `pushNotifications: true`, a caller MAY register an A2A push config (`A2ATaskState.PushConfig`) for a Task; the host MUST:

- **Validate the push `url` through the RFC 0093 webhook-egress SSRF guard** before any delivery (no private/loopback/link-local target) — SECURITY invariant `a2a-push-egress-ssrf`.
- **Fire a push on each durable TaskState transition the caller subscribed to** — at minimum on the transitions to `input-required`, `completed`, `failed`, `canceled`. The push body is an A2A `TaskStatusUpdateEvent` (composed per §3); its HMAC/signing follows A2A §4.3.3 (openwop defers the HMAC details per §"What openwop does NOT specify" — unchanged).
- **Never include run-internal content** in the push beyond the projected Task state + the A2A artifact references (SR-1 / trust boundary — the same content-free projection as the persisted record).

### Trust boundary + replay (unchanged under async)

The §"Trust boundary" and §"Operational mapping table" rows hold under async unchanged: A2A messages reaching run state stay `contentTrust: 'untrusted'`; an external A2A agent's result MUST NOT advance a HITL gate; a bridge node MUST cache an external A2A peer's response in the event-log payload and replace it from cache at replay (RFC 0006 §C). Async adds no new trust surface — a durable Task is the same projection, persisted; `tasks/resubscribe` is a read-only observer; a push is an outbound projection, SSRF-guarded.

## A2A 1.0 versioned composition (RFC 0152)

> **Status: normative for any host that advertises `capabilities.a2a.protocolVersions` (2026-08-16, [RFC 0152](../../RFCS/0152-a2a-1-0-versioned-composition.md) `Accepted`).** Everything above this heading was written against **A2A 0.3** (JSON-RPC lowercase-hyphen wire, `kind` discriminators, `message/send`-style method names, top-level `url`/`protocolVersion` on the Agent Card) and is, from this date, the definition of the **`a2a-0.3-legacy`** profile. This section defines the **`a2a-1.0`** profile: what a host that advertises `1.0` in `protocolVersions` MUST do, field by field, so an engineer can implement the 1.0 codec from this document alone. Pinned to **A2A 1.0.0** as published 2026-03-12 — the canonical `specification/a2a.proto` at tag `v1.0.0` of `a2aproject/A2A` and `docs/specification.md` at the same tag; the [1.0 change list](https://a2a-protocol.org/latest/whats-new-v1/) is the upstream authority for what moved. Where this document restates an upstream field it uses the upstream's own name; where it maps one it says "→".

### §A — Discovery and profiles

`capabilities.a2a` (`capabilities.schema.json`) carries three RFC 0152 fields beside the RFC 0100 ones:

```json
"a2a": {
  "supported": true,
  "agentCardUrl": "https://host.example/.well-known/agent-card.json",
  "protocolVersions": ["1.0", "0.3"],
  "preferredVersion": "1.0",
  "profiles": ["a2a-1.0", "a2a-0.3-legacy"],
  "streaming": true, "pushNotifications": true, "durableTasks": true
}
```

- An A2A-capable host **MUST** advertise a non-empty `protocolVersions` and a `preferredVersion` present in it. `supported: true` without `protocolVersions` is deprecated: it says the host speaks *some* A2A and **cannot substantiate a current-A2A claim**.
- `profiles[]` names the composition profiles the host implements. **`a2a-1.0`** ⇒ this section in full. **`a2a-0.3-legacy`** ⇒ the 0.3 body of this document. A legacy-only host advertises `["a2a-0.3-legacy"]` and `protocolVersions: ["0.3"]`. **A profile implies its version, not the reverse:** a host **MUST NOT** list `a2a-X.Y` (or `a2a-X.Y-legacy`) in `profiles` unless `X.Y` is in `protocolVersions`; it **MAY** list a version in `protocolVersions` without claiming the matching profile — that says "I speak it" without saying "I meet this document's floor for it" (§C), and a consumer that needs the floor reads `profiles`.
- **Well-known path is unchanged in 1.0**: `/.well-known/agent-card.json` (A2A 1.0.0 §"Discovery"). `agentCardUrl` therefore serves both profiles; the version is discovered *inside* the card (§C), not from its path.
- **Legacy window (RFC 0152 UQ1, resolved for the date).** A2A 1.0.0 was published **2026-03-12**; the RFC's proposed 12-month window makes **2027-03-12** the date after which a host **SHOULD NOT** advertise `a2a-0.3-legacy` and after which a bare `supported: true` cannot appear in any interop claim. Removal of the 0.3 code path from the corpus is a v2 change or a separately justified upstream-security safety fix (RFC 0152 §Compatibility). The 0.3 *adopter inventory* (gap G1) is not resolved by picking a date and stays open.

### §B — Version negotiation

Normative for both directions; the outbound half is what `a2a-version-negotiation.test.ts` witnesses.

- **Sender.** Every A2A request a host originates **MUST** carry `A2A-Version: <Major.Minor>` (HTTP header; upstream also permits `?A2A-Version=` as a request parameter on the HTTP+JSON binding). The value **MUST** be one the host lists in `protocolVersions`, and by default the `preferredVersion`.
- **Receiver.** A host **MUST** process an inbound request under the semantics of the requested version. An absent header means **0.3** (upstream rule); a host whose `protocolVersions` does not include `0.3` **MUST** therefore refuse header-less requests exactly as it refuses any unsupported version. Unsupported version ⇒ upstream **`VersionNotSupportedError`** — JSON-RPC code `-32009`, gRPC `UNIMPLEMENTED`, HTTP+JSON `400`, `reason: "VERSION_NOT_SUPPORTED"`, and upstream's `supportedVersions[]` in the error detail.
- **No silent downgrade.** When the host is the *client* and the peer offers only a lower version than requested, a host **MUST NOT** proceed under the lower version while reporting the requested one. It **MUST** either fail closed or negotiate down *explicitly*: the wire header on every subsequent call to that peer **MUST** equal the version actually negotiated, and any OpenWOP-side record of the exchange (the `negotiatedVersion` field on the §22 seam; a node output; an audit row) **MUST** report that same value. For an **authenticated** request the default is fail-closed; a host **MAY** permit an explicit downgrade by policy, and a **policy-forbidden** downgrade **MUST** fail closed and **MUST** be audited content-free — the corpus has no dedicated negotiation event type, and this document does not mint one; a host advertising `capabilities.authorization` **SHOULD** record it as `authorization.decided { action: "a2a:negotiate", resource: <peer origin>, allowed: false, reason: "version-downgrade-forbidden" }` (RFC 0049; the payload is content-free by construction), and the dedicated event is listed as a gap below.
- **Projection through the OpenWOP boundary.** When a version failure crosses an OpenWOP boundary — the peer's `VersionNotSupportedError` reaching an OpenWOP caller, or the host's own refusal surfacing on an OpenWOP endpoint — it **MUST** be projected through the canonical error envelope (`error-envelope.schema.json`) as **`interop_version_unsupported`**, `retriable: false`, with `details.protocol: "a2a"`, `details.requested: "<Major.Minor>"`, and `details.supported: [...]` when known. A raw upstream body leaves the caller parsing a foreign protocol to learn its own request was rejected. This is the one place the earlier bullet in §"What OpenWOP does NOT specify" ("error taxonomy stays inside the A2A layer") is narrowed: inside the A2A layer the upstream error is authoritative; at the OpenWOP boundary the envelope is.

### §C — Agent Card and interface projection

The 1.0 Agent Card (`AgentCard` in `a2a.proto` v1.0.0) is a different shape from 0.3. The fields, with the OpenWOP source each **MUST** be derived from:

| A2A 1.0 `AgentCard` field | Required upstream | OpenWOP source of truth |
| --- | --- | --- |
| `name`, `description`, `version`, `documentationUrl?`, `iconUrl?` | name/description/version REQUIRED | Host identity; `version` is the host's own release identifier, **not** the A2A protocol version. |
| `supportedInterfaces[]` — `{ url, protocolBinding, protocolVersion, tenant? }` | REQUIRED, ≥1 | **Only interfaces the host actually serves.** `protocolBinding` ∈ `JSONRPC` \| `GRPC` \| `HTTP+JSON` (upstream binding names). The **set** of `supportedInterfaces[].protocolVersion` values **MUST** equal `capabilities.a2a.protocolVersions`, and the interface carrying `preferredVersion` **SHOULD** be listed first. Replaces 0.3's top-level `url` / `protocolVersion` / `preferredTransport` / `additionalInterfaces`, all removed in 1.0. |
| `provider { url, organization }` | optional | Host operator; **MUST NOT** name a different organization than the one operating the OpenWOP endpoint. |
| `capabilities { streaming?, pushNotifications?, extensions[], extendedAgentCard? }` | REQUIRED | `streaming` ⇔ `capabilities.a2a.streaming`; `pushNotifications` ⇔ `capabilities.a2a.pushNotifications`; `extendedAgentCard: true` iff the host serves `GetExtendedAgentCard`; `extensions[]` **MUST** list only extensions the host implements, and a host that lists none **MUST NOT** raise `ExtensionSupportRequiredError`. (0.3's `supportsAuthenticatedExtendedCard` moved here.) |
| `skills[]` — `{ id, name, description, tags[], examples?, inputModes?, outputModes?, securityRequirements? }` | REQUIRED | The **same workflow registry runtime routing uses**: one skill per invocable workflow, `skills[].id` = the workflow's stable identifier as the host routes it (`workflowId` or slug — pick one and keep it), `inputModes`/`outputModes` = the media types the workflow's input schema and outputs actually accept/produce. A skill absent from routing **MUST NOT** appear; a workflow the caller cannot invoke **MUST NOT** appear in the *extended* card for that caller (§E). |
| `securitySchemes{}`, `securityRequirements[]` | optional | The auth the endpoint **actually enforces** (RFC 0049/0050 profiles). Listing a scheme the endpoint does not check, or omitting one it does, is card/runtime drift. |
| `defaultInputModes[]`, `defaultOutputModes[]` | REQUIRED | Host defaults; **MUST** be a superset of every skill's modes unless the skill overrides. |
| `signatures[]` (`{ protected, signature, header? }`, JWS) | optional | A host **SHOULD** sign; a consuming host **SHOULD** verify before invoking and **MAY** refuse unsigned cards by policy (see §"Trust boundary"). |

Rules (RFC 0152 §C, invariant `a2a-card-runtime-consistent` — *named, not yet registered*; see §"Conformance"):

- The card and `capabilities.a2a` **MUST** be generated from the same source the runtime routes on. OpenWOP capability projection **MUST NOT** invent an interface absent from the card, and the card **MUST NOT** list an interface the host does not route.
- **Mandatory interface floor (RFC 0152 gap G4 / UQ3, decided):** a host claiming `a2a-1.0` **MUST** serve the **JSON-RPC binding** at 1.0 (`protocolBinding: "JSONRPC"`, method names per §D) and **MAY** additionally serve `HTTP+JSON` and/or `GRPC`. Rationale: continuity with the 0.3 composition and its interop evidence, the suite's fake peer, and not forcing a gRPC transport dependency onto every host. A host that serves 1.0 only over `HTTP+JSON` or only over `GRPC` **MUST NOT** claim the `a2a-1.0` profile; it **MAY** still list `1.0` in `protocolVersions` (§A), which is a truthful statement of what it speaks without a conformance claim attached.
- `supportedInterfaces[].tenant`: a host **MAY** publish tenant-scoped interfaces. The value is a *routing hint* for the peer; it **never** selects the tenant of record (§E).
- Extended card (`GetExtendedAgentCard`; HTTP+JSON `GET /extendedAgentCard`): served only when `capabilities.extendedAgentCard: true`; **MUST** be authorized at the OpenWOP boundary and **MUST NOT** disclose skills, interfaces, or security requirements the authenticated principal cannot use.

### §D — Task and event mapping (translation table)

Normative for the `a2a-1.0` profile. Field names are the upstream JSON (ProtoJSON, lowerCamelCase) spellings. "→" reads left-to-right for the stated direction. Anything not in these tables is **opaque**: it **MUST** round-trip where the upstream requires it and **MUST NOT** become authority, a prompt segment, a tool call, or a workflow variable without a declared mapping. The only other declared mappings in the corpus are `metadata.openwop.permittedPurposes` (RFC 0128, §"Purpose-propagation labels") and the `metadata.openwop.interrupt` carrier (RFC 0100).

**D.1 Operations.** 1.0 renamed every operation; the semantics map onto OpenWOP as follows (RFC 0100 durable-task semantics unchanged):

| A2A 1.0 operation (JSON-RPC method · HTTP+JSON path) | 0.3 name | OpenWOP |
| --- | --- | --- |
| `SendMessage` · `POST /message:send` | `message/send` | No `taskId` ⇒ `POST /v1/runs` for the workflow the `skill` resolves to. With `taskId` ⇒ see D.2 `taskId`. Blocking unless `configuration.returnImmediately: true`. |
| `SendStreamingMessage` · `POST /message:stream` (SSE) | `message/stream` | Same, with the run's event stream projected as `StreamResponse` (D.5). Requires `capabilities.a2a.streaming`. |
| `GetTask` · `GET /tasks/{id}` | `tasks/get` | `GET /v1/runs/{runId}` projected as `Task` (D.3). Live after disconnect when `durableTasks` (RFC 0100). |
| `ListTasks` · `GET /tasks?…` | *(new in 1.0)* | `GET /v1/runs` **scoped to the caller's tenant/workspace/principal**, filtered by `contextId`, `status` (via D.4), `statusTimestampAfter`; paginated (`pageSize`/`pageToken` → the host's run-list pagination); `historyLength`, `includeArtifacts` honoured. Cross-tenant runs **MUST NOT** appear (§E). |
| `CancelTask` · `POST /tasks/{id}:cancel` | `tasks/cancel` | `POST /v1/runs/{runId}/cancel` (RFC 0094). Returns the `Task` at `TASK_STATE_WORKING` while `cancelling`, `TASK_STATE_CANCELED` once `cancelled`. A terminal run ⇒ `TaskNotCancelableError`. |
| `SubscribeToTask` · `POST /tasks/{id}:subscribe` (SSE) | `tasks/resubscribe` | RFC 0100 re-attach: replay the current `Task`, then follow. Terminal task ⇒ upstream error (spec §11.3.2). |
| `CreateTaskPushNotificationConfig` · `POST /tasks/{id}/pushNotificationConfigs` | `tasks/pushNotificationConfig/set` | RFC 0100 push config (D.6). Requires `capabilities.a2a.pushNotifications`, else `PushNotificationNotSupportedError`. |
| `Get`/`List`/`DeleteTaskPushNotificationConfig` · `GET`/`GET`/`DELETE …/pushNotificationConfigs[/{configId}]` | `…/get`, `…/list`, `…/delete` | Read/list/delete the persisted `A2ATaskState.PushConfig` records for a task the caller may read. |
| `GetExtendedAgentCard` · `GET /extendedAgentCard` | `agent/getAuthenticatedExtendedCard` | §C extended card. |

**D.2 `Message` (inbound, A2A → OpenWOP; and the mirror for messages the host emits).**

| Field | Direction A2A → OpenWOP |
| --- | --- |
| `messageId` (REQUIRED) | Recorded as `metadata.a2a.messageId` on the created/continued run and **used as the idempotency seed** for the boundary call: a repeated `SendMessage` with the same `(peer principal, messageId)` **MUST NOT** create a second run (RFC 0150 §A). |
| `contextId` | Opaque correlation key → persisted `A2ATaskState.contextId`; groups runs for `ListTasks`. It is **not** a tenant, workspace, or principal and **MUST NOT** be used to select one. |
| `taskId` | Absent ⇒ new run. Present ⇒ **MUST** resolve to the backing run (`taskId == runId`, `a2a-task-state.schema.json`). If that run is `waiting-approval` / `waiting-input`, the message resolves the interrupt exactly as §4 "Resume = A2A Message reply" specifies (5-action approval vocabulary via `metadata.openwop.interrupt`). If the run is `waiting-external`, it is delivered as the RFC 0099 external event. If the run is not suspended, the host **MUST NOT** silently drop the message: it **MUST** either deliver it through a declared input path or return `UnsupportedOperationError`. Terminal run ⇒ `TaskNotFoundError` per upstream ("already completed and purged" is a permitted reading; do not resurrect). |
| `role` (`ROLE_USER` \| `ROLE_AGENT`; REQUIRED) | Recorded. **Both** roles enter the run as `contentTrust: "untrusted"` (§"Trust boundary"); role never confers authority. |
| `parts[]` (REQUIRED) | Run input(s) per D.3. |
| `metadata` | Opaque → `metadata.a2a.messageMetadata`, **except** the declared `metadata.openwop.*` keys above. |
| `extensions[]` (URIs) | Opaque. A host that advertises no `capabilities.extensions` **MUST** ignore them and **MUST NOT** raise `ExtensionSupportRequiredError`; a host that advertises one **MUST** honour its declared params only. |
| `referenceTaskIds[]` | Opaque hints. **MUST NOT** grant read access to the referenced tasks — access is decided per task by §E — and **MUST NOT** be dereferenced into prompt or tool context without a declared mapping. |

**D.3 `Part` and `Artifact`.** 1.0 collapsed `TextPart`/`FilePart`/`DataPart` into one `Part` with a `oneof content` and **removed the `kind` discriminator**: a decoder **MUST** discriminate by member presence (`"text" in part`, etc.), never by a `kind` field.

| `Part` member | Inbound → OpenWOP | Outbound ← OpenWOP |
| --- | --- | --- |
| `text` | String input to the resolved workflow input port; `contentTrust: "untrusted"`. | Text output. |
| `raw` (bytes) + `mediaType`, `filename` | A host-stored blob referenced from the run input by artifact reference; the bytes **MUST NOT** be inlined into the run event log (`run-event.schema.json` payload bounds; SR-1). | Artifact bytes the host chooses to return inline (bounded by host policy; **MUST NOT** carry run-internal state). |
| `url` + `mediaType`, `filename` | A **reference**, never auto-fetched: dereferencing is an egress decision under RFC 0079 (`egress.decided`, SSRF-guarded) and **MUST NOT** occur without a declared mapping and an egress allow. | A URL the host publishes for an artifact; **MUST NOT** be a pre-signed URL into host-internal storage that leaks beyond the caller's authorization. |
| `data` (JSON value) | Structured input. | Structured output. |
| `metadata` | Opaque. | Opaque. |

`Artifact { artifactId (REQUIRED), name?, description?, parts[] (REQUIRED), metadata?, extensions[] }` → an OpenWOP run output the host designates as an artifact. `artifactId` **MUST** be stable across `GetTask` reads and across `TaskArtifactUpdateEvent` chunks of the same artifact (D.5). Redaction: artifacts obey the host's SR-1 redaction and the RFC 0128 label if present.

**D.4 `Task` and `TaskState`.**

`Task { id (REQUIRED), contextId, status { state (REQUIRED), message?, timestamp? }, artifacts[], history[], metadata }`:

| `Task` field | ← OpenWOP |
| --- | --- |
| `id` | `runId` (RFC 0100: the A2A task id **is** the backing run id). |
| `contextId` | `A2ATaskState.contextId`. |
| `status.state` | `run.status` via the projection below. |
| `status.message` | The most recent agent-role message the host chose to publish, or the RFC 0100 interrupt carrier message for `TASK_STATE_INPUT_REQUIRED` — content-free with respect to run internals. |
| `status.timestamp` | The `timestamp` of the run event that produced the current state (ISO 8601 UTC per upstream 1.0). |
| `artifacts[]` | D.3, respecting `includeArtifacts` on `ListTasks`. |
| `history[]` | The A2A `Message`s exchanged on this task, in exchange order, truncated to `historyLength` when requested. **MUST NOT** contain run-internal LLM transcripts, tool I/O, or `agent.*` reasoning events — those are OpenWOP stream/log surfaces, not A2A history. |
| `metadata` | `metadata.openwop.interrupt` (RFC 0100) and nothing else normative. |

**TaskState projection, 1.0 spelling.** 1.0 renamed every value to `TASK_STATE_*`; the persisted `A2ATaskState.state` (`a2a-task-state.schema.json`) **keeps the 0.3 lowercase-hyphen vocabulary as the canonical stored form** and the 1.0 interface renders it through this bijection at the boundary — one stored vocabulary, two wire spellings, so a `durableTasks` record written under 0.3 reads correctly under 1.0 and vice versa:

| `A2ATaskState.state` (stored, = 0.3 wire) | 1.0 wire | ← `run.status` (forward) | → `run.status` (reverse, host as A2A client) |
| --- | --- | --- | --- |
| `submitted` | `TASK_STATE_SUBMITTED` | `pending` | `pending` |
| `working` | `TASK_STATE_WORKING` | `running`, `paused` (drift #1), `cancelling` (RFC 0094, until terminal) | `running` |
| `input-required` | `TASK_STATE_INPUT_REQUIRED` | `waiting-approval`, `waiting-input`, `waiting-external` (drift #2 — the `metadata.openwop.interrupt.kind` carrier disambiguates) | `waiting-input` |
| `auth-required` | `TASK_STATE_AUTH_REQUIRED` | *(no forward source; OpenWOP has no auth-required interrupt kind)* | `waiting-input` + `metadata.subkind: "auth"` (drift #3) |
| `completed` | `TASK_STATE_COMPLETED` | `completed` | `completed` |
| `failed` | `TASK_STATE_FAILED` | `failed` | `failed` |
| `canceled` | `TASK_STATE_CANCELED` | `cancelled` | `cancelled` |
| `rejected` | `TASK_STATE_REJECTED` | *(no forward source; a refused `SendMessage` is an error, not a task)* | `failed` + `reason: "rejected_by_remote"` (drift #4) |
| — | `TASK_STATE_UNSPECIFIED` | never emitted | `pending` + warning |

The four drift points documented under §"State projection" hold unchanged; only the spelling moved.

**D.5 Streaming.** `SendStreamingMessage` / `SubscribeToTask` deliver a stream of `StreamResponse`, a `oneof payload` — a decoder discriminates by member presence (`task` \| `message` \| `statusUpdate` \| `artifactUpdate`); 1.0 **removed** the `kind` discriminator and the `final` boolean.

| `StreamResponse` member | ← OpenWOP run events |
| --- | --- |
| `task` | The current `Task` (D.4), sent first on subscribe/resubscribe and MAY be re-sent after a terminal transition. |
| `statusUpdate` — `TaskStatusUpdateEvent { taskId, contextId, status, metadata }` | Every `run.status` transition (`run.started`, `run.paused`/interrupt events, `run.completed`/`run.failed`/`run.cancelled`, RFC 0094 `cancelling`), projected via D.4. Terminality is signalled by the state itself, not a flag. |
| `artifactUpdate` — `TaskArtifactUpdateEvent { taskId, contextId, artifact, append, lastChunk, metadata }` | Output events the host publishes as artifacts. A chunked output emits the same `artifact.artifactId` with `append: true` on continuation chunks and `lastChunk: true` on the final one; a whole artifact is a single event with both false/absent. |
| `message` | An agent-role `Message` the host chooses to emit mid-task (e.g. a clarification prompt); optional. |

The stream **MUST** end after a terminal `statusUpdate` (or the terminal `task`) and **MUST NOT** carry OpenWOP `agent.*` reasoning, provider usage, or tool I/O events — those remain on `GET /v1/runs/{runId}/events` under OpenWOP auth. `Last-Event-ID` resumption is an OpenWOP SSE contract (`stream-modes.md`) and does not apply to the A2A stream; the A2A re-attach is `SubscribeToTask`.

**D.6 `SendMessageConfiguration` and push.**

| Field | OpenWOP |
| --- | --- |
| `acceptedOutputModes[]` | Media-type filter on outputs; a mode the skill cannot produce ⇒ `ContentTypeNotSupportedError` (upstream `-32005` / `INVALID_ARGUMENT` / `415`) **at request time**, not after the run has done work. |
| `historyLength` | Truncation of `Task.history` in the response; **MUST NOT** change what is persisted. |
| `returnImmediately` | `true` ⇒ respond as soon as the run is accepted (`TASK_STATE_SUBMITTED`/`WORKING`) — **requires `durableTasks`** so `GetTask` can read it later; a host without `durableTasks` **MUST** return `UnsupportedOperationError` rather than block silently. `false`/absent (upstream default) ⇒ block until terminal or `INPUT_REQUIRED`/`AUTH_REQUIRED`, bounded by the host's request timeout, after which the host **MUST** return the current `Task` (not an error) if the run was created. |
| `taskPushNotificationConfig` — `TaskPushNotificationConfig { tenant?, id, taskId, url (REQUIRED), token?, authentication { scheme (REQUIRED), credentials? } }` | RFC 0100 push config → `A2ATaskState.PushConfig`. `url` **MUST** pass the RFC 0093 webhook-egress SSRF guard before registration (invariant `a2a-push-egress-ssrf`; loopback/link-local/private **MUST** be refused — upstream §"Push notification security" says the same). `token` and `authentication.credentials` are **caller secrets**: they **MUST** be held in the host secret store and referenced, **MUST NOT** enter the run event log, `A2ATaskState` as persisted for `GetTask`, or a debug bundle (SR-1). Push bodies are `StreamResponse`-shaped (`statusUpdate` / `artifactUpdate`) and content-free with respect to run internals. |

**D.7 Errors, both directions.** Upstream 1.0 error catalogue ↔ OpenWOP canonical envelope (`error-envelope.schema.json`, codes in `rest-endpoints.md` §Error codes). Left column: what the OpenWOP host returns on its A2A interface; right column: what an OpenWOP caller sees when the host, acting as an A2A client, relays a peer failure across an OpenWOP boundary.

| A2A 1.0 error (`reason`; JSON-RPC / gRPC / HTTP) | Host as A2A **server**: emit when | Host as A2A **client**: project as |
| --- | --- | --- |
| `TaskNotFoundError` (`TASK_NOT_FOUND`; `-32001` / `NOT_FOUND` / `404`) | The run does not exist, is purged, **or belongs to a tenant/workspace the caller cannot read** — cross-tenant lookups **MUST** be indistinguishable from not-found (no enumeration; §E). | `not_found` |
| `TaskNotCancelableError` (`-32002` / `FAILED_PRECONDITION` / `409`) | `CancelTask` on a terminal run. | `run_terminal` (the code `rest-endpoints.md` already uses for already-completed/failed/cancelled runs). |
| `PushNotificationNotSupportedError` (`-32003` / `UNIMPLEMENTED` / `400`) | Push config on a host with `a2a.pushNotifications` unset. | `capability_required` (`details.requiredCapability: "a2a.pushNotifications"`) |
| `UnsupportedOperationError` (`-32004` / `UNIMPLEMENTED` / `400`) | An operation or option the host does not implement (e.g. `returnImmediately` without `durableTasks`; message to a non-suspended task with no input path). | `capability_required` or `validation_error`, whichever names the cause. |
| `ContentTypeNotSupportedError` (`-32005` / `INVALID_ARGUMENT` / `415`) | A part `mediaType` or `acceptedOutputModes` entry the skill cannot handle. | `validation_error` |
| `InvalidAgentResponseError` (`-32006` / `INTERNAL` / `502`) | — (a server does not emit this about itself) | The peer returned a non-conformant response: `validation_error` with `details.protocol: "a2a"`; **MUST NOT** feed the malformed body into run state. |
| `ExtendedAgentCardNotConfiguredError` (`-32007` / `FAILED_PRECONDITION` / `400`) | `GetExtendedAgentCard` when `capabilities.extendedAgentCard` is not true. | `not_found` |
| `ExtensionSupportRequiredError` (`-32008` / `FAILED_PRECONDITION` / `400`) | Only if the host advertises a `required: true` extension the client did not declare. | `validation_error` with `details.extension` |
| `VersionNotSupportedError` (`VERSION_NOT_SUPPORTED`; `-32009` / `UNIMPLEMENTED` / `400`) | §B. | **`interop_version_unsupported`** (§B). |

Error `message` text in either direction **MUST NOT** carry stack traces, provider bodies, credentials, or the other side's raw error body (RFC 0152 UQ4: upstream error *details* are reduced to the closed `reason` and, for version errors, `supportedVersions[]`; everything else is dropped, not redacted-in-place).

### §E — Identity and security

- **A2A authentication establishes a peer principal; it does not grant OpenWOP authorization.** Before any run is created, read, listed, cancelled, subscribed, or pushed to, the OpenWOP boundary **MUST** resolve tenant, workspace, principal (RFC 0048), scopes (RFC 0049), delegated actor where `auth.workloadIdentity.delegation` is advertised (RFC 0154 §B — the composition RFC 0152 gap G5 named), and audience — and **MUST** decide authorization there, under the same policy as an OpenWOP REST caller. Card `securitySchemes` describe *how* the peer authenticates; they never describe *what* it may do.
- **`tenant` is a hint, never a selector.** The `tenant` field on requests and on `AgentInterface` **MUST NOT** choose the tenant of record; that comes from the authenticated principal's binding. A hint that disagrees with the binding **MUST** be neutralized to the binding or refused — a host **MUST NOT** create the run in the requested tenant, and **MUST NOT** reveal whether the requested tenant exists (RFC 0132 §A.2's rule, applied to A2A).
- **No enumeration.** `GetTask` / `CancelTask` / `SubscribeToTask` / push-config reads on a task the caller cannot read **MUST** answer `TaskNotFoundError`, and `ListTasks` **MUST** be scoped to what the caller can read (D.1).
- **Push URLs remain SSRF-validated** (`a2a-push-egress-ssrf`); push credentials never touch the log (D.6).
- **Content in, content out.** Inbound parts are `untrusted` (§"Trust boundary"); outbound `Task.history`, `status.message`, and artifacts obey SR-1 redaction and RFC 0128 labels; `agent.*`, provider-usage, and tool-I/O events never cross the A2A boundary (D.5).
- **Invariants.** `a2a-version-no-silent-downgrade` is registered (protocol tier, `SECURITY/invariants.yaml`, witnessed by `a2a-version-negotiation.test.ts`). `a2a-card-runtime-consistent` and `a2a-peer-no-authority-escalation` are **named by RFC 0152 §E and not yet registered** — registering them needs, respectively, a card resolved against a live runtime and a peer attempting escalation (`docs/RFC-0147-SELF-AUDIT.md`); their conditions are the MUSTs in §C and this section, and they are listed as gaps rather than implied.
- **Threat-model coverage** for version downgrade, card/runtime drift, cross-tenant task lookup, and artifact content leakage: the corpus has no interop threat-model document today (`SECURITY/threat-model-*.md` covers auth profiles, node packs, prompt injection, provider policy, secret leakage). The threats are stated in this section; the document is a gap below.

### Conformance (RFC 0152)

- **Shape (always-on):** `versioned-composition-profiles.test.ts` — the §A fields on `capabilities.a2a`.
- **Behaviour (gated on `a2a.supported && a2a.protocolVersions.length > 0`, hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`):** `a2a-version-negotiation.test.ts` — preferred ∈ advertised; outbound `A2A-Version` header present; no silent downgrade of an authenticated request (header equals `negotiatedVersion`); unsupported version fails through the canonical envelope. Driven through the invoke seam catalogued in [`host-sample-test-seams.md`](./host-sample-test-seams.md) §22, against `A2AFakePeer` with header capture. **What is and is not witnessed on a live host (corrected 2026-08-16):** openwop-app's production origin advertises `a2a.protocolVersions` and passes the §A leg (preferred ∈ advertised). It has **not** wired `/v1/host/sample/a2a/invoke`, so the three §B behavioural legs are unwitnessable there — they resolve to `blocked` per RFC 0148 §A, not to a pass; an earlier revision of this paragraph said the §A/§B legs pass live, which was wrong for §B and is withdrawn. Locally, against a co-located host that wires the seam and the dual-era peer, the legs are witnessable.
- **RFC 0100 durable tasks:** `a2a-task-roundtrip.test.ts` (unchanged; 0.3-shaped fake peer).
- **RFC 0152 §C/§D/§E legs (added 2026-08-16, suite 1.112.0):** `a2a-1-0-agent-card.test.ts` (server-free — the suite's own peer at 1.0, pinned from the wire); `a2a-card-runtime-consistency.test.ts` (black-box, gated on `a2a.profiles ∋ a2a-1.0`: 1.0-shaped card at `agentCardUrl`, `supportedInterfaces[].protocolVersion` set == `protocolVersions`, JSON-RPC-at-1.0 floor, streaming/push flags equal — invariant `a2a-card-runtime-consistent` is now witnessable, not yet registered); `a2a-1-0-task-roundtrip.test.ts` (host as 1.0 server, gated on `a2a-1.0`: `SendMessage` → `{ task }` with `Task.id == runId`, `TASK_STATE_*`, `Part` oneof, `GetTask`, `TASK_NOT_FOUND` for unknown/unreadable ids); `a2a-peer-authority.test.ts` (host as client, gated on §B advert + seam `scenario`, records `blocked` until the host reports the `peerAuthority` block — invariant `a2a-peer-no-authority-escalation`). **Still absent:** `a2a-1.0-stream-push` (the peer honestly advertises `streaming: false`; a streaming peer is a further suite gap).
- **Named by RFC 0152 §Conformance:** `a2a-1.0-agent-card` ✓, `a2a-1.0-version-header` (covered under `a2a-version-negotiation`), `a2a-1.0-task-roundtrip` ✓ (host half gated), `a2a-1.0-stream-push` ✗, `a2a-version-downgrade` (covered under `a2a-version-negotiation`), `a2a-card-runtime-consistency` ✓, `a2a-peer-authority` ✓ — per `scripts/rfc-conformance-coverage.mjs`.
- **The suite's fake peer is dual-era (since 1.112.0).** `conformance/src/lib/a2a-fake-peer.ts` speaks A2A 1.0 (`SendMessage`/`GetTask`/`CancelTask`/`ListTasks`, 1.0 card with `supportedInterfaces[]`, `TASK_STATE_*`, `Part` oneof, `-32009` on an unsupported `A2A-Version`) **and** 0.3 (header-less requests are 0.3 by upstream rule; the card shape follows the era asked for, defaulting 0.3-first because today's hosts are 0.3 clients that read `card.url`). It does not stream (`capabilities.streaming: false`, `SubscribeToTask` ⇒ `UNSUPPORTED_OPERATION`), so `a2a-1.0-stream-push` remains a gap; a real upstream 1.0 peer in CI is externally gated (RFC 0152 acceptance).

### Open spec gaps (RFC 0152)

| # | Gap | Disposition |
| - | --- | ----------- |
| G1 | A2A 0.3 adopter inventory | **Open** — the legacy window date is fixed above (2027-03-12); who is on 0.3 is not known and is not something this document can find out. |
| G2 | Field-by-field translation table | **Closed** by §D (D.1–D.7). |
| G3 | Official real-peer SDK for CI | **Externally gated** — no upstream 1.0 peer is wired; the fake peer is 0.3-shaped. |
| G4 | Mandatory interface floor | **Closed** by §C: JSON-RPC at 1.0 is the floor; HTTP+JSON and gRPC optional. |
| G5 | Delegated identity composes with RFC 0154 | Addressed in §E; RFC 0154 §B is shape-only, so the composition is stated, not witnessed. |
| G6 | 1.0-shaped fake peer + the seven named scenarios | **Mostly closed 2026-08-16 (suite 1.112.0):** dual-era peer landed; `a2a-1.0-agent-card`, `a2a-card-runtime-consistency`, `a2a-1.0-task-roundtrip` (host half gated), `a2a-peer-authority` landed. Open: `a2a-1.0-stream-push` (no streaming peer). |
| G7 | Dedicated content-free negotiation audit event | **Open** — §B recommends `authorization.decided` as the carrier; a dedicated `RunEventType` member is not minted here. |
| G8 | Interop threat-model document (downgrade, card/runtime drift, cross-tenant lookup, artifact leakage) | **Open** — threats stated in §E; no `SECURITY/threat-model-interop.md` exists. |
| G9 | Native `auth-required` interrupt kind (drift #3) | **Open** — unchanged from §"Future work". |

---

## Future work

- ~~Codify a recommended `metadata.openwop.*` shape so A2A clients can render openwop-interrupt-rich payloads consistently across hosts.~~ ✅ Codified for the interrupt-kind carrier by RFC 0100 (`metadata.openwop.interrupt.kind`, `A2ATaskState.interruptKind`); the broader namespace stays a host extension.
- ~~Add an `a2a` capability slot to `/.well-known/openwop` discovery.~~ ✅ Added by RFC 0100 (`capabilities.a2a`).
- Specify a normative `auth-required` interrupt kind in v1.x to remove drift point #3.
- ~~Ship `a2a-task-roundtrip.test.ts` in a future conformance minor.~~ ✅ Live as of 2026-05-10; real-peer interop-evidence mode added 2026-05-11 (Phase 3 T3.4).
- Worked node-pack example: `examples/a2a-bridge/` showing an OpenWOP node that invokes an external A2A agent. Filed as a candidate post-v1 example.

---

## See also

- `spec/v1/positioning.md` — why A2A is complementary, not competing.
- `spec/v1/mcp-integration.md` — the parallel composition doc for MCP.
- `spec/v1/host-extensions.md` — what's in the openwop wire contract vs what's a host extension. The `metadata.openwop.*` namespace under A2A is a host extension by this taxonomy.
- A2A spec: `https://a2a-protocol.org/latest/specification/` — canonical source.
- A2A canonical `.proto`: `https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto` — the spec calls this "the single authoritative normative definition."
- A2A **1.0.0** pin for the `a2a-1.0` profile: `https://github.com/a2aproject/A2A/blob/v1.0.0/specification/a2a.proto` and `https://a2a-protocol.org/v1.0.0/specification/`; change list `https://a2a-protocol.org/latest/whats-new-v1/`.
