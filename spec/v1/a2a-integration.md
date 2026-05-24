# openwop Spec v1 — A2A Integration

> **Status: Stable · v1.1 (2026-05-05).** Worked example of how OpenWOP and the Agent2Agent Protocol (A2A) compose. The composition pattern is non-normative; the state-projection rules in §"State projection" are normative for any host that opts into A2A composition (14 RFC 2119 keywords). Pinned to A2A v1 as published at `https://a2a-protocol.org/latest/specification/`. Graduated DRAFT → FINAL via RFC 0006. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## TL;DR

**openwop is not in the agent-to-agent message-exchange business.** A2A is. The two protocols compose along orthogonal axes:

- **A2A** standardizes how independent agents discover each other (Agent Cards), exchange Messages and Tasks, and deliver streamed/pushed updates between hosts.
- **openwop** standardizes what happens *inside* an agent — how a multi-step workflow is declared, run, suspended at HITL gates, replayed, and observed.

An OpenWOP-compliant host can expose itself as an A2A agent with each Workflow advertised as an A2A `AgentSkill`. Each OpenWOP run becomes an A2A `Task`. The two are **deliberately not** redundant: A2A's Task is intentionally an opaque box from the caller's perspective; OpenWOP gives that box internal structure for the host that runs it.

```
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

| Layer | Owner | Concerns |
|---|---|---|
| Inter-agent discovery + message exchange | A2A | AgentCard, signed identity, Skill catalog, transport binding (REST/JSON-RPC/gRPC), push delivery |
| Workflow execution + state inside one agent | openwop | Run lifecycle, event log, interrupts, replay, observability, conformance |

A2A's spec deliberately treats the agent's internal execution as opaque — that's the whole point of the abstraction. openwop fills that opacity for hosts that want their internals to be portable, conformance-tested, and replay-debuggable.

You don't have to use both. A2A-only agents work fine without openwop. openwop-only hosts work fine without A2A. The composition is for hosts that want **both** inter-agent interop **and** internal-workflow portability.

---

## State projection: openwop run.status ↔ A2A TaskState

An OpenWOP host that exposes itself via A2A projects each run's `run.status` to A2A's `TaskState`. The mapping is not 1:1 — three drift points are documented below.

openwop `run.status` enum (per `schemas/run-snapshot.schema.json`):
`pending | running | paused | waiting-approval | waiting-input | completed | failed | cancelled`

A2A `TaskState` enum (per `a2a.proto` lines 187–208, 9 values incl. `UNSPECIFIED`):
`UNSPECIFIED | SUBMITTED | WORKING | INPUT_REQUIRED | AUTH_REQUIRED | COMPLETED | FAILED | CANCELED | REJECTED`

> **Spelling drift to remember:** openwop uses British `cancelled` (two `l`s). A2A uses American `CANCELED`/`canceled` (one `l`). Hosts that project both ways MUST handle both spellings; this is a wire-format reality, not a bug to fix.

### openwop → A2A (forward projection)

| openwop `run.status` | A2A `TaskState` | Notes |
|---|---|---|
| `pending` | `SUBMITTED` | Clean. Run accepted but not yet executing. |
| `running` | `WORKING` | Clean. |
| `paused` | `WORKING` ⚠ | **Drift point #1.** A2A has no manual-pause concept. OpenWOP hosts SHOULD project `paused` as `WORKING` and surface the pause condition via a Task message or `metadata` field. Hosts MAY use a vendor extension to carry `paused` literally. |
| `waiting-approval` | `INPUT_REQUIRED` | Approval-gate suspension. OpenWOP hosts SHOULD set `Task.metadata` with the approval shape (5-action vocabulary per `interrupt.md`) so A2A clients can render the right UI. |
| `waiting-input` | `INPUT_REQUIRED` | Clarification suspension. Same projection as `waiting-approval`. **Drift point #2 (lossy):** A2A clients receive the same `INPUT_REQUIRED` for both approval and clarification interrupts — the distinction MUST come from `Task.metadata` or a vendor extension. |
| `completed` | `COMPLETED` | Clean. |
| `failed` | `FAILED` | Clean. |
| `cancelled` | `CANCELED` | Clean modulo spelling. |

### A2A → openwop (reverse projection — when OpenWOP host *consumes* an A2A agent)

An OpenWOP host that calls out to an external A2A agent inside a workflow node (`a2a.invoke` or similar host-extension node) projects A2A Task states back into openwop run state for the caller's run. This is the harder direction:

| A2A `TaskState` | openwop `run.status` projection | Notes |
|---|---|---|
| `UNSPECIFIED` | `pending` | Best-effort. SHOULD log a warning — the called agent isn't supplying a defined state. |
| `SUBMITTED` | `pending` | Clean. |
| `WORKING` | `running` | Clean. |
| `INPUT_REQUIRED` | `waiting-input` | The called A2A agent is asking the *caller* for input. OpenWOP host SHOULD lift this into the calling run as a `clarification` interrupt with payload from the A2A `Task.message`. |
| `AUTH_REQUIRED` | — ⚠ | **Drift point #3.** openwop v1 has no `auth-required` interrupt kind. Hosts SHOULD project as `waiting-input` with `metadata.subkind: 'auth'` until a future v1.x adds a normative `auth` interrupt. Filed as candidate v1.x work. |
| `COMPLETED` | `completed` | Clean. |
| `FAILED` | `failed` | Clean. |
| `CANCELED` | `cancelled` | Clean modulo spelling. |
| `REJECTED` | `failed` ⚠ | **Drift point #4 (lossy).** A2A `REJECTED` means the agent declined to execute the request (e.g., capability mismatch, policy denial). openwop has no `rejected` terminal — projects to `failed` with `reason: 'rejected_by_remote'`. |

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

### 2. Skill invocation = openwop run start

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

| openwop event | A2A delivery |
|---|---|
| `run.started` | `TaskStatusUpdateEvent { status: WORKING }` |
| `node.completed` (artifact produced) | `TaskArtifactUpdateEvent { artifact: <projected from openwop artifact> }` |
| `approval.requested` | `TaskStatusUpdateEvent { status: INPUT_REQUIRED, metadata: { openwop.interrupt: { kind: 'approval', ... } } }` |
| `clarification.requested` | `TaskStatusUpdateEvent { status: INPUT_REQUIRED, metadata: { openwop.interrupt: { kind: 'clarification', ... } } }` |
| `run.completed` | `TaskStatusUpdateEvent { status: COMPLETED }` + final artifact list |
| `run.failed` | `TaskStatusUpdateEvent { status: FAILED, metadata: { openwop.error: { code, message } } }` |
| `run.cancelled` | `TaskStatusUpdateEvent { status: CANCELED }` |

The `metadata.openwop.*` namespace is a host extension under A2A — A2A clients that don't understand openwop's interrupt vocabulary can still render `INPUT_REQUIRED`; clients that *do* understand it get the richer payload.

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

## What openwop does NOT specify about A2A

- **A2A wire format details.** A2A is canonically defined at `https://a2a-protocol.org/latest/specification/` and `https://github.com/a2aproject/A2A`; openwop doesn't re-specify it.
- **The `metadata.openwop.*` extension shape.** Host-implementation choice. A future spec annex MAY codify a recommended shape if multiple hosts converge on a pattern.
- **Push notification HMAC details.** A2A v1 spec §4.3.3 (prose-only) defines the push delivery contract; openwop defers to it. openwop's own webhook spec (`webhooks.md`) is independent.
- **AgentCard signing.** openwop MAY require signed cards in `a2a.invoke` node config (host-specific); it doesn't mandate the signing algorithm.
- **Error taxonomy mapping.** A2A `VersionNotSupportedError` and similar protocol-level errors stay inside the A2A layer; they don't surface as openwop `RunEvent` errors. openwop errors stay inside the run; they project to A2A `FAILED` with `metadata.openwop.error`.
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

