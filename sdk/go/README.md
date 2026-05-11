# `openwopclient` — Go SDK for the Multi-Agent Workflow Orchestration Protocol

**openwop is an open, wire-level protocol for multi-agent workflow orchestration** — a single contract for runs in which LLM agents, deterministic tools, sub-workflows, and human reviewers collaborate, with durable suspend / resume, replay, version negotiation, and observability owned by the protocol itself. This package is the reference Go client: synchronous, zero runtime deps, strongly-typed structs for every spec'd REST endpoint plus a channel-based SSE consumer.

```bash
go get github.com/openwop/openwop/sdk/go
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · **Status:** FINAL v1 (2026-04-27) · **Mirrors:** the TypeScript and Python SDKs (same endpoint coverage, idiomatic Go shape)

This SDK is hand-authored rather than codegen'd from OpenAPI. Same rationale as the TypeScript SDK — see [`sdk/typescript/README.md`](https://github.com/openwop/openwop/blob/main/sdk/typescript/README.md) §rationale.

---

## Quickstart

```go
package main

import (
    "context"
    "fmt"
    "log"

    openwopclient "github.com/openwop/openwop/sdk/go"
)

func main() {
    client, err := openwopclient.NewClient("https://api.example.com", "hk_test_abc123")
    if err != nil {
        log.Fatal(err)
    }
    ctx := context.Background()

    // Discovery (no auth required)
    caps, err := client.GetCapabilities(ctx)
    if err != nil { log.Fatal(err) }
    fmt.Println(caps.ProtocolVersion, caps.Limits.EnvelopesPerTurn)

    // Run lifecycle
    resp, err := client.CreateRun(ctx,
        openwopclient.CreateRunRequest{
            WorkflowID: "my-wf",
            Inputs:     map[string]any{"foo": "bar"},
        },
        openwopclient.MutationOptions{},
    )
    if err != nil { log.Fatal(err) }

    // SSE stream
    events, cleanup, err := client.StreamEvents(ctx, resp.RunID,
        openwopclient.StreamEventsOptions{StreamMode: openwopclient.StreamModeUpdates})
    if err != nil { log.Fatal(err) }
    defer cleanup()
    for ev := range events {
        fmt.Println(ev.Type, ev.Payload)
    }
}
```

---

## Install (dev, from local checkout)

```bash
cd sdk/go
go vet ./...
go test ./...
```

## What's Covered In v1.0

| Endpoint | SDK method |
|---|---|
| `GET /.well-known/openwop` | `client.GetCapabilities(ctx)` |
| `GET /v1/openapi.json` | `client.GetOpenAPI(ctx)` |
| `GET /v1/workflows/{id}` | `client.GetWorkflow(ctx, id)` |
| `POST /v1/runs` | `client.CreateRun(ctx, body, opts)` |
| `GET /v1/runs/{id}` | `client.GetRun(ctx, id)` |
| `GET /v1/runs/{id}/events` (SSE) | `client.StreamEvents(ctx, id, opts) → (<-chan, cleanup, err)` |
| `GET /v1/runs/{id}/events/poll` | `client.PollRunEvents(ctx, id, opts)` |
| `POST /v1/runs/{id}/cancel` | `client.CancelRun(ctx, id, body, opts)` |
| `POST /v1/runs/{id}:fork` | `client.ForkRun(ctx, id, body, opts)` |
| `POST /v1/runs/{id}/interrupts/{nodeId}` | `client.ResolveInterruptByRun(ctx, id, nodeID, body, opts)` |
| `GET /v1/interrupts/{token}` | `client.InspectInterruptByToken(ctx, token)` |
| `POST /v1/interrupts/{token}` | `client.ResolveInterruptByToken(ctx, token, body, opts)` |

**Idempotency-Key + X-Dedup** are passed via `MutationOptions{IdempotencyKey: "...", Dedup: true}` on every mutation.

**Trace-ID surfacing**: `*WopError` captures the W3C `Traceparent` from response headers and exposes `err.TraceID` (32-hex). `err.Error()` auto-suffixes `(trace=<id>)` so logs are searchable against backend traces per `observability.md` §Trace context propagation.

## Error Handling

```go
resp, err := client.CreateRun(ctx, openwopclient.CreateRunRequest{WorkflowID: "my-wf"}, openwopclient.MutationOptions{})
if err != nil {
    if werr, ok := err.(*openwopclient.WopError); ok && werr.Envelope != nil && openwopclient.IsHTTPErrorCode(werr.Envelope.Error) {
        fmt.Println(werr.Envelope.Error, werr.Envelope.Details)
    }
    return
}
_ = resp
```

`HTTPErrorCodes` is the canonical REST/MCP error-envelope vocabulary (`unauthenticated`, `validation_error`, `run_already_active`, etc.). Contextual fields live under `ErrorEnvelope.Details`; for example retry hints are `Details["retryAfter"]`, not a top-level response field.

---

## SSE shape

```go
events, cleanup, err := client.StreamEvents(ctx, runID, openwopclient.StreamEventsOptions{...})
defer cleanup()
for ev := range events {
    // ev is openwopclient.RunEventDoc
}
```

The channel closes when the server closes the SSE stream (terminal run event), when ctx is cancelled, or when cleanup is called. Buffered with 16 slots; backpressure on slow consumers.

Per-event decode errors (non-JSON keep-alive, vendor extensions) are silently skipped — the consumer gets only valid `RunEventDoc` values.

---

## v1.x Additions

| Feature | Why |
|---|---|
| Webhook subscription helpers | v1 specifies webhook delivery, but the SDK keeps endpoint coverage focused on the run lifecycle and conformance-critical surfaces. |
| Hosted registry publishing helpers | Node-pack registry publishing needs operator-specific credentials and policy; use direct HTTP until a dedicated package workflow is warranted. |
| Auto-retry with exponential backoff | Retry policy is application-specific. The SDK exposes structured errors so callers can implement their own retry envelope. |
| Builder-pattern API | Current method-positional API is stable for v1.0. |

---

## Layout

```
sdk/go/
  README.md       — this file
  go.mod          — Go module declaration (>=1.22)
  types.go        — Structs + JSON tags for every spec shape
  errors.go       — WopError (with traceparent capture)
  client.go       — OpenwopClient sync API (12 endpoint methods)
  sse.go          — channel-based SSE consumer (pure stdlib)
```

---

## Versioning

Tracks the OpenWOP protocol major. The v1 SDK line is intended to remain backward-compatible across v1.x releases, with additive features and bug fixes landing as minor or patch releases.

## References

- Spec corpus: `../../README.md`
- OpenAPI: `../../api/openapi.yaml` (the SDK mirrors this surface)
- AsyncAPI: `../../api/asyncapi.yaml` (the SSE consumer follows these channels)
- TypeScript counterpart: `../typescript/`
- Python counterpart: `../python/`
- **[`../PARITY.md`](../PARITY.md)** — cross-SDK feature-parity matrix (TS/Python/Go).
- **[`../smoke/`](../smoke/)** — runnable wire-smoke scripts against a reference host.
