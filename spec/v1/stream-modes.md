# openwop Spec v1 — SSE Stream Modes

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of the four canonical stream consumption modes (values, updates, messages, debug), the `?streamMode=` query parameter, event-type-to-mode mapping, and CLI default. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Without stream modes, an SSE endpoint emits every engine event undifferentiated — UI, debugger, automation, and agent consumers all see the same stream and have to filter client-side. This is wasteful (every consumer pays bandwidth + parsing cost for events they ignore) and ambiguous (no canonical contract for "what does a UI need vs what does a debugger need").

openwop defines four canonical stream modes that consumers select via a query parameter. Each mode is a documented filter over the underlying event log; servers MUST implement at minimum the `updates` mode and SHOULD implement all four.

The four modes parallel [LangGraph's stream_mode taxonomy](https://langchain-ai.github.io/langgraph/concepts/streaming/) — chosen for ecosystem familiarity, not vendor lock-in.

---

## Mode selection

Clients select a mode via the `streamMode` query parameter on `GET /v1/runs/{runId}/events`:

```
GET /v1/runs/{runId}/events?streamMode=updates
```

Allowed values: `values | updates | messages | debug`. If omitted, the server MUST default to `updates`.

If a client requests a mode the server doesn't implement, the server MUST respond with HTTP `400 Bad Request` and body:

```json
{
  "error": "unsupported_stream_mode",
  "message": "Server does not implement streamMode='messages'",
  "supported": ["values", "updates", "debug"]
}
```

Servers MAY advertise their supported modes in `/.well-known/openwop` (see `capabilities.md`).

### Content negotiation (additive opt-in)

Hosts MAY content-negotiate the response shape on `GET /v1/runs/{runId}/events` via the request `Accept` header:

- `Accept: text/event-stream` (or no Accept) — SSE response with `Content-Type: text/event-stream` and `event:` / `data:` / `id:` framing per `eventsource` spec. This is the canonical wire shape for this endpoint and what `EventSource` clients receive by default.
- `Accept: application/json` — JSON envelope with the same `events` array shape as `GET /v1/runs/{runId}/events/poll`. Useful when the caller is a generic HTTP client without an SSE parser (curl, conformance probes, browser fetch without EventSource).

Content negotiation is OPTIONAL. Hosts that serve SSE only and ignore Accept remain spec-conformant. Hosts that implement negotiation MUST ensure validation gates (`streamMode`, `bufferMs`) run BEFORE the content-shape branch — an invalid `streamMode` MUST return `400` regardless of the requested response format.

The `Postgres` reference host at `examples/hosts/postgres/` implements this negotiation; the `SQLite` reference host serves SSE only.

---

## The four modes

### `updates` (default)

**Purpose**: minimal state-change stream. UI consumers and CLI watchers want to render progress without buffering full state on every event.

**Emits**: an event for each *terminal node transition* (completed/failed/skipped/cancelled), each *suspension transition* (waiting-approval/waiting-input/resumed), each *run transition* (running/paused/completed/failed/cancelled), and each *artifact production*. NOT individual log lines, NOT internal projection cache writes, NOT every variable mutation.

**Wire shape**: SSE events with type per `RunEventType`. Each event payload is a *delta* — the change since the last event, not a full snapshot.

**Termination**: server closes the connection when the run reaches a terminal status.

### `values`

**Purpose**: full state snapshots after each step. Used by external systems that don't maintain their own state machine and want to see "what does the run look like now?" after every meaningful change.

**Emits**: a single `state.snapshot` event after each `updates`-tier transition. Payload is the canonical `RunSnapshot` shape — the same JSON returned by `GET /v1/runs/{runId}`. Schema: [`schemas/run-snapshot.schema.json`](../../schemas/run-snapshot.schema.json). Reusing the projection type means consumers can swap polling for `values`-mode SSE without re-modeling state.

**Wire shape**: same as `updates` but with synthesized snapshot events instead of deltas. Higher bandwidth.

**Termination**: server closes after final snapshot.

### `messages`

**Purpose**: LLM token stream for chat-style UIs that render assistant text incrementally.

**Emits**: per-token chunks from any `core.ai.callPrompt` / `core.ai.generateFromPrompt` node currently streaming. Other event types are filtered out — consumers pair this stream with an `updates` stream if they also need state transitions.

**Wire shape**: SSE events with type `ai.message.chunk`. Schema: `run-event-payloads.schema.json#$defs.outputChunk` (the canonical `outputChunk` payload doubles as the `ai.message.chunk` payload). Tiered shape:

```jsonc
{
  "nodeId":  "n_42",
  "runId":   "run_abc",
  "chunk":   "Hello",
  "isLast":  false,
  "meta": {
    // Tier 1 — typed / normalized (consumers MAY branch on these without provider awareness)
    "finishReason": "stop",                              // "stop" | "length" | "tool_calls" | "content_filter"
    "logprobs": [...],
    "toolCalls": [...],
    "model": "claude-opus-4-7",
    "usage": { "promptTokens": 12, "completionTokens": 4, "totalTokens": 16 },

    // Tier 2 — provider pass-through (raw provider chunk; for advanced consumers only)
    "provider": "anthropic",
    "providerExtensions": { /* raw provider-specific blob */ }
  }
}
```

The `meta` object is optional. The bare `{nodeId, runId, chunk, isLast}` shape is the minimum compliant payload — UIs rendering streamed text MAY ignore `meta` entirely.

**Tier rules** (per S2 closure):

- When the server has data AND a Tier 1 slot exists, the server MUST populate the Tier 1 slot (so spec-compliant consumers can read normalized fields without provider knowledge).
- The server MAY ALSO populate `providerExtensions` with the raw chunk for fidelity.
- Provider-specific fields that have no Tier 1 slot SHOULD live in `providerExtensions`, NOT at the top level.
- Forward-compat: as the spec adds Tier 1 slots over time, fields migrate from `providerExtensions` into typed slots. Consumers using `providerExtensions` already opted into per-provider knowledge — Tier 1 promotion is additive (no breakage; typed slot wins).

The `meta.usage.{promptTokens, completionTokens}` field is the per-chunk source for the `openwop.cost.tokens.*` rollup attributes specified in `observability.md` §Cost attribution attributes (O4). Same numbers, different aggregation level.

**Termination**: server closes when the run reaches terminal status. If no AI nodes execute, the stream is empty until termination.

### `debug`

**Purpose**: every event the engine emits, internal or external. Used by replay tools, debuggers, and conformance tests.

**Emits**: every `RunEventDoc` from the durable event log including `log.appended`, internal projection writes, lease lifecycle events, version pin events, and any vendor-extension events.

**Wire shape**: same as `updates` but with no filtering. Highest bandwidth.

**Termination**: server closes after the run's terminal event.

---

## Mode-to-event mapping

The exact event types each mode emits:

| RunEventType | `updates` | `values` (synthesized) | `messages` | `debug` |
|---|---|---|---|---|
| `run.started` | ✅ | ✅ snapshot | — | ✅ |
| `run.completed` / `run.failed` / `run.cancelled` | ✅ | ✅ snapshot | — | ✅ |
| `run.paused` / `run.resumed` | ✅ | ✅ snapshot | — | ✅ |
| `node.started` | — | ✅ snapshot | — | ✅ |
| `node.completed` / `node.failed` / `node.skipped` | ✅ | ✅ snapshot | — | ✅ |
| `node.suspended` | ✅ | ✅ snapshot | — | ✅ |
| `node.retried` | — | — | — | ✅ |
| `approval.requested` | ✅ | ✅ snapshot | — | ✅ |
| `approval.received` | ✅ | ✅ snapshot | — | ✅ |
| `clarification.requested` / `clarification.resolved` | ✅ | ✅ snapshot | — | ✅ |
| `variable.changed` | — | — | — | ✅ |
| `version.pinned` | — | — | — | ✅ |
| `lease.acquired` / `lease.renewed` / `lease.lost` | — | — | — | ✅ |
| `log.appended` | — | — | — | ✅ |
| `ai.message.chunk` (synthesized from streaming AI calls) | — | — | ✅ | ✅ |

✅ = emitted in this mode; — = filtered out

---

## Resumption

All four modes MUST honor the `Last-Event-ID` request header for resumption. The server MUST:

1. Look up the event with that ID.
2. Begin streaming from the next sequence after that event.
3. Not re-emit the resumption point itself.

For the `values` mode, resumption MUST emit a `state.snapshot` first (so the resuming client gets a baseline) before continuing with subsequent updates.

---

## Multiple subscribers

Multiple clients MAY subscribe to the same run with different modes simultaneously. The server's event log is the single source of truth; per-subscriber filtering is the only difference.

Servers MUST NOT throttle or limit the number of subscribers per run except for resource-protection reasons (in which case `429 Too Many Requests` with `Retry-After` is the correct response, not silent dropping).

---

## Aggregation hint: `?bufferMs=` (closes S3)

For high-volume runs (large multi-node DAGs, fan-out subworkflows), per-event SSE delivery can saturate consumer queues and produce visible jitter on UIs that re-render per event. `?bufferMs=N` is an optional query parameter that requests batched delivery — the server accumulates events for up to N ms (or until a forced-flush trigger fires) and emits a single SSE event whose `data:` is a **JSON array** of `RunEventDoc`.

```
GET /v1/runs/{runId}/events?streamMode=updates&bufferMs=100
```

Constraints:

- Range: `0 ≤ bufferMs ≤ 5000`. `0` means "no buffering" (same as omitting). Larger values are clamped to 5000.
- Forced-flush triggers (server MUST flush regardless of `bufferMs` accumulation): terminal run events (`run.completed` / `run.failed` / `run.cancelled`), suspension transitions (`node.suspended`), and connection close.
- Wire shape: `event: batch` SSE event with `data: [<RunEventDoc>, <RunEventDoc>, ...]`. Single-event windows MAY still emit a 1-element array; consumers MUST tolerate both single-element arrays and unbatched single-object events.
- Resumption: `Last-Event-ID` MUST honor the SSE `id:` of the BATCH, not individual events within it. Servers SHOULD use the highest `sequence` in the batch as the SSE ID.

An OpenWOP-compliant server MAY ignore the parameter (responding with the unbuffered stream); consumers detecting unbuffered behavior should treat that as fully spec-compliant.

---

## Mixed mode: `?streamMode=A,B` (closes S4)

A subscriber that needs both progress events AND LLM token chunks currently has to open two SSE connections (one in `updates` mode, one in `messages`). Mixed-mode subscriptions allow a comma-separated list:

```
GET /v1/runs/{runId}/events?streamMode=updates,messages
```

Semantics:

- Comma-separated list of canonical mode names. Order is informative; servers MUST emit events as they happen and MUST NOT reorder for canonical-list-ordering reasons.
- Event filtering: the union of each named mode's filter. An event passes if ANY listed mode would emit it.
- Termination: same rule as the single-mode case — server closes the connection on the run's terminal event.
- Per-event labeling: each emitted SSE event SHOULD carry an `event:` field naming the mode that admitted it (e.g., `event: updates` or `event: messages`). When an event qualifies under multiple modes, the server MAY pick any one consistently. Consumers MUST tolerate this overlap.
- `values` MUST NOT be combined with another mode (state.snapshot semantics need exclusive ownership of the stream).
- Unsupported combinations return `400 Bad Request` with `error: "unsupported_stream_mode"`. The error body's `supported` array MUST include each individual mode name; mixed combinations are NOT advertised in `supported`.

---

## CLI integration

An OpenWOP-compliant CLI (e.g., a host's workflow-run command with `--watch`) SHOULD:

1. Default to `--stream-mode=updates`.
2. Support all four modes via the flag.
3. Render `updates` as a node-by-node progress bar.
4. Render `messages` as inline streamed text.
5. Render `debug` as a JSON-per-line firehose suitable for `| jq`.
6. Render `values` as an updated full-state TUI panel (or fall back to `updates` if no TUI available).

---

## Open spec gaps

| # | Gap | Owner |
|---|---|---|
| S1 | `state.snapshot` payload schema — done (2026-04-27: reuses `schemas/run-snapshot.schema.json` verbatim — same shape as `GET /v1/runs/{runId}` projection). | ✅ |
| S2 | `ai.message.chunk` payload — done (2026-04-27: tiered shape — Tier 1 typed slots `finishReason / logprobs / toolCalls / model / usage`, Tier 2 `providerExtensions` escape hatch. Bare `{chunk, isLast}` remains the minimum compliant payload). Schema lives at `run-event-payloads.schema.json#$defs.outputChunk`. | ✅ |
| S3 | Subscriber-side aggregation hints — done (2026-04-27: `?bufferMs=N` query param accepts 0..5000; batched SSE events use `event: batch` with array `data:`. Forced-flush on terminal events + suspensions. See "Aggregation hint" §). | ✅ |
| S4 | Mixing modes — done (2026-04-27: comma-separated `?streamMode=A,B` accepted; union-of-filters semantics; per-event `event:` field labels which mode admitted it; `values` exclusive. See "Mixed mode" §). | ✅ |

## References

- `auth.md` — auth model + status legend
- `rest-endpoints.md` — `GET /v1/runs/{runId}/events` endpoint surface
- `capabilities.md` — optional discovery fields and host extensions can advertise supported stream modes
- `observability.md` — `openwop.event.*` attributes apply to all stream events regardless of mode
- LangGraph streaming: <https://langchain-ai.github.io/langgraph/concepts/streaming/> (idiom source — not a normative dependency)
- Reference implementations SHOULD document whether `?streamMode=` is fully filtered, partially projected, or treated as an all-events fallback. Hosts that advertise stream-mode support in capabilities are expected to honor the mode-specific semantics above.