| Operational concern | A2A side | OpenWOP side | Recommended mapping |
|---|---|---|---|
| **Failure on the OpenWOP side mid-run** | Task transitions to `failed`. | Run reaches terminal `failed`; `RunSnapshot.error` carries the canonical `RunErrorCode`. | The A2A bridge MUST surface `Task.error.message` derived from `RunSnapshot.error.message`. Carry the typed `code` in `Task.metadata.openwop.errorCode` for clients that recognize it. |
| **OpenWOP HITL interrupt opens** | Task transitions to `input-required`. | Run status flips to `waiting-approval` / `waiting-input` / `waiting-clarification`. | Project the interrupt's signed token into `Task.metadata.openwop.interruptToken`. The A2A client invokes `POST /v1/interrupts/{token}` directly OR via an `a2a:Message` whose `metadata.openwop.action` carries the resolution payload. |
| **OpenWOP cancellation** (`POST /v1/runs/{id}/cancel`) | The A2A bridge MUST issue an A2A cancel toward the peer. | Run reaches `cancelled` with `reason: 'cross_protocol_cancel'`. | Cancellation flows bidirectionally; whichever side initiates wins. Document the precedence in your A2A bridge's deployment notes if both sides can initiate. |
| **A2A peer goes unreachable during run** | A2A transport error (timeout / 5xx). | Bridge node SHOULD retry per its retry policy; on exhaustion, emit `node.failed` with `code: 'external_call_failed'`. | Don't transition the run to `failed` solely on transport unreachability — let `core.dispatch` retry semantics apply per RFC 0007. |
| **Concurrent runs against the same A2A peer** | A2A peer MAY serialize OR parallelize per its own AgentCard. | OpenWOP run lifecycle is independent per `runId`. | Each OpenWOP run gets its own A2A Task; correlation via `Task.metadata.openwop.runId`. The A2A bridge node MUST NOT assume serialization. |
| **Identity propagation under multi-hop** | A2A doesn't normate identity propagation beyond AgentCard. | OpenWOP propagates `RunSnapshot.runOrchestrator.agentId` for replay determinism. | When OpenWOP dispatches to A2A, the bridge SHOULD include the calling AgentRef in `Message.metadata.openwop.callerAgentId` so downstream peers can attribute. NEVER include BYOK credential material. |
| **Time-skew between A2A and OpenWOP clocks** | A2A `Task.createdAt` is the peer's clock. | OpenWOP `Run.createdAt` is the OpenWOP host's clock. | Bridge nodes SHOULD record both timestamps; observers MUST NOT assume monotonicity across the boundary. |
| **Backpressure on the A2A peer** | A2A 503 / `unavailable` state. | OpenWOP run hits transport-layer `unavailable`. | The bridge node SHOULD project peer-backpressure to a transient `external_call_failed`; `core.dispatch` retry semantics apply. Don't bubble backpressure as run-level `failed`. |
| **Trust-boundary on A2A messages** | A2A messages from peers are external. | OpenWOP's `mcpClient.trustBoundary: 'untrusted'` discipline applies analogously. | Any A2A message content reaching OpenWOP run state MUST be tagged `contentTrust: 'untrusted'` before downstream LLM nodes consume it, matching `threat-model-prompt-injection.md` §"UNTRUSTED" semantics. |
| **Replay determinism across the boundary** | A2A peers MAY emit different responses on replay (the peer's choice). | OpenWOP replay caches per RFC 0006 §C apply. | The bridge node MUST cache the A2A peer's response in the OpenWOP event-log payload; replay-time A2A calls MUST be replaced by the cached response, not re-issued. |

These mappings stay non-normative for v1.x — A2A's spec is itself evolving. Hosts that codify deviations from this table SHOULD document them in their own integration notes.

## Future work

- Codify a recommended `metadata.openwop.*` shape so A2A clients can render openwop-interrupt-rich payloads consistently across hosts.
- Add an `a2a` capability slot to `/.well-known/openwop` discovery.
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
